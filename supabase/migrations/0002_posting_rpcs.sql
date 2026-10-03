-- BizFlow P1: the posting engine. Every money write enters the ledger through one of
-- the SECURITY DEFINER RPCs below. Clients never touch transactions/journal_* directly
-- (0001 revoked those grants) and never choose their own business_id - it is re-checked
-- against memberships on every call.
--
-- Rules enforced here (docs/06, docs/07 section 1):
--   - amounts are integer poisha, always > 0
--   - one transaction produces exactly one balanced journal entry
--   - every RPC takes a client-generated idempotency key (client_uuid); the same key with
--     the same body replays the first response, a different body is rejected
--   - corrections are a REVERSAL transaction mirroring the original, never an UPDATE

-- ------------------------------------------------------------------ Audit trail
-- Append-only. Extended with device/session detail in P10 (docs/09).
create table audit_events (
  id bigserial primary key,
  business_id uuid not null references businesses(id),
  actor_user_id uuid not null,
  action text not null,
  transaction_id uuid references transactions(id),
  reason text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_events_business_idx on audit_events (business_id, created_at desc);

alter table audit_events enable row level security;

create policy audit_read on audit_events for select
  using (has_role(business_id, array['merchant_owner','agent_owner','manager','auditor']::member_role[]));

create trigger trg_audit_append_only
  before update or delete on audit_events
  for each row execute function block_mutation();

-- ------------------------------------------------------------------ Idempotency
-- One row per (business, client_uuid). Holds the hash of the request body so a replay
-- with a different body can be told apart from a true retry.
create table idempotency_keys (
  business_id uuid not null references businesses(id),
  client_uuid uuid not null,
  request_hash text not null,
  transaction_id uuid not null references transactions(id),
  created_at timestamptz not null default now(),
  primary key (business_id, client_uuid)
);

alter table idempotency_keys enable row level security;

create policy idem_read on idempotency_keys for select using (is_member(business_id));

create trigger trg_idem_append_only
  before update or delete on idempotency_keys
  for each row execute function block_mutation();

-- ------------------------------------------------------------------ Internal helpers
-- These are SECURITY DEFINER building blocks, not an API. Postgres grants EXECUTE on new
-- functions to PUBLIC, so each one is revoked below; only the posting RPCs stay callable.

create or replace function _account_id(p_business_id uuid, p_code text)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from accounts
   where business_id = p_business_id and code = p_code;
  if v_id is null then
    raise exception 'ACCOUNT_NOT_FOUND: business % has no account %', p_business_id, p_code
      using errcode = 'P0002';
  end if;
  return v_id;
end $$;

-- Posting rights. Owners and managers always; staff only when the owner enabled the
-- toggle on their membership (docs/02 section 4, "Limited if enabled").
create or replace function _assert_can_post(p_business_id uuid, p_permission text)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_role member_role;
  v_perms jsonb;
begin
  select role, permissions into v_role, v_perms
    from memberships
   where user_id = auth.uid() and business_id = p_business_id and status = 'active';

  if v_role is null then
    raise exception 'NOT_A_MEMBER: no active membership for this business'
      using errcode = '42501';
  end if;

  if v_role in ('merchant_owner','agent_owner','manager') then
    return auth.uid();
  end if;

  if v_role = 'staff' and coalesce((v_perms ->> p_permission)::boolean, false) then
    return auth.uid();
  end if;

  raise exception 'ROLE_NOT_PERMITTED: role % cannot perform %', v_role, p_permission
    using errcode = '42501';
end $$;

-- Owner-only actions (reversals, withdrawals). No staff toggle can grant these.
create or replace function _assert_is_owner(p_business_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role(p_business_id, array['merchant_owner','agent_owner']::member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED: owner role required'
      using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function _assert_amount(p_amount_minor bigint)
returns void
language plpgsql immutable as $$
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'AMOUNT_INVALID: amount_minor must be a positive integer of poisha'
      using errcode = '22023';
  end if;
end $$;

-- Replay check. Returns the already-posted transaction id when this is a retry of the
-- same request, null when the key is new, and raises when the key was reused for a
-- different body (docs/07: same key + different body -> 409).
create or replace function _idempotent_lookup(
  p_business_id uuid,
  p_client_uuid uuid,
  p_request_hash text
) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_row idempotency_keys;
begin
  if p_client_uuid is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: client_uuid is required'
      using errcode = '22023';
  end if;

  select * into v_row from idempotency_keys
   where business_id = p_business_id and client_uuid = p_client_uuid;

  if v_row is null then
    return null;
  end if;

  if v_row.request_hash <> p_request_hash then
    raise exception 'IDEMPOTENCY_KEY_REUSED: this key was used with a different body'
      using errcode = '23505';
  end if;

  return v_row.transaction_id;
end $$;

-- Writes one balanced journal entry. p_lines is [{"code":"1000","debit":12000}, ...];
-- each element carries exactly one of "debit" or "credit" in poisha. The deferred
-- constraint trigger from 0001 rejects the entry at COMMIT if the sides do not match.
create or replace function _post_journal(
  p_business_id uuid,
  p_transaction_id uuid,
  p_lines jsonb,
  p_memo text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entry_id uuid;
  v_line jsonb;
begin
  insert into journal_entries (business_id, transaction_id, memo)
  values (p_business_id, p_transaction_id, p_memo)
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, business_id, account_id, debit_minor, credit_minor)
    values (
      v_entry_id,
      p_business_id,
      _account_id(p_business_id, v_line ->> 'code'),
      coalesce((v_line ->> 'debit')::bigint, 0),
      coalesce((v_line ->> 'credit')::bigint, 0)
    );
  end loop;

  return v_entry_id;
end $$;

-- Shared tail of every posting RPC: insert the transaction, post its journal entry,
-- record the idempotency key, and return the response payload.
create or replace function _post_transaction(
  p_business_id uuid,
  p_kind txn_kind,
  p_source text,
  p_amount_minor bigint,
  p_lines jsonb,
  p_client_uuid uuid,
  p_request_hash text,
  p_actor_user_id uuid,
  p_occurred_at timestamptz,
  p_device_time timestamptz default null,
  p_wallet text default null,
  p_category text default null,
  p_note text default null,
  p_customer_id uuid default null,
  p_reverses_txn_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_txn_id uuid;
  v_entry_id uuid;
begin
  insert into transactions (
    business_id, kind, source, wallet, amount_minor, category, note,
    customer_id, actor_user_id, client_uuid, reverses_txn_id, occurred_at, device_time
  ) values (
    p_business_id, p_kind, p_source, p_wallet, p_amount_minor, p_category, p_note,
    p_customer_id, p_actor_user_id, p_client_uuid, p_reverses_txn_id,
    coalesce(p_occurred_at, now()), p_device_time
  )
  returning id into v_txn_id;

  v_entry_id := _post_journal(p_business_id, v_txn_id, p_lines, p_note);

  insert into idempotency_keys (business_id, client_uuid, request_hash, transaction_id)
  values (p_business_id, p_client_uuid, p_request_hash, v_txn_id);

  return jsonb_build_object(
    'transaction_id', v_txn_id,
    'entry_id', v_entry_id,
    'kind', p_kind,
    'amount_minor', p_amount_minor,
    'replayed', false
  );
end $$;

-- Response for a retry: the first call's result, flagged so the client can tell.
create or replace function _replay(p_transaction_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_txn transactions;
  v_entry_id uuid;
begin
  select * into v_txn from transactions where id = p_transaction_id;
  select id into v_entry_id from journal_entries where transaction_id = p_transaction_id;

  return jsonb_build_object(
    'transaction_id', v_txn.id,
    'entry_id', v_entry_id,
    'kind', v_txn.kind,
    'amount_minor', v_txn.amount_minor,
    'replayed', true
  );
end $$;

revoke execute on function _account_id(uuid, text) from public;
revoke execute on function _assert_can_post(uuid, text) from public;
revoke execute on function _assert_is_owner(uuid) from public;
revoke execute on function _assert_amount(bigint) from public;
revoke execute on function _idempotent_lookup(uuid, uuid, text) from public;
revoke execute on function _post_journal(uuid, uuid, jsonb, text) from public;
revoke execute on function _replay(uuid) from public;
revoke execute on function _post_transaction(
  uuid, txn_kind, text, bigint, jsonb, uuid, text, uuid, timestamptz,
  timestamptz, text, text, text, uuid, uuid) from public;

-- 0001 left seed_accounts callable by anyone; it is an onboarding step, not an API.
revoke execute on function seed_accounts(uuid, business_type) from public;

-- ------------------------------------------------------------------ Posting RPCs
-- Cash sale: cash drawer up, sales up (docs/06: 1000 debit / 4000 credit).
create or replace function post_cash_sale(
  p_business_id uuid,
  p_amount_minor bigint,
  p_client_uuid uuid,
  p_category text default null,
  p_note text default null,
  p_customer_id uuid default null,
  p_occurred_at timestamptz default null,
  p_device_time timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_hash text;
  v_existing uuid;
begin
  v_actor := _assert_can_post(p_business_id, 'can_add_entries');
  perform _assert_amount(p_amount_minor);

  v_hash := md5(concat_ws('|', 'CASH_SALE', p_business_id, p_amount_minor,
                          p_category, p_note, p_customer_id));
  v_existing := _idempotent_lookup(p_business_id, p_client_uuid, v_hash);
  if v_existing is not null then
    return _replay(v_existing);
  end if;

  return _post_transaction(
    p_business_id, 'CASH_SALE', 'manual', p_amount_minor,
    jsonb_build_array(
      jsonb_build_object('code', '1000', 'debit', p_amount_minor),
      jsonb_build_object('code', '4000', 'credit', p_amount_minor)
    ),
    p_client_uuid, v_hash, v_actor, p_occurred_at, p_device_time,
    'cash', p_category, p_note, p_customer_id
  );
end $$;

-- Expense: operating expense up, cash or wallet down (5100 debit / 1000 or 1010 credit).
create or replace function post_expense(
  p_business_id uuid,
  p_amount_minor bigint,
  p_client_uuid uuid,
  p_paid_from text default 'cash',
  p_expense_type text default null,
  p_note text default null,
  p_occurred_at timestamptz default null,
  p_device_time timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_hash text;
  v_existing uuid;
  v_credit_code text;
begin
  v_actor := _assert_can_post(p_business_id, 'can_add_entries');
  perform _assert_amount(p_amount_minor);

  v_credit_code := case p_paid_from
    when 'cash' then '1000'
    when 'wallet' then '1010'
    else null
  end;
  if v_credit_code is null then
    raise exception 'PAID_FROM_INVALID: paid_from must be cash or wallet'
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', 'EXPENSE', p_business_id, p_amount_minor,
                          p_paid_from, p_expense_type, p_note));
  v_existing := _idempotent_lookup(p_business_id, p_client_uuid, v_hash);
  if v_existing is not null then
    return _replay(v_existing);
  end if;

  return _post_transaction(
    p_business_id, 'EXPENSE', 'manual', p_amount_minor,
    jsonb_build_array(
      jsonb_build_object('code', '5100', 'debit', p_amount_minor),
      jsonb_build_object('code', v_credit_code, 'credit', p_amount_minor)
    ),
    p_client_uuid, v_hash, v_actor, p_occurred_at, p_device_time,
    p_paid_from, p_expense_type, p_note
  );
end $$;

-- Manual other-wallet cash-out, agent side: wallet X up, cash drawer down
-- (docs/06: 1030 debit / 1000 credit). Always source = manual, never auto-verified.
create or replace function post_manual_wallet(
  p_business_id uuid,
  p_amount_minor bigint,
  p_client_uuid uuid,
  p_wallet text,
  p_note text default null,
  p_occurred_at timestamptz default null,
  p_device_time timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_hash text;
  v_existing uuid;
begin
  v_actor := _assert_can_post(p_business_id, 'can_add_entries');
  perform _assert_amount(p_amount_minor);

  if p_wallet is null or length(btrim(p_wallet)) = 0 then
    raise exception 'WALLET_REQUIRED: wallet name is required for a manual entry'
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', 'MANUAL_WALLET', p_business_id, p_amount_minor,
                          p_wallet, p_note));
  v_existing := _idempotent_lookup(p_business_id, p_client_uuid, v_hash);
  if v_existing is not null then
    return _replay(v_existing);
  end if;

  return _post_transaction(
    p_business_id, 'MANUAL_WALLET', 'manual', p_amount_minor,
    jsonb_build_array(
      jsonb_build_object('code', '1030', 'debit', p_amount_minor),
      jsonb_build_object('code', '1000', 'credit', p_amount_minor)
    ),
    p_client_uuid, v_hash, v_actor, p_occurred_at, p_device_time,
    p_wallet, null, p_note
  );
end $$;

-- Owner withdrawal: a record only, BizFlow moves no funds (3000 debit / 1000 or 1010 credit).
create or replace function post_owner_withdrawal(
  p_business_id uuid,
  p_amount_minor bigint,
  p_client_uuid uuid,
  p_paid_from text default 'cash',
  p_note text default null,
  p_occurred_at timestamptz default null,
  p_device_time timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_hash text;
  v_existing uuid;
  v_credit_code text;
begin
  v_actor := _assert_is_owner(p_business_id);
  perform _assert_amount(p_amount_minor);

  v_credit_code := case p_paid_from
    when 'cash' then '1000'
    when 'wallet' then '1010'
    else null
  end;
  if v_credit_code is null then
    raise exception 'PAID_FROM_INVALID: paid_from must be cash or wallet'
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', 'OWNER_WITHDRAWAL', p_business_id, p_amount_minor,
                          p_paid_from, p_note));
  v_existing := _idempotent_lookup(p_business_id, p_client_uuid, v_hash);
  if v_existing is not null then
    return _replay(v_existing);
  end if;

  return _post_transaction(
    p_business_id, 'OWNER_WITHDRAWAL', 'manual', p_amount_minor,
    jsonb_build_array(
      jsonb_build_object('code', '3000', 'debit', p_amount_minor),
      jsonb_build_object('code', v_credit_code, 'credit', p_amount_minor)
    ),
    p_client_uuid, v_hash, v_actor, p_occurred_at, p_device_time,
    p_paid_from, null, p_note
  );
end $$;

-- Correction, step one of two: a REVERSAL transaction whose journal lines mirror the
-- original (debits become credits). The replacement is posted as a separate normal call,
-- so a correction is always reversal + replacement and nothing is ever edited in place.
create or replace function reverse_transaction(
  p_business_id uuid,
  p_transaction_id uuid,
  p_client_uuid uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_hash text;
  v_existing uuid;
  v_original transactions;
  v_lines jsonb;
  v_result jsonb;
begin
  v_actor := _assert_is_owner(p_business_id);

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: a reversal needs a reason'
      using errcode = '22023';
  end if;

  select * into v_original from transactions
   where id = p_transaction_id and business_id = p_business_id;

  if v_original is null then
    raise exception 'TRANSACTION_NOT_FOUND: no such transaction in this business'
      using errcode = 'P0002';
  end if;

  if v_original.kind = 'REVERSAL' then
    raise exception 'ALREADY_A_REVERSAL: a reversal cannot itself be reversed'
      using errcode = '22023';
  end if;

  if exists (select 1 from transactions where reverses_txn_id = p_transaction_id) then
    raise exception 'ALREADY_REVERSED: this transaction was already reversed'
      using errcode = '23505';
  end if;

  v_hash := md5(concat_ws('|', 'REVERSAL', p_business_id, p_transaction_id, p_reason));
  v_existing := _idempotent_lookup(p_business_id, p_client_uuid, v_hash);
  if v_existing is not null then
    return _replay(v_existing);
  end if;

  -- Mirror the original entry: each debit becomes a credit and vice versa.
  select jsonb_agg(
           case when l.debit_minor > 0
                then jsonb_build_object('code', a.code, 'credit', l.debit_minor)
                else jsonb_build_object('code', a.code, 'debit', l.credit_minor)
           end)
    into v_lines
    from journal_lines l
    join accounts a on a.id = l.account_id
    join journal_entries e on e.id = l.entry_id
   where e.transaction_id = p_transaction_id;

  if v_lines is null then
    raise exception 'NO_JOURNAL_LINES: original transaction has no journal entry'
      using errcode = 'P0002';
  end if;

  v_result := _post_transaction(
    p_business_id, 'REVERSAL', v_original.source, v_original.amount_minor, v_lines,
    p_client_uuid, v_hash, v_actor, now(), null,
    v_original.wallet, v_original.category, p_reason, v_original.customer_id,
    p_transaction_id
  );

  insert into audit_events (business_id, actor_user_id, action, transaction_id, reason, detail)
  values (p_business_id, v_actor, 'transaction.reversed', p_transaction_id, p_reason,
          jsonb_build_object('reversal_transaction_id', v_result -> 'transaction_id'));

  return v_result;
end $$;

-- ------------------------------------------------------------------ Grants
-- Only these five are the client API surface.
revoke execute on function post_cash_sale(uuid, bigint, uuid, text, text, uuid, timestamptz, timestamptz) from public;
revoke execute on function post_expense(uuid, bigint, uuid, text, text, text, timestamptz, timestamptz) from public;
revoke execute on function post_manual_wallet(uuid, bigint, uuid, text, text, timestamptz, timestamptz) from public;
revoke execute on function post_owner_withdrawal(uuid, bigint, uuid, text, text, timestamptz, timestamptz) from public;
revoke execute on function reverse_transaction(uuid, uuid, uuid, text) from public;

grant execute on function post_cash_sale(uuid, bigint, uuid, text, text, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function post_expense(uuid, bigint, uuid, text, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function post_manual_wallet(uuid, bigint, uuid, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function post_owner_withdrawal(uuid, bigint, uuid, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function reverse_transaction(uuid, uuid, uuid, text) to authenticated;
