-- pgTAP tests for the P1 posting RPCs (supabase/migrations/0002_posting_rpcs.sql).
-- Run with: pnpm db:test
-- Covers the rules from docs/06 and docs/07 section 1: role checks, positive amounts,
-- idempotent retries, balanced entries and reversal-not-edit corrections.

begin;
select plan(20);

-- ------------------------------------------------------------------ Fixtures
-- Two businesses and three users: an owner, a staff member with the posting toggle on,
-- a staff member with it off, plus an outsider who belongs to neither business.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','owner@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002','staff-allowed@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000003','staff-blocked@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000004','outsider@test.local');

insert into businesses (id, type, name, category) values
  ('bbbbbbbb-0000-0000-0000-000000000001','MERCHANT','Test Shop','grocery');

select seed_accounts('bbbbbbbb-0000-0000-0000-000000000001','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
   'merchant_owner','{}'),
  ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001',
   'staff','{"can_add_entries": true}'),
  ('aaaaaaaa-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001',
   'staff','{}');

-- Act as the owner for the happy-path cases.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- ------------------------------------------------------------------ 1. Cash sale posts
select lives_ok(
  $$ select post_cash_sale(
       'bbbbbbbb-0000-0000-0000-000000000001', 12000,
       'cccccccc-0000-0000-0000-000000000001', 'grocery', 'first sale') $$,
  'owner can post a cash sale'
);

select is(
  (select count(*)::int from transactions
    where business_id = 'bbbbbbbb-0000-0000-0000-000000000001' and kind = 'CASH_SALE'),
  1,
  'cash sale created exactly one transaction'
);

select is(
  (select source from transactions where client_uuid = 'cccccccc-0000-0000-0000-000000000001'),
  'manual',
  'a hand-entered cash sale is marked manual, not verified'
);

-- The entry must balance and hit the accounts from the docs/06 posting map.
select is(
  (select (sum(l.debit_minor) - sum(l.credit_minor))::bigint
     from journal_lines l
     join journal_entries e on e.id = l.entry_id
     join transactions t on t.id = e.transaction_id
    where t.client_uuid = 'cccccccc-0000-0000-0000-000000000001'),
  0::bigint,
  'cash sale entry balances (debits = credits)'
);

select is(
  (select l.debit_minor from journal_lines l
     join accounts a on a.id = l.account_id
     join journal_entries e on e.id = l.entry_id
     join transactions t on t.id = e.transaction_id
    where t.client_uuid = 'cccccccc-0000-0000-0000-000000000001' and a.code = '1000'),
  12000::bigint,
  'cash drawer 1000 is debited by the sale amount'
);

select is(
  (select l.credit_minor from journal_lines l
     join accounts a on a.id = l.account_id
     join journal_entries e on e.id = l.entry_id
     join transactions t on t.id = e.transaction_id
    where t.client_uuid = 'cccccccc-0000-0000-0000-000000000001' and a.code = '4000'),
  12000::bigint,
  'sales 4000 is credited by the sale amount'
);

-- ------------------------------------------------------------------ 2. Idempotency
select is(
  (select post_cash_sale(
     'bbbbbbbb-0000-0000-0000-000000000001', 12000,
     'cccccccc-0000-0000-0000-000000000001', 'grocery', 'first sale') ->> 'replayed'),
  'true',
  'retrying the same client_uuid and body replays the first response'
);

select is(
  (select count(*)::int from transactions
    where business_id = 'bbbbbbbb-0000-0000-0000-000000000001' and kind = 'CASH_SALE'),
  1,
  'a replay does not post a second transaction'
);

select throws_ok(
  $$ select post_cash_sale(
       'bbbbbbbb-0000-0000-0000-000000000001', 99900,
       'cccccccc-0000-0000-0000-000000000001', 'grocery', 'different body') $$,
  '23505',
  null,
  'the same key with a different body is rejected, not silently replayed'
);

