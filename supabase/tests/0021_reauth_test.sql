-- pgTAP tests for re-authentication (Phase D, migration 20261003160000_reauth.sql).
-- Run with: pnpm db:test
--
-- A sensitive action is refused until the caller has opened a reauth window, and the window
-- is per user, so one person's reauth does not let another act.

begin;
select plan(5);

insert into auth.users (id, email) values
  ('a9000000-0000-0000-0000-000000000001','reauth-owner@test.local'),
  ('a9000000-0000-0000-0000-000000000002','reauth-other@test.local');

insert into businesses (id, type, name, category, upay_account_ref) values
  ('b9000000-0000-0000-0000-000000000001','MERCHANT','Reauth Shop','grocery','M-RA-1');
select seed_accounts('b9000000-0000-0000-0000-000000000001','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('a9000000-0000-0000-0000-000000000001','b9000000-0000-0000-0000-000000000001','merchant_owner','{}'),
  ('a9000000-0000-0000-0000-000000000002','b9000000-0000-0000-0000-000000000001','merchant_owner','{}');

-- A settled QR payment to refund against.
select ingest_payment_event('upay', jsonb_build_object(
  'event_type','payment.succeeded','provider_txn_id','RA-PAY-1','account_ref','M-RA-1',
  'amount_minor', 100000, 'occurred_at', now(),'settlement', jsonb_build_object('status','settled')));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ------------------------------------------------------------------ 1. Refused without reauth
select throws_ok(
  $$ select post_refund('b9000000-0000-0000-0000-000000000001',
       (select t.id from transactions t join payment_events e on e.id = t.payment_event_id
         where e.provider_txn_id = 'RA-PAY-1'),
       10000, 'no reauth yet', gen_random_uuid()) $$,
  '42501', null,
  'a refund is refused before the owner re-authenticates');

-- ------------------------------------------------------------------ 2. request_reauth opens a window
select ok(
  (request_reauth() ->> 'valid_until')::timestamptz > now(),
  'request_reauth returns a future expiry');

select ok(
  exists (select 1 from reauth_sessions
           where user_id = 'a9000000-0000-0000-0000-000000000001' and valid_until > now()),
  'the reauth window is recorded for the caller');

-- ------------------------------------------------------------------ 3. Now the refund is allowed
select is(
  (post_refund('b9000000-0000-0000-0000-000000000001',
     (select t.id from transactions t join payment_events e on e.id = t.payment_event_id
       where e.provider_txn_id = 'RA-PAY-1'),
     10000, 'after reauth', gen_random_uuid()) ->> 'status'),
  'SUCCEEDED',
  'with an open reauth window the refund succeeds');

-- ------------------------------------------------------------------ 4. Another user's window does not help
-- The owner above has a window; a different owner of the same shop does not.
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select post_refund('b9000000-0000-0000-0000-000000000001',
       (select t.id from transactions t join payment_events e on e.id = t.payment_event_id
         where e.provider_txn_id = 'RA-PAY-1'),
       10000, 'other owner', gen_random_uuid()) $$,
  '42501', null,
  'a reauth window is per user: another owner still must re-authenticate');

select * from finish();
rollback;
