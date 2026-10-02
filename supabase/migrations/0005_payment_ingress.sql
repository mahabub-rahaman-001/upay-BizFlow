-- BizFlow P3: payment ingress and receipts.
--
-- A payment from any Bangla QR app reaches us as a signed provider webhook. The Edge
-- Function verifies the signature and then calls ingest_payment_event() with the service
-- role; this file is the only place an inbound event becomes books.
--
-- Rules (docs/07 section 14, docs/06 section 5):
--   - the (provider, provider_txn_id, event_type) unique key makes replays harmless:
--     a duplicate returns {"duplicate": true} and posts nothing
--   - an unknown account_ref is quarantined, never guessed at and never dropped
--   - settled payments debit 1010, pending ones debit 1020 and move to 1010 on settlement
--   - a provider reversal posts a mirror entry; the original row is never touched

-- ------------------------------------------------------------------ Quarantine
-- Events we cannot attribute to a business. Kept so nothing is lost and support can
-- replay them once the account_ref is linked (docs/07 section 14).
create table quarantined_events (
  id bigserial primary key,
  provider text not null,
  provider_txn_id text not null,
  event_type text not null,
  account_ref text,
  reason text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index quarantined_events_unresolved_idx
  on quarantined_events (received_at desc) where resolved_at is null;

alter table quarantined_events enable row level security;
-- No policy: only the service role reaches this table.

-- ------------------------------------------------------------------ Receipts
-- One receipt per customer-facing transaction. The token is the capability that the
-- public page at /r/{token} is fetched with, so it is random and not derived from ids.
create table receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  transaction_id uuid not null references transactions(id),
  token text not null unique,
  created_at timestamptz not null default now()
);

create index receipts_business_idx on receipts (business_id, created_at desc);

alter table receipts enable row level security;

create policy receipt_read on receipts for select using (is_member(business_id));

create trigger trg_receipt_append_only
  before update or delete on receipts
  for each row execute function block_mutation();

-- ------------------------------------------------------------------ Helpers
-- A stable client_uuid per inbound event, so a retried webhook maps to the same
-- transaction row rather than a second one.
create or replace function _event_client_uuid(
  p_provider text,
  p_provider_txn_id text,
  p_event_type text
) returns uuid
language sql immutable as $$
  select md5(concat_ws('|', p_provider, p_provider_txn_id, p_event_type))::uuid;
$$;

-- Which accounts an event posts to, and under which transaction kind. Returning the plan
-- separately from the posting keeps the map readable against docs/06 section 5.
create or replace function _event_posting_plan(
  p_event_type text,
  p_amount_minor bigint,
  p_settled boolean
) returns jsonb
language plpgsql immutable as $$
begin
  return case p_event_type
    when 'payment.succeeded' then jsonb_build_object(
      'kind', 'QR_PAYMENT',
      'lines', jsonb_build_array(
        jsonb_build_object('code', case when p_settled then '1010' else '1020' end,
                           'debit', p_amount_minor),
        jsonb_build_object('code', '4000', 'credit', p_amount_minor)))
    when 'settlement.completed' then jsonb_build_object(
      'kind', 'SETTLEMENT',
      'lines', jsonb_build_array(
        jsonb_build_object('code', '1010', 'debit', p_amount_minor),
        jsonb_build_object('code', '1020', 'credit', p_amount_minor)))
    when 'refund.succeeded' then jsonb_build_object(
      'kind', 'REFUND',
      'lines', jsonb_build_array(
        jsonb_build_object('code', '4010', 'debit', p_amount_minor),
        jsonb_build_object('code', '1010', 'credit', p_amount_minor)))
    when 'agent.cash_in' then jsonb_build_object(
      'kind', 'AGENT_CASH_IN',
      'lines', jsonb_build_array(
        jsonb_build_object('code', '1000', 'debit', p_amount_minor),
        jsonb_build_object('code', '1010', 'credit', p_amount_minor)))
    when 'agent.cash_out' then jsonb_build_object(
      'kind', 'AGENT_CASH_OUT',
      'lines', jsonb_build_array(
        jsonb_build_object('code', '1010', 'debit', p_amount_minor),
        jsonb_build_object('code', '1000', 'credit', p_amount_minor)))
    when 'agent.send_money' then jsonb_build_object(
      'kind', 'AGENT_SEND_MONEY',
      'lines', jsonb_build_array(
        jsonb_build_object('code', '1000', 'debit', p_amount_minor),
        jsonb_build_object('code', '1010', 'credit', p_amount_minor)))
    when 'agent.commission' then jsonb_build_object(
      'kind', 'AGENT_COMMISSION',
      'lines', jsonb_build_array(
        jsonb_build_object('code', '1010', 'debit', p_amount_minor),
        jsonb_build_object('code', '4200', 'credit', p_amount_minor)))
    else null
  end;
