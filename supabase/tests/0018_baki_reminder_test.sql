-- pgTAP tests for baki_reminder_draft (Phase B1, migration 20261003140000).
-- Run with: pnpm db:test

begin;
select plan(6);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001','rem-merch@test.local'),
  ('e1000000-0000-0000-0000-000000000002','rem-agent@test.local');

insert into businesses (id, type, name, category, upay_account_ref) values
  ('e2000000-0000-0000-0000-000000000001','MERCHANT','Remind Shop','grocery','M-REM-1'),
  ('e2000000-0000-0000-0000-000000000002','AGENT','Remind Agent','agent','A-REM-1');
select seed_accounts('e2000000-0000-0000-0000-000000000001','MERCHANT');
select seed_accounts('e2000000-0000-0000-0000-000000000002','AGENT');

insert into memberships (user_id, business_id, role, permissions) values
  ('e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','merchant_owner','{}'),
  ('e1000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000002','agent_owner','{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Two customers: one consented, one not; give both a baki.
select create_customer('e2000000-0000-0000-0000-000000000001','Consented','01711111111', true);
select create_customer('e2000000-0000-0000-0000-000000000001','NoConsent','01722222222', false);
select post_baki_sale('e2000000-0000-0000-0000-000000000001', 45000, gen_random_uuid(),
  (select id from customers where name='Consented'));
select post_baki_sale('e2000000-0000-0000-0000-000000000001', 30000, gen_random_uuid(),
  (select id from customers where name='NoConsent'));

-- A draft for a consenting customer who owes.
select is(
  (baki_reminder_draft('e2000000-0000-0000-0000-000000000001',
     (select id from customers where name='Consented')) ->> 'balance_minor')::bigint,
  45000::bigint,
  'the draft carries the amount owed from the ledger');

select ok(
  (baki_reminder_draft('e2000000-0000-0000-0000-000000000001',
     (select id from customers where name='Consented')) ->> 'message_bn') like '%Tk 450%',
  'the Bangla message states the amount');

-- No consent -> refused.
select throws_ok(
  $$ select baki_reminder_draft('e2000000-0000-0000-0000-000000000001',
       (select id from customers where name='NoConsent')) $$,
  '22023', null,
  'a customer without consent cannot be drafted a reminder');

-- A consenting customer who owes nothing (collect it all first).
select post_baki_collection('e2000000-0000-0000-0000-000000000001', 45000, gen_random_uuid(),
  (select id from customers where name='Consented'), 'cash');
select throws_ok(
  $$ select baki_reminder_draft('e2000000-0000-0000-0000-000000000001',
       (select id from customers where name='Consented')) $$,
  '22023', null,
  'no reminder is drafted when nothing is owed');

-- ------------------------------------------------------------------ Role and type
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select baki_reminder_draft('e2000000-0000-0000-0000-000000000002',
       '00000000-0000-0000-0000-000000000000') $$,
  '42501', null,
  'an agent business has no baki reminders');

select throws_ok(
  $$ select baki_reminder_draft('e2000000-0000-0000-0000-000000000001',
       (select id from customers where name='NoConsent')) $$,
  '42501', null,
  'a non-member cannot draft a reminder for another business');

select * from finish();
rollback;
