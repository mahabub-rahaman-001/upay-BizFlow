-- pgTAP tests for suppliers and payables (supabase/migrations/0011_suppliers_payables.sql).
-- Run with: pnpm db:test

begin;
select plan(14);

insert into auth.users (id, email) values
  ('aaaa1111-0000-0000-0000-000000000001','pay-owner@test.local'),
  ('aaaa1111-0000-0000-0000-000000000002','pay-staff@test.local');

insert into businesses (id, type, name, category) values
  ('bbbb1111-0000-0000-0000-000000000001','MERCHANT','Payable Shop','grocery');

select seed_accounts('bbbb1111-0000-0000-0000-000000000001','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('aaaa1111-0000-0000-0000-000000000001','bbbb1111-0000-0000-0000-000000000001','merchant_owner','{}'),
  ('aaaa1111-0000-0000-0000-000000000002','bbbb1111-0000-0000-0000-000000000001','staff','{"can_add_entries":true}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa1111-0000-0000-0000-000000000001","role":"authenticated"}';

-- ------------------------------------------------------------------ 1. Supplier
select lives_ok(
  $$ select create_supplier('bbbb1111-0000-0000-0000-000000000001','Rahman Traders','01911112222','grocery','weekly') $$,
  'owner can add a supplier'
);

-- ------------------------------------------------------------------ 2. Confirm posts the purchase
select lives_ok(
  $$ select create_payable('bbbb1111-0000-0000-0000-000000000001',
       (select id from suppliers where name='Rahman Traders'),
       1500000, current_date + 2, 'INV-9001') $$,
  'owner can create and confirm a payable'
);

select is(
  (select status from supplier_payables),
  'CONFIRMED',
  'a payable created with confirm is CONFIRMED'
);

-- Confirm posts 5000 Purchases debit / 2000 Payable credit.
select is(
  (select coalesce(sum(credit_minor) - sum(debit_minor), 0)::bigint
     from journal_lines jl join accounts a on a.id = jl.account_id
    where a.business_id = 'bbbb1111-0000-0000-0000-000000000001' and a.code = '2000'),
  1500000::bigint,
  'confirming a payable credits supplier payable 2000'
);

-- ------------------------------------------------------------------ 3. Part payment
select is(
  (pay_payable('bbbb1111-0000-0000-0000-000000000001',
     (select id from supplier_payables), 500000, gen_random_uuid(), 'cash') ->> 'status'),
  'PARTIALLY_PAID',
  'a part payment leaves the payable partially paid'
);

select is(
  (select amount_remaining_minor from supplier_payables),
  1000000::bigint,
  'the remaining balance drops by what was paid'
);

-- The liability is now Tk 10,000, matching the remaining balance.
select is(
  (select coalesce(sum(credit_minor) - sum(debit_minor), 0)::bigint
     from journal_lines jl join accounts a on a.id = jl.account_id
    where a.business_id = 'bbbb1111-0000-0000-0000-000000000001' and a.code = '2000'),
  1000000::bigint,
  'account 2000 equals the remaining payable after a part payment'
);

-- ------------------------------------------------------------------ 4. Overpay guard
select throws_ok(
  $$ select pay_payable('bbbb1111-0000-0000-0000-000000000001',
       (select id from supplier_payables), 9900000, gen_random_uuid(), 'cash') $$,
  '22023',
  null,
  'paying more than remains is rejected'
);

-- ------------------------------------------------------------------ 5. Pay the rest
select is(
  (pay_payable('bbbb1111-0000-0000-0000-000000000001',
     (select id from supplier_payables), 1000000, gen_random_uuid(), 'wallet') ->> 'status'),
  'PAID',
  'paying the remainder marks the payable paid'
);

select is(
  (select coalesce(sum(credit_minor) - sum(debit_minor), 0)::bigint
     from journal_lines jl join accounts a on a.id = jl.account_id
    where a.business_id = 'bbbb1111-0000-0000-0000-000000000001' and a.code = '2000'),
  0::bigint,
  'the liability is cleared once the payable is fully paid'
);

select throws_ok(
  $$ select pay_payable('bbbb1111-0000-0000-0000-000000000001',
       (select id from supplier_payables), 100, gen_random_uuid(), 'cash') $$,
  '22023',
  null,
  'a paid payable cannot take another payment'
);

-- ------------------------------------------------------------------ 6. Cancel reverses
select lives_ok(
  $$ select create_payable('bbbb1111-0000-0000-0000-000000000001',
       (select id from suppliers where name='Rahman Traders'),
       700000, current_date + 5, 'INV-9002') $$,
  'a second payable is created and confirmed'
);

-- Cancelling a confirmed payable reverses its purchase posting, which is a sensitive action
-- (Phase D), so open a reauth window first.
select request_reauth();
select is(
  (cancel_payable('bbbb1111-0000-0000-0000-000000000001',
     (select id from supplier_payables where invoice_ref = 'INV-9002'),
     'wrong supplier') ->> 'status'),
  'CANCELLED',
  'a confirmed unpaid payable can be cancelled'
);

-- ------------------------------------------------------------------ 7. Role check
set local request.jwt.claims = '{"sub":"aaaa1111-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select create_supplier('bbbb1111-0000-0000-0000-000000000001','Sneaky Co') $$,
  '42501',
  null,
  'staff cannot manage suppliers'
);

select * from finish();
rollback;
