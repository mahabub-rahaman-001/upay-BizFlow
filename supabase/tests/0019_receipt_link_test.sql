-- pgTAP tests for get_receipt_link (Phase B2, migration 20261003150000).
-- Run with: pnpm db:test

begin;
select plan(4);

insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001','rl-owner@test.local'),
  ('f3000000-0000-0000-0000-000000000002','rl-outsider@test.local');

insert into businesses (id, type, name, category, upay_account_ref) values
  ('f4000000-0000-0000-0000-000000000001','MERCHANT','Receipt Shop','grocery','M-RL-1');
select seed_accounts('f4000000-0000-0000-0000-000000000001','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('f3000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','merchant_owner','{}');

-- A settled QR payment gets a receipt; a cash sale does not.
select ingest_payment_event('upay', jsonb_build_object(
  'event_type','payment.succeeded','provider_txn_id','RL-PAY-1','account_ref','M-RL-1',
  'amount_minor',85000,'occurred_at', now(),'settlement', jsonb_build_object('status','settled')));

set local role authenticated;
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-000000000001","role":"authenticated"}';
select post_cash_sale('f4000000-0000-0000-0000-000000000001', 12000, gen_random_uuid());

select is(
  (get_receipt_link('f4000000-0000-0000-0000-000000000001',
     (select t.id from transactions t join payment_events e on e.id = t.payment_event_id
       where e.provider_txn_id = 'RL-PAY-1')) ->> 'has_receipt'),
  'true',
  'a QR payment has a shareable receipt');

select is(
  (get_receipt_link('f4000000-0000-0000-0000-000000000001',
     (select id from transactions where kind = 'CASH_SALE')) ->> 'has_receipt'),
  'false',
  'a cash sale has no receipt to share');

select isnt(
  (get_receipt_link('f4000000-0000-0000-0000-000000000001',
     (select t.id from transactions t join payment_events e on e.id = t.payment_event_id
       where e.provider_txn_id = 'RL-PAY-1')) ->> 'token'),
  null,
  'the receipt token is returned for sharing');

-- A non-member cannot fish for another business's receipt tokens.
set local request.jwt.claims = '{"sub":"f3000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select get_receipt_link('f4000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000000') $$,
  '42501', null,
  'a non-member cannot read receipt links');

select * from finish();
rollback;
