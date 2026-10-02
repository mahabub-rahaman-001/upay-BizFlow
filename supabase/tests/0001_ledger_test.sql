-- pgTAP tests for the ledger invariants. Run with: supabase test db
-- These assert the append-only and balanced-entry rules from docs/06.

begin;
select plan(3);

-- Setup a business + accounts
insert into businesses (id, type, name, category)
values ('33333333-3333-3333-3333-333333333333','MERCHANT','Test Shop','grocery');
select seed_accounts('33333333-3333-3333-3333-333333333333','MERCHANT');

-- 1) UPDATE on transactions is blocked
insert into transactions (id, business_id, kind, source, amount_minor, actor_user_id, occurred_at)
values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',
        'CASH_SALE','verified',12000,'00000000-0000-0000-0000-000000000000', now());

select throws_ok(
  $$ update transactions set note='x' where id='44444444-4444-4444-4444-444444444444' $$,
  'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.',
  'transactions cannot be updated'
);

-- 2) DELETE on transactions is blocked
select throws_ok(
  $$ delete from transactions where id='44444444-4444-4444-4444-444444444444' $$,
  'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.',
  'transactions cannot be deleted'
);

-- 3) An unbalanced journal entry is rejected at commit.
-- The balance trigger is DEFERRABLE INITIALLY DEFERRED on purpose (docs/06: the sides must
-- match "at COMMIT"), because a balanced entry is written one line at a time and would
-- otherwise fail on its first line. This test therefore has to reach the commit point:
-- SET CONSTRAINTS ALL IMMEDIATE fires the deferred trigger now, inside the test
-- transaction, so the rollback at the end of the file does not swallow the check.
create function _test_post_unbalanced() returns void
language plpgsql as $$
declare
  v_entry_id uuid;
begin
  insert into journal_entries (business_id, transaction_id)
  values ('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444')
  returning id into v_entry_id;

  insert into journal_lines (entry_id, business_id, account_id, debit_minor, credit_minor)
  values (v_entry_id, '33333333-3333-3333-3333-333333333333',
          (select id from accounts
            where business_id = '33333333-3333-3333-3333-333333333333' and code = '1000'),
          12000, 0);

  set constraints all immediate;
end $$;

select throws_ok(
  $$ select _test_post_unbalanced() $$,
  NULL,
  'unbalanced entry (debit without matching credit) is rejected'
);

select * from finish();
rollback;
