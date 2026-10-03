-- pgTAP tests for refunds and the review queue (supabase/migrations/0012_refunds_review_queue.sql).
-- Run with: pnpm db:test

begin;
select plan(11);

insert into auth.users (id, email) values
  ('cccc1111-0000-0000-0000-000000000001','refund-owner@test.local'),
  ('cccc1111-0000-0000-0000-000000000002','refund-staff@test.local');

insert into businesses (id, type, name, category, upay_account_ref) values
  ('dddd1111-0000-0000-0000-000000000001','MERCHANT','Refund Shop','grocery','M-REF-001');

select seed_accounts('dddd1111-0000-0000-0000-000000000001','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('cccc1111-0000-0000-0000-000000000001','dddd1111-0000-0000-0000-000000000001','merchant_owner','{}'),
  ('cccc1111-0000-0000-0000-000000000002','dddd1111-0000-0000-0000-000000000001','staff','{"can_add_entries":true}');

-- A settled QR payment of Tk 1,000 to refund against.
select ingest_payment_event('upay', jsonb_build_object(
  'event_type','payment.succeeded', 'provider_txn_id','REF-PAY-1',
  'account_ref','M-REF-001', 'amount_minor', 100000, 'occurred_at', now(),
  'settlement', jsonb_build_object('status','settled')));

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccc1111-0000-0000-0000-000000000001","role":"authenticated"}';

-- ------------------------------------------------------------------ 1. Refundable amount
select is(
  refundable_remaining((select t.id from transactions t
    join payment_events e on e.id = t.payment_event_id where e.provider_txn_id = 'REF-PAY-1')),
  100000::bigint,
  'the full amount is refundable before any refund'
);

-- A refund is a sensitive action (Phase D): open a reauth window first. One window covers
-- the owner's refunds below (now() is fixed within this test transaction).
select request_reauth();

-- ------------------------------------------------------------------ 2. Partial refund
select is(
  (post_refund('dddd1111-0000-0000-0000-000000000001',
     (select t.id from transactions t join payment_events e on e.id = t.payment_event_id
       where e.provider_txn_id = 'REF-PAY-1'),
     30000, 'customer returned item', gen_random_uuid()) ->> 'status'),
  'SUCCEEDED',
  'a partial refund succeeds'
);

select is(
  refundable_remaining((select t.id from transactions t
    join payment_events e on e.id = t.payment_event_id where e.provider_txn_id = 'REF-PAY-1')),
  70000::bigint,
  'the refundable amount drops by what was refunded'
);

-- The refund posts 4010 Returns debit / 1010 wallet credit.
select is(
  (select coalesce(sum(debit_minor) - sum(credit_minor), 0)::bigint
     from journal_lines jl join accounts a on a.id = jl.account_id
    where a.business_id = 'dddd1111-0000-0000-0000-000000000001' and a.code = '4010'),
  30000::bigint,
  'the refund debits returns 4010'
);

-- ------------------------------------------------------------------ 3. Over-refund guard
select throws_ok(
  $$ select post_refund('dddd1111-0000-0000-0000-000000000001',
       (select t.id from transactions t join payment_events e on e.id = t.payment_event_id
         where e.provider_txn_id = 'REF-PAY-1'),
       90000, 'too much', gen_random_uuid()) $$,
  '22023',
  null,
  'refunding more than remains is rejected'
);

-- ------------------------------------------------------------------ 4. Reason + role
select throws_ok(
  $$ select post_refund('dddd1111-0000-0000-0000-000000000001',
       (select t.id from transactions t join payment_events e on e.id = t.payment_event_id
         where e.provider_txn_id = 'REF-PAY-1'),
       1000, '', gen_random_uuid()) $$,
  '22023',
  null,
  'a refund without a reason is rejected'
);

set local request.jwt.claims = '{"sub":"cccc1111-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select post_refund('dddd1111-0000-0000-0000-000000000001',
       (select t.id from transactions t join payment_events e on e.id = t.payment_event_id
         where e.provider_txn_id = 'REF-PAY-1'),
       1000, 'staff try', gen_random_uuid()) $$,
  '42501',
  null,
  'staff cannot issue a refund'
);

-- ------------------------------------------------------------------ 5. Review queue
-- A large pending payment should surface; a small one should not.
reset role;
select ingest_payment_event('upay', jsonb_build_object(
  'event_type','payment.succeeded', 'provider_txn_id','REF-PENDING-BIG',
  'account_ref','M-REF-001', 'amount_minor', 300000, 'occurred_at', now(),
  'settlement', jsonb_build_object('status','pending')));
select ingest_payment_event('upay', jsonb_build_object(
  'event_type','payment.succeeded', 'provider_txn_id','REF-PENDING-SMALL',
  'account_ref','M-REF-001', 'amount_minor', 5000, 'occurred_at', now(),
  'settlement', jsonb_build_object('status','pending')));

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccc1111-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from review_queue('dddd1111-0000-0000-0000-000000000001')
    where reason_code = 'PENDING_SETTLEMENT'),
  1,
  'only the material pending payment is in the review queue'
);

select is(
  (select amount_minor from review_queue('dddd1111-0000-0000-0000-000000000001')
    where reason_code = 'PENDING_SETTLEMENT'),
  300000::bigint,
  'the queued item is the large pending payment'
);

-- Once it settles, it leaves the queue.
reset role;
select ingest_payment_event('upay', jsonb_build_object(
  'event_type','settlement.completed', 'provider_txn_id','REF-PENDING-BIG',
  'account_ref','M-REF-001', 'amount_minor', 300000, 'occurred_at', now()));

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccc1111-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from review_queue('dddd1111-0000-0000-0000-000000000001')),
  0,
  'a settled payment is no longer in the queue'
);

-- ------------------------------------------------------------------ 6. Review queue role
set local request.jwt.claims = '{"sub":"cccc1111-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select * from review_queue('dddd1111-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'staff cannot see the review queue'
);

select * from finish();
rollback;