end $$;

revoke execute on function _event_client_uuid(text, text, text) from public;
revoke execute on function _event_posting_plan(text, bigint, boolean) from public;

-- ------------------------------------------------------------------ Ingress
-- The one entry point for provider events. Called by the payment-webhook Edge Function
-- after it has verified the HMAC signature and the timestamp window; this function trusts
-- the payload's contents but not its account_ref, which it resolves against businesses.
create or replace function ingest_payment_event(
  p_provider text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_event_type text := p_payload ->> 'event_type';
  v_provider_txn_id text := p_payload ->> 'provider_txn_id';
  v_account_ref text := p_payload ->> 'account_ref';
  v_amount_minor bigint := (p_payload ->> 'amount_minor')::bigint;
  v_occurred_at timestamptz := coalesce((p_payload ->> 'occurred_at')::timestamptz, now());
  v_settled boolean := coalesce(p_payload #>> '{settlement,status}', 'pending') = 'settled';
  v_business_id uuid;
  v_event_id uuid;
  v_plan jsonb;
  v_txn_id uuid;
  v_client_uuid uuid;
  v_token text;
begin
  if v_provider_txn_id is null or v_event_type is null then
    raise exception 'PAYLOAD_INVALID: event_type and provider_txn_id are required'
      using errcode = '22023';
  end if;

  -- Already seen. The unique key on payment_events is the source of truth for this, so a
  -- replay is cheap and posts nothing.
  if exists (
    select 1 from payment_events
     where provider = p_provider
       and provider_txn_id = v_provider_txn_id
       and event_type = v_event_type
  ) then
    return jsonb_build_object('duplicate', true);
  end if;

  select id into v_business_id from businesses where upay_account_ref = v_account_ref;

  if v_business_id is null then
    insert into quarantined_events (provider, provider_txn_id, event_type, account_ref,
                                    reason, payload)
    values (p_provider, v_provider_txn_id, v_event_type, v_account_ref,
            'UNKNOWN_ACCOUNT_REF', p_payload);
    return jsonb_build_object('quarantined', true, 'reason', 'UNKNOWN_ACCOUNT_REF');
  end if;

  if v_amount_minor is null or v_amount_minor <= 0 then
    insert into quarantined_events (provider, provider_txn_id, event_type, account_ref,
                                    reason, payload)
    values (p_provider, v_provider_txn_id, v_event_type, v_account_ref,
            'AMOUNT_INVALID', p_payload);
    return jsonb_build_object('quarantined', true, 'reason', 'AMOUNT_INVALID');
  end if;

  -- Durable record of the event itself, before any posting.
  insert into payment_events (
    business_id, provider, provider_txn_id, event_type, amount_minor,
    payer_app, payer_hash, reference, occurred_at, payload_hash
  ) values (
    v_business_id, p_provider, v_provider_txn_id, v_event_type, v_amount_minor,
    p_payload ->> 'payer_app',
    -- The payer token is already opaque per merchant; hash it again so the raw provider
    -- token never rests in our tables (docs/09).
    case when p_payload ? 'payer_token'
         then encode(digest(p_payload ->> 'payer_token', 'sha256'), 'hex')
         else null end,
    p_payload ->> 'reference', v_occurred_at,
    encode(digest(p_payload::text, 'sha256'), 'hex')
  )
  returning id into v_event_id;

  -- A provider reversal mirrors whatever the original payment posted.
  if v_event_type = 'payment.reversed' then
    return _ingest_reversal(v_business_id, p_provider, v_provider_txn_id, v_event_id,
                            v_amount_minor);
  end if;

  v_plan := _event_posting_plan(v_event_type, v_amount_minor, v_settled);

  if v_plan is null then
    -- A known-shaped event we do not post yet (disputes, refund failures). The event row
    -- is kept so the case tooling in P9 can pick it up.
    return jsonb_build_object('accepted', true, 'posted', false,
                              'event_id', v_event_id, 'event_type', v_event_type);
  end if;

  v_client_uuid := _event_client_uuid(p_provider, v_provider_txn_id, v_event_type);

  insert into transactions (
    business_id, kind, source, wallet, amount_minor, payment_event_id,
    reference, actor_user_id, client_uuid, occurred_at
  ) values (
    v_business_id, (v_plan ->> 'kind')::txn_kind, 'verified',
    case when v_settled then 'upay' else 'pending' end,
    v_amount_minor, v_event_id, p_payload ->> 'reference',
    -- Provider-ingested rows have no human actor; the all-zero uuid marks "the system".
    '00000000-0000-0000-0000-000000000000', v_client_uuid, v_occurred_at
  )
  returning id into v_txn_id;

  perform _post_journal(v_business_id, v_txn_id, v_plan -> 'lines',
                        concat_ws(' ', v_event_type, v_provider_txn_id));

  -- A customer-facing payment gets a receipt the merchant can share.
  if v_event_type = 'payment.succeeded' then
    v_token := encode(gen_random_bytes(16), 'hex');
    insert into receipts (business_id, transaction_id, token)
    values (v_business_id, v_txn_id, v_token);
  end if;

  return jsonb_build_object(
    'accepted', true,
    'posted', true,
    'duplicate', false,
    'event_id', v_event_id,
    'transaction_id', v_txn_id,
    'settled', v_settled,
    'receipt_token', v_token
  );
end $$;

-- Mirror the original payment's lines. Separate from the main path so the reversal rule
-- (never edit, always mirror) is readable on its own.
create or replace function _ingest_reversal(
  p_business_id uuid,
  p_provider text,
  p_provider_txn_id text,
  p_event_id uuid,
  p_amount_minor bigint
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_original_id uuid;
  v_lines jsonb;
  v_txn_id uuid;
begin
  select t.id into v_original_id
    from transactions t
    join payment_events e on e.id = t.payment_event_id
   where e.provider = p_provider
     and e.provider_txn_id = p_provider_txn_id
     and e.event_type = 'payment.succeeded'
     and t.business_id = p_business_id;

  if v_original_id is null then
    insert into quarantined_events (provider, provider_txn_id, event_type, reason, payload)
    values (p_provider, p_provider_txn_id, 'payment.reversed', 'ORIGINAL_NOT_FOUND',
            jsonb_build_object('event_id', p_event_id));
    return jsonb_build_object('quarantined', true, 'reason', 'ORIGINAL_NOT_FOUND');
  end if;

  if exists (select 1 from transactions where reverses_txn_id = v_original_id) then
    return jsonb_build_object('duplicate', true, 'reason', 'ALREADY_REVERSED');
  end if;

  select jsonb_agg(
           case when l.debit_minor > 0
                then jsonb_build_object('code', a.code, 'credit', l.debit_minor)
                else jsonb_build_object('code', a.code, 'debit', l.credit_minor)
           end)
    into v_lines
    from journal_lines l
    join accounts a on a.id = l.account_id
    join journal_entries je on je.id = l.entry_id
   where je.transaction_id = v_original_id;

  insert into transactions (
    business_id, kind, source, amount_minor, payment_event_id, note,
    actor_user_id, client_uuid, reverses_txn_id, occurred_at
  ) values (
    p_business_id, 'REVERSAL', 'verified', p_amount_minor, p_event_id,
    'Provider reversal',
    '00000000-0000-0000-0000-000000000000',
    _event_client_uuid(p_provider, p_provider_txn_id, 'payment.reversed'),
    v_original_id, now()
  )
  returning id into v_txn_id;

  perform _post_journal(p_business_id, v_txn_id, v_lines, 'Provider reversal');

  insert into audit_events (business_id, actor_user_id, action, transaction_id, reason, detail)
  values (p_business_id, '00000000-0000-0000-0000-000000000000',
          'payment.reversed_by_provider', v_original_id, 'provider reversal',
          jsonb_build_object('reversal_transaction_id', v_txn_id));

  return jsonb_build_object(
    'accepted', true, 'posted', true, 'duplicate', false,
    'transaction_id', v_txn_id, 'reverses_transaction_id', v_original_id
  );
end $$;

-- ------------------------------------------------------------------ Public receipt
-- Read by the /r/{token} page with no login. Returns only what a customer should see:
-- the shop, the amount, the time and a short reference. No customer identity, no balances
-- and no internal ids (docs/07 section 13, docs/09).
create or replace function get_receipt(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'business_name', b.name,
           'verified', b.verified,
           'amount_minor', t.amount_minor,
           'occurred_at', t.occurred_at,
           'reference', t.reference,
           'payer_app', e.payer_app,
           'reversed', exists (select 1 from transactions r where r.reverses_txn_id = t.id)
         )
    into v
    from receipts rc
    join transactions t on t.id = rc.transaction_id
    join businesses b on b.id = rc.business_id
    left join payment_events e on e.id = t.payment_event_id
   where rc.token = p_token;

  if v is null then
    raise exception 'RECEIPT_NOT_FOUND: no receipt for this token'
      using errcode = 'P0002';
  end if;

  return v;
end $$;

-- ------------------------------------------------------------------ QR payload
-- What the Receive screen renders. The static payload is the merchant's upay account ref;
-- an amount makes it a one-off dynamic QR (docs/07 section 3).
create or replace function get_business_qr(
  p_business_id uuid,
  p_amount_minor bigint default null,
  p_reference text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_business businesses;
begin
  if not is_member(p_business_id) then
    raise exception 'NOT_A_MEMBER: no active membership for this business'
      using errcode = '42501';
  end if;

  select * into v_business from businesses where id = p_business_id;

  if v_business.upay_account_ref is null then
    raise exception 'QR_NOT_ISSUED: this business has no upay account reference yet'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'account_ref', v_business.upay_account_ref,
    'business_name', v_business.name,
    'verified', v_business.verified,
    'amount_minor', p_amount_minor,
    'reference', p_reference,
    -- Interoperable payload: any Bangla QR app scans the same string.
    'payload', concat_ws('|', 'BDQR', v_business.upay_account_ref,
                         coalesce(p_amount_minor::text, ''), coalesce(p_reference, ''))
  );
end $$;

-- ------------------------------------------------------------------ Grants
revoke execute on function ingest_payment_event(text, jsonb) from public;
revoke execute on function _ingest_reversal(uuid, text, text, uuid, bigint) from public;
revoke execute on function get_receipt(text) from public;
revoke execute on function get_business_qr(uuid, bigint, text) from public;

-- Ingress is server-to-server only: the Edge Function holds the service role key.
grant execute on function ingest_payment_event(text, jsonb) to service_role;

-- The receipt page is public by design; the token is the only credential.
grant execute on function get_receipt(text) to anon, authenticated;

grant execute on function get_business_qr(uuid, bigint, text) to authenticated;
