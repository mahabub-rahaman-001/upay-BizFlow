-- pgTAP tests for the merchant books (supabase/migrations/0006_books_baki_closing.sql).
-- Run with: pnpm db:test
--
-- Baki is derived from the ledger rather than stored, so these check that a credit sale
-- and a collection move the balance the way a shopkeeper would expect, and that the
-- closing puts any difference on the books instead of quietly absorbing it.

begin;
select plan(16);

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001','books-owner@test.local'),
  ('eeeeeeee-0000-0000-0000-000000000002','books-staff@test.local');

insert into businesses (id, type, name, category) values
  ('ffffffff-0000-0000-0000-000000000001','MERCHANT','Books Shop','grocery');

select seed_accounts('ffffffff-0000-0000-0000-000000000001','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('eeeeeeee-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000001',
   'merchant_owner','{}'),
  ('eeeeeeee-0000-0000-0000-000000000002','ffffffff-0000-0000-0000-000000000001',
   'staff','{"can_add_entries": true}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated"}';

-- ------------------------------------------------------------------ 1. Customers
select lives_ok(
  $$ select create_customer('ffffffff-0000-0000-0000-000000000001','Rahima','01712345678', true) $$,
  'owner can add a customer'
);

select is(
  (select phone_last4 from customers where business_id = 'ffffffff-0000-0000-0000-000000000001'),
  '5678',
  'only the last four digits are exposed for list display'
);

select is(
  (select balance_minor from customer_balances('ffffffff-0000-0000-0000-000000000001')),
  0::bigint,
  'a new customer owes nothing'
);

-- ------------------------------------------------------------------ 2. Baki given
select lives_ok(
  $$ select post_baki_sale(
       'ffffffff-0000-0000-0000-000000000001', 30000,
       '11110000-0000-0000-0000-000000000001',
       (select id from customers where name = 'Rahima'),
       'rice and oil') $$,
  'a credit sale posts'
);

select is(
  (select balance_minor from customer_balances('ffffffff-0000-0000-0000-000000000001')),
  30000::bigint,
  'the customer now owes the credit sale amount'
);

select is(
  (select l.debit_minor from journal_lines l
     join accounts a on a.id = l.account_id
     join journal_entries je on je.id = l.entry_id
     join transactions t on t.id = je.transaction_id
    where t.client_uuid = '11110000-0000-0000-0000-000000000001' and a.code = '1100'),
  30000::bigint,
  'a credit sale debits baki receivable 1100, not the drawer'
);

-- ------------------------------------------------------------------ 3. Baki collected
select lives_ok(
  $$ select post_baki_collection(
       'ffffffff-0000-0000-0000-000000000001', 20000,
       '11110000-0000-0000-0000-000000000002',
       (select id from customers where name = 'Rahima'),
       'cash') $$,
  'a partial collection posts'
);

select is(
  (select balance_minor from customer_balances('ffffffff-0000-0000-0000-000000000001')),
  10000::bigint,
  'the outstanding balance drops by what was collected'
);

select throws_ok(
  $$ select post_baki_collection(
       'ffffffff-0000-0000-0000-000000000001', 99000,
       '11110000-0000-0000-0000-000000000003',
       (select id from customers where name = 'Rahima'),
       'cash') $$,
  '22023',
  null,
  'collecting more than is owed is rejected'
);

-- ------------------------------------------------------------------ 4. Closing preview
-- The drawer has only the 20000 poisha collected in cash so far.
select is(
  (closing_preview('ffffffff-0000-0000-0000-000000000001') ->> 'expected_cash_minor')::bigint,
  20000::bigint,
  'expected drawer cash is the running balance of account 1000'
);

select is(
  (closing_preview('ffffffff-0000-0000-0000-000000000001') ->> 'already_closed'),
  'false',
  'the day is not closed yet'
);

-- ------------------------------------------------------------------ 5. Closing with a shortage
-- Counted 19700 against an expected 20000: three taka short.
select lives_ok(
  $$ select post_closing(
       'ffffffff-0000-0000-0000-000000000001', 19700,
       '11110000-0000-0000-0000-000000000004', null, 'wrong change given') $$,
  'the owner can close the day'
);

select is(
  (select variance_minor from daily_closings
    where business_id = 'ffffffff-0000-0000-0000-000000000001'),
  -300::bigint,
  'the variance is counted minus expected'
);

-- After closing, the drawer account agrees with what was actually counted.
select is(
  (select coalesce(sum(l.debit_minor) - sum(l.credit_minor), 0)::bigint
     from journal_lines l
     join accounts a on a.id = l.account_id
    where a.business_id = 'ffffffff-0000-0000-0000-000000000001' and a.code = '1000'),
  19700::bigint,
  'the shortage is posted so the drawer account equals the counted cash'
);

select throws_ok(
  $$ select post_closing(
       'ffffffff-0000-0000-0000-000000000001', 19700,
       '11110000-0000-0000-0000-000000000005') $$,
  '23505',
  null,
  'a closed day cannot be closed twice without reopening'
);

-- ------------------------------------------------------------------ 6. Role check
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select post_closing(
       'ffffffff-0000-0000-0000-000000000001', 19700,
       '11110000-0000-0000-0000-000000000006') $$,
  '42501',
  null,
  'staff cannot close the business day'
);

select * from finish();
rollback;
