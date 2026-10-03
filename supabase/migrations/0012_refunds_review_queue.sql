-- P4 remainder: refunds and the review queue (docs/07 sections 7 and 11).
--
-- Refund: an owner returns some or all of a QR payment to the customer. It is capped at
-- what is still refundable on that payment (original minus what was already refunded),
-- checked under a row lock so two taps cannot refund past the original. It posts
-- 4010 Returns against 1010 the wallet (docs/06 section 5) and links back to the payment.
--
-- Review queue: the items that actually need a human look, drawn from what exists today -
-- payments still awaiting settlement above the material threshold, and open anomaly flags
-- from the AI (0008). It is a read, not a workflow table: each row points at a transaction
-- and says why it is here.

create table refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  original_transaction_id uuid not null references transactions(id),
  refund_transaction_id uuid not null references transactions(id),
  amount_minor bigint not null check (amount_minor > 0),
  reason text not null,
  -- The local lifecycle. A real upay refund would advance SUBMITTED -> PROCESSING ->
  -- SUCCEEDED as the provider reports back; locally it is SUCCEEDED once the reversal is
  -- on the books, because the money side is what BizFlow controls.
  status text not null default 'SUCCEEDED'
    check (status in ('REQUESTED','SUBMITTED','PROCESSING','SUCCEEDED','FAILED')),
  provider_ref text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index refunds_original_idx on refunds (original_transaction_id);
create index refunds_business_idx on refunds (business_id, created_at desc);

alter table refunds enable row level security;

create policy refund_read on refunds for select
  using (has_role(business_id, array['merchant_owner','agent_owner','manager']::member_role[]));

create trigger trg_refunds_append_only
  before update or delete on refunds
  for each row execute function block_mutation();

