-- P4 M6: suppliers and payables (docs/03 M6, docs/07 section 6).
--
-- A payable is a bill the shop owes a supplier. Confirming it puts the purchase on the
-- books (5000 Purchases against 2000 Supplier payable); paying it moves the liability
-- down against cash or wallet (2000 against 1000 or 1010). So the amount a shop owes is
-- the balance of account 2000, derived from the journal like every other figure, and the
-- payables table is a record of the bills themselves, not a second source of truth for the
-- money.
--
-- The lifecycle is DRAFT -> CONFIRMED -> PARTIALLY_PAID -> PAID, with CANCELLED from
-- CONFIRMED (docs/06 section 7). Each transition is an RPC that checks the current status,
-- so two taps cannot double-confirm or over-pay.

-- ------------------------------------------------------------------ Suppliers
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text,
  phone_last4 text generated always as (right(phone, 4)) stored,
  category text,
  -- How often the shop buys from them, so recurring bills can be suggested later.
  usual_cycle text check (usual_cycle in ('weekly','biweekly','monthly','irregular')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create index suppliers_business_idx on suppliers (business_id, active, name);

alter table suppliers enable row level security;

create policy supplier_read on suppliers for select using (is_member(business_id));

-- ------------------------------------------------------------------ Payables
create table supplier_payables (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  amount_minor bigint not null check (amount_minor > 0),
  -- Updated as payments come in; the remaining balance drives PARTIALLY_PAID -> PAID.
  amount_remaining_minor bigint not null check (amount_remaining_minor >= 0),
  invoice_ref text,
  due_date date,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','CONFIRMED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED')),
  note text,
  -- The transaction that put this purchase on the books, once confirmed.
  confirm_transaction_id uuid references transactions(id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplier_payables_business_idx
  on supplier_payables (business_id, status, due_date);

alter table supplier_payables enable row level security;

-- Suppliers and payables are merchant bookkeeping: owners and managers, not staff
-- (docs/02 section 4, "Suppliers & payables" is owner-only).
create policy payable_read on supplier_payables for select
  using (has_role(business_id, array['merchant_owner','agent_owner','manager']::member_role[]));

-- A payable's status and remaining balance change over its life, so it is not append-only;
-- the money side is, because every change posts a ledger transaction. No direct writes
-- from clients, though - everything goes through the RPCs below.
revoke insert, update, delete on suppliers, supplier_payables from authenticated;

-- One row per payment against a payable, so a part-paid bill has a history.
create table payable_payments (
  id uuid primary key default gen_random_uuid(),
  payable_id uuid not null references supplier_payables(id),
  business_id uuid not null references businesses(id),
  amount_minor bigint not null check (amount_minor > 0),
  paid_from text not null check (paid_from in ('cash','wallet')),
  transaction_id uuid not null references transactions(id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index payable_payments_payable_idx on payable_payments (payable_id, created_at);

alter table payable_payments enable row level security;

create policy payable_payment_read on payable_payments for select
  using (has_role(business_id, array['merchant_owner','agent_owner','manager']::member_role[]));

create trigger trg_payable_payment_append_only
  before update or delete on payable_payments
  for each row execute function block_mutation();

-- ------------------------------------------------------------------ Suppliers API
create or replace function create_supplier(
  p_business_id uuid,
  p_name text,
  p_phone text default null,
  p_category text default null,
  p_usual_cycle text default 'irregular'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- Managing suppliers is an owner and manager task.
  if not has_role(p_business_id, array['merchant_owner','agent_owner','manager']::member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED: suppliers are owner and manager only'
      using errcode = '42501';
  end if;

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED: supplier name is required' using errcode = '22023';
  end if;

  insert into suppliers (business_id, name, phone, category, usual_cycle)
  values (p_business_id, btrim(p_name), nullif(btrim(coalesce(p_phone,'')), ''),
          p_category, coalesce(p_usual_cycle, 'irregular'))
  on conflict (business_id, name) do update set
    phone = coalesce(excluded.phone, suppliers.phone),
    category = coalesce(excluded.category, suppliers.category),
    active = true
  returning id into v_id;

  return jsonb_build_object('supplier_id', v_id);
end $$;

-- Suppliers with what is still owed to each, derived from their open payables.
create or replace function supplier_balances(p_business_id uuid)
returns table (supplier_id uuid, name text, phone_last4 text, due_minor bigint, open_count int)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.phone_last4,
         coalesce(sum(p.amount_remaining_minor) filter (
           where p.status in ('CONFIRMED','PARTIALLY_PAID','OVERDUE')), 0)::bigint,
         count(p.id) filter (
           where p.status in ('CONFIRMED','PARTIALLY_PAID','OVERDUE'))::int
    from suppliers s
    left join supplier_payables p on p.supplier_id = s.id
   where s.business_id = p_business_id
     and has_role(p_business_id, array['merchant_owner','agent_owner','manager']::member_role[])
   group by s.id, s.name, s.phone_last4
   order by 4 desc, s.name;
$$;

-- ------------------------------------------------------------------ Payable lifecycle
-- Create a draft bill. Nothing hits the ledger until it is confirmed, because a draft is
-- just a note that a bill is expected (docs/03 M6: recurring cycles create drafts).
create or replace function create_payable(
  p_business_id uuid,
  p_supplier_id uuid,
  p_amount_minor bigint,
  p_due_date date default null,
  p_invoice_ref text default null,
  p_note text default null,
  p_confirm boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_id uuid;
begin
  v_actor := _assert_is_owner_or_manager(p_business_id);
  perform _assert_amount(p_amount_minor);

  if not exists (select 1 from suppliers
                  where id = p_supplier_id and business_id = p_business_id) then
    raise exception 'SUPPLIER_NOT_FOUND: no such supplier in this business'
      using errcode = 'P0002';
  end if;

  insert into supplier_payables (
    business_id, supplier_id, amount_minor, amount_remaining_minor,
    invoice_ref, due_date, note, status, created_by
  ) values (
    p_business_id, p_supplier_id, p_amount_minor, p_amount_minor,
    p_invoice_ref, p_due_date, p_note, 'DRAFT', v_actor
  )
  returning id into v_id;

  -- Most bills are confirmed as they are entered; a draft is the exception.
  if coalesce(p_confirm, true) then
    perform confirm_payable(p_business_id, v_id);
  end if;

  return jsonb_build_object('payable_id', v_id, 'confirmed', coalesce(p_confirm, true));
end $$;

-- Confirming posts the purchase: 5000 Purchases debit, 2000 Supplier payable credit.
create or replace function confirm_payable(
  p_business_id uuid,
  p_payable_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_payable supplier_payables;
  v_result jsonb;
begin
  v_actor := _assert_is_owner_or_manager(p_business_id);

  -- WHERE status = DRAFT is the optimistic lock: a second confirm finds nothing.
  select * into v_payable from supplier_payables
   where id = p_payable_id and business_id = p_business_id and status = 'DRAFT'
   for update;

  if v_payable.id is null then
    raise exception 'PAYABLE_NOT_DRAFT: this payable is not a draft to confirm'
      using errcode = '22023';
  end if;

  v_result := _post_transaction(
    p_business_id, 'SUPPLIER_PAYMENT', 'manual', v_payable.amount_minor,
    jsonb_build_array(
      jsonb_build_object('code', '5000', 'debit', v_payable.amount_minor),
      jsonb_build_object('code', '2000', 'credit', v_payable.amount_minor)
    ),
    gen_random_uuid(),
    md5(concat_ws('|', 'PAYABLE_CONFIRM', p_payable_id)),
    v_actor, now(), null, null, 'supplier',
    concat_ws(' ', 'Invoice', v_payable.invoice_ref)
  );

  update supplier_payables
     set status = 'CONFIRMED',
         confirm_transaction_id = (v_result ->> 'transaction_id')::uuid,
         updated_at = now()
   where id = p_payable_id;

  return jsonb_build_object('payable_id', p_payable_id, 'status', 'CONFIRMED');
end $$;

-- A payment: 2000 Supplier payable debit, cash or wallet credit. Part payments are
-- allowed; the bill becomes PAID only when nothing is left.
create or replace function pay_payable(
  p_business_id uuid,
  p_payable_id uuid,
  p_amount_minor bigint,
  p_client_uuid uuid,
  p_paid_from text default 'cash'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_payable supplier_payables;
  v_credit_code text;
  v_existing uuid;
  v_hash text;
  v_result jsonb;
  v_remaining bigint;
  v_new_status text;
begin
  v_actor := _assert_is_owner_or_manager(p_business_id);
  perform _assert_amount(p_amount_minor);

  v_credit_code := case p_paid_from when 'cash' then '1000' when 'wallet' then '1010' else null end;
  if v_credit_code is null then
    raise exception 'PAID_FROM_INVALID: paid_from must be cash or wallet' using errcode = '22023';
  end if;

  select * into v_payable from supplier_payables
   where id = p_payable_id and business_id = p_business_id
     and status in ('CONFIRMED','PARTIALLY_PAID','OVERDUE')
   for update;

  if v_payable.id is null then
    raise exception 'PAYABLE_NOT_PAYABLE: this payable cannot take a payment'
      using errcode = '22023';
  end if;

  if p_amount_minor > v_payable.amount_remaining_minor then
    raise exception 'PAYMENT_EXCEEDS_REMAINING: remaining is % poisha', v_payable.amount_remaining_minor
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', 'PAYABLE_PAY', p_payable_id, p_amount_minor, p_paid_from));
  v_existing := _idempotent_lookup(p_business_id, p_client_uuid, v_hash);
  if v_existing is not null then
    return _replay(v_existing);
  end if;

  v_result := _post_transaction(
    p_business_id, 'SUPPLIER_PAYMENT', 'manual', p_amount_minor,
    jsonb_build_array(
      jsonb_build_object('code', '2000', 'debit', p_amount_minor),
      jsonb_build_object('code', v_credit_code, 'credit', p_amount_minor)
    ),
    p_client_uuid, v_hash, v_actor, now(), null, p_paid_from, 'supplier',
    concat_ws(' ', 'Payment', v_payable.invoice_ref)
  );

  v_remaining := v_payable.amount_remaining_minor - p_amount_minor;
  v_new_status := case when v_remaining = 0 then 'PAID' else 'PARTIALLY_PAID' end;

  update supplier_payables
     set amount_remaining_minor = v_remaining, status = v_new_status, updated_at = now()
   where id = p_payable_id;

  insert into payable_payments (payable_id, business_id, amount_minor, paid_from,
                                transaction_id, created_by)
  values (p_payable_id, p_business_id, p_amount_minor, p_paid_from,
          (v_result ->> 'transaction_id')::uuid, v_actor);

  return jsonb_build_object(
    'payable_id', p_payable_id,
    'paid_minor', p_amount_minor,
    'remaining_minor', v_remaining,
    'status', v_new_status
  );
end $$;

-- Cancel an unpaid confirmed bill. The purchase that was posted on confirm is reversed, so
-- the books forget it rather than carry a cancelled liability (docs/06 section 5).
create or replace function cancel_payable(
  p_business_id uuid,
  p_payable_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_payable supplier_payables;
begin
  v_actor := _assert_is_owner(p_business_id);

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: a cancellation needs a reason' using errcode = '22023';
  end if;

  select * into v_payable from supplier_payables
   where id = p_payable_id and business_id = p_business_id
     and status = 'CONFIRMED'
   for update;

  if v_payable.id is null then
    raise exception 'PAYABLE_NOT_CANCELLABLE: only a confirmed, unpaid payable can be cancelled'
      using errcode = '22023';
  end if;

  -- Reverse the confirm posting so the purchase and the liability both come off the books.
  perform reverse_transaction(p_business_id, v_payable.confirm_transaction_id,
                              gen_random_uuid(), concat_ws(': ', 'Payable cancelled', p_reason));

  update supplier_payables
     set status = 'CANCELLED', note = concat_ws(' | ', note, p_reason), updated_at = now()
   where id = p_payable_id;

  return jsonb_build_object('payable_id', p_payable_id, 'status', 'CANCELLED');
end $$;

-- Owner or manager, used by the payable RPCs. Suppliers are not a staff-toggle capability.
create or replace function _assert_is_owner_or_manager(p_business_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role(p_business_id, array['merchant_owner','agent_owner','manager']::member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED: owner or manager required' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ------------------------------------------------------------------ Grants
revoke execute on function create_supplier(uuid, text, text, text, text) from public;
revoke execute on function supplier_balances(uuid) from public;
revoke execute on function create_payable(uuid, uuid, bigint, date, text, text, boolean) from public;
revoke execute on function confirm_payable(uuid, uuid) from public;
revoke execute on function pay_payable(uuid, uuid, bigint, uuid, text) from public;
revoke execute on function cancel_payable(uuid, uuid, text) from public;
revoke execute on function _assert_is_owner_or_manager(uuid) from public;

grant execute on function create_supplier(uuid, text, text, text, text) to authenticated;
grant execute on function supplier_balances(uuid) to authenticated;
grant execute on function create_payable(uuid, uuid, bigint, date, text, text, boolean) to authenticated;
grant execute on function confirm_payable(uuid, uuid) to authenticated;
grant execute on function pay_payable(uuid, uuid, bigint, uuid, text) to authenticated;
grant execute on function cancel_payable(uuid, uuid, text) to authenticated;