-- ------------------------------------------------------------------ 3. Amount guard
select throws_ok(
  $$ select post_cash_sale(
       'bbbbbbbb-0000-0000-0000-000000000001', 0,
       'cccccccc-0000-0000-0000-000000000009') $$,
  '22023',
  null,
  'a zero amount is rejected'
);

select throws_ok(
  $$ select post_cash_sale(
       'bbbbbbbb-0000-0000-0000-000000000001', -500,
       'cccccccc-0000-0000-0000-00000000000a') $$,
  '22023',
  null,
  'a negative amount is rejected'
);

-- ------------------------------------------------------------------ 4. Expense
select lives_ok(
  $$ select post_expense(
       'bbbbbbbb-0000-0000-0000-000000000001', 3000,
       'cccccccc-0000-0000-0000-000000000002', 'wallet', 'rent') $$,
  'owner can post an expense paid from the wallet'
);

select throws_ok(
  $$ select post_expense(
       'bbbbbbbb-0000-0000-0000-000000000001', 3000,
       'cccccccc-0000-0000-0000-00000000000b', 'bkash') $$,
  '22023',
  null,
  'an unknown paid_from is rejected'
);

-- ------------------------------------------------------------------ 5. Reversal
-- A reversal is a sensitive action (Phase D): open a reauth window first, as the app does
-- after the owner confirms on the device. One window covers the owner's reversals below.
select request_reauth();
select lives_ok(
  $$ select reverse_transaction(
       'bbbbbbbb-0000-0000-0000-000000000001',
       (select id from transactions where client_uuid = 'cccccccc-0000-0000-0000-000000000001'),
       'cccccccc-0000-0000-0000-000000000003',
       'wrong amount entered') $$,
  'owner can reverse a posted transaction with a reason'
);

-- After the mirror entry the account nets to zero again.
select is(
  (select coalesce(sum(l.debit_minor) - sum(l.credit_minor), 0)::bigint
     from journal_lines l
     join accounts a on a.id = l.account_id
    where a.business_id = 'bbbbbbbb-0000-0000-0000-000000000001' and a.code = '4000'),
  0::bigint,
  'reversal mirrors the original so sales nets back to zero'
);

select throws_ok(
  $$ select reverse_transaction(
       'bbbbbbbb-0000-0000-0000-000000000001',
       (select id from transactions where client_uuid = 'cccccccc-0000-0000-0000-000000000001'),
       'cccccccc-0000-0000-0000-000000000004',
       'again') $$,
  '23505',
  null,
  'a transaction cannot be reversed twice'
);

-- ------------------------------------------------------------------ 6. Role checks
-- Staff with the owner-granted toggle may post.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ select post_cash_sale(
       'bbbbbbbb-0000-0000-0000-000000000001', 5000,
       'cccccccc-0000-0000-0000-000000000005') $$,
  'staff with can_add_entries may post a cash sale'
);

select throws_ok(
  $$ select reverse_transaction(
       'bbbbbbbb-0000-0000-0000-000000000001',
       (select id from transactions where client_uuid = 'cccccccc-0000-0000-0000-000000000005'),
       'cccccccc-0000-0000-0000-000000000006',
       'staff should not be able to do this') $$,
  '42501',
  null,
  'staff cannot reverse an entry even with the posting toggle'
);

-- Staff without the toggle may not.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select post_cash_sale(
       'bbbbbbbb-0000-0000-0000-000000000001', 5000,
       'cccccccc-0000-0000-0000-000000000007') $$,
  '42501',
  null,
  'staff without can_add_entries cannot post'
);

-- A user with no membership cannot post, even knowing the business_id.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ select post_cash_sale(
       'bbbbbbbb-0000-0000-0000-000000000001', 5000,
       'cccccccc-0000-0000-0000-000000000008') $$,
  '42501',
  null,
  'a non-member cannot post by passing someone else business_id'
);

select * from finish();
rollback;