-- How much of a payment can still be refunded: the original amount minus every refund
-- already recorded against it.
create or replace function refundable_remaining(p_transaction_id uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select t.amount_minor
         - coalesce((select sum(r.amount_minor) from refunds r
                      where r.original_transaction_id = p_transaction_id
                        and r.status <> 'FAILED'), 0)
    from transactions t
   where t.id = p_transaction_id;
$$;

-- Refund (docs/07 section 11). Owner only, reason required, capped at what remains. The
-- FOR UPDATE on the original is what makes two concurrent refunds safe: the second waits,
-- then sees the first one's effect on the remaining amount.
create or replace function post_refund(
  p_business_id uuid,
  p_original_transaction_id uuid,
  p_amount_minor bigint,
  p_reason text,
  p_client_uuid uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_original transactions;
  v_remaining bigint;
  v_existing uuid;
  v_hash text;
  v_result jsonb;
begin
  v_actor := _assert_is_owner(p_business_id);
  perform _assert_amount(p_amount_minor);

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: a refund needs a reason' using errcode = '22023';
  end if;

  select * into v_original from transactions
   where id = p_original_transaction_id and business_id = p_business_id
   for update;

  if v_original.id is null then
    raise exception 'TRANSACTION_NOT_FOUND: no such transaction in this business'
      using errcode = 'P0002';
  end if;

  -- Only money that actually came in can be refunded.
  if v_original.kind not in ('QR_PAYMENT','CASH_SALE') then
    raise exception 'NOT_REFUNDABLE: only a sale or payment can be refunded'
      using errcode = '22023';
  end if;

  v_remaining := refundable_remaining(p_original_transaction_id);
  if p_amount_minor > v_remaining then
    raise exception 'REFUND_EXCEEDS_REMAINING: refundable remaining is % poisha', v_remaining
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', 'REFUND', p_original_transaction_id, p_amount_minor, p_reason));
  v_existing := _idempotent_lookup(p_business_id, p_client_uuid, v_hash);
  if v_existing is not null then
    return _replay(v_existing);
  end if;

  -- Returns against the wallet for a QR payment, against the drawer for a cash sale.
  v_result := _post_transaction(
    p_business_id, 'REFUND', v_original.source, p_amount_minor,
    jsonb_build_array(
      jsonb_build_object('code', '4010', 'debit', p_amount_minor),
      jsonb_build_object('code', case when v_original.kind = 'CASH_SALE' then '1000' else '1010' end,
                         'credit', p_amount_minor)
    ),
    p_client_uuid, v_hash, v_actor, now(), null, v_original.wallet, null,
    concat_ws(': ', 'Refund', p_reason), v_original.customer_id, p_original_transaction_id
  );

  insert into refunds (business_id, original_transaction_id, refund_transaction_id,
                       amount_minor, reason, status, created_by)
  values (p_business_id, p_original_transaction_id, (v_result ->> 'transaction_id')::uuid,
          p_amount_minor, p_reason, 'SUCCEEDED', v_actor);

  insert into audit_events (business_id, actor_user_id, action, transaction_id, reason, detail)
  values (p_business_id, v_actor, 'payment.refunded', p_original_transaction_id, p_reason,
          jsonb_build_object('amount_minor', p_amount_minor,
                             'refund_transaction_id', v_result -> 'transaction_id'));

  return jsonb_build_object(
    'refund_transaction_id', v_result ->> 'transaction_id',
    'amount_minor', p_amount_minor,
    'remaining_after_minor', v_remaining - p_amount_minor,
    'status', 'SUCCEEDED'
  );
end $$;

-- ------------------------------------------------------------------ Review queue
-- What needs a human look, from what the system actually tracks: payments still awaiting
-- settlement above the material threshold, and unresolved AI anomaly flags. Each item
-- names its transaction, its amount, a reason code and a Bangla reason, so one list drives
-- the review screen regardless of where the item came from.
create or replace function review_queue(p_business_id uuid)
returns table (
  transaction_id uuid,
  amount_minor bigint,
  occurred_at timestamptz,
  reason_code text,
  reason_bn text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_threshold bigint;
begin
  if not has_role(p_business_id,
                  array['merchant_owner','agent_owner','manager']::member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED: review queue is owner and manager only'
      using errcode = '42501';
  end if;

  select coalesce((settings ->> 'closing_blocker_minor')::bigint, 200000)
    into v_threshold from businesses where id = p_business_id;

  return query
  -- Payments taken but not yet settled, big enough to matter.
  select t.id, t.amount_minor, t.occurred_at,
         'PENDING_SETTLEMENT'::text,
         'টাকা এখনো সেটেল হয়নি'::text
    from transactions t
   where t.business_id = p_business_id
     and t.kind = 'QR_PAYMENT'
     and t.wallet = 'pending'
     and t.amount_minor >= v_threshold
     and not exists (select 1 from transactions r where r.reverses_txn_id = t.id)
     and not exists (
       select 1 from transactions s
        join payment_events se on se.id = s.payment_event_id
        join payment_events oe on oe.id = t.payment_event_id
        where s.kind = 'SETTLEMENT' and se.provider_txn_id = oe.provider_txn_id)
  union all
  -- Open anomaly flags from the nightly AI run.
  select f.transaction_id, t2.amount_minor, t2.occurred_at,
         'ANOMALY'::text,
         coalesce(f.reason_bn[1], 'অস্বাভাবিক লেনদেন')::text
    from ai_anomaly_flags f
    join transactions t2 on t2.id = f.transaction_id
   where f.business_id = p_business_id and not f.resolved
  order by occurred_at desc;
end $$;

-- ------------------------------------------------------------------ Grants
revoke execute on function refundable_remaining(uuid) from public;
revoke execute on function post_refund(uuid, uuid, bigint, text, uuid) from public;
revoke execute on function review_queue(uuid) from public;

grant execute on function refundable_remaining(uuid) to authenticated;
grant execute on function post_refund(uuid, uuid, bigint, text, uuid) to authenticated;
grant execute on function review_queue(uuid) to authenticated;
