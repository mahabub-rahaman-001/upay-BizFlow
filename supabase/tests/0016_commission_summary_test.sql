-- pgTAP tests for commission_summary (Phase A1, migration 20261003120000).
-- Run with: pnpm db:test

begin;
select plan(6);

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001','comm-agent@test.local'),
  ('c1000000-0000-0000-0000-000000000002','comm-merch@test.local');

insert into businesses (id, type, name, category, upay_account_ref) values
  ('c2000000-0000-0000-0000-000000000001','AGENT','Comm Agent','agent','A-COMM-1'),
  ('c2000000-0000-0000-0000-000000000002','MERCHANT','Comm Shop','grocery','M-COMM-1');
select seed_accounts('c2000000-0000-0000-0000-000000000001','AGENT');
select seed_accounts('c2000000-0000-0000-0000-000000000002','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('c1000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','agent_owner','{}'),
  ('c1000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000002','merchant_owner','{}');

-- Two commission transactions today, one three days ago.
insert into transactions (business_id, kind, source, amount_minor, actor_user_id, occurred_at) values
  ('c2000000-0000-0000-0000-000000000001','AGENT_COMMISSION','verified', 3000,
   '00000000-0000-0000-0000-000000000000', now()),
  ('c2000000-0000-0000-0000-000000000001','AGENT_COMMISSION','verified', 2000,
   '00000000-0000-0000-0000-000000000000', now()),
  ('c2000000-0000-0000-0000-000000000001','AGENT_COMMISSION','verified', 5000,
   '00000000-0000-0000-0000-000000000000', now() - interval '3 days');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (commission_summary('c2000000-0000-0000-0000-000000000001') ->> 'today_minor')::bigint,
  5000::bigint,
  'today total is the sum of today''s commission');

select is(
  (commission_summary('c2000000-0000-0000-0000-000000000001') ->> 'count_today')::int,
  2,
  'today count is the number of commission transactions today');

select is(
  (commission_summary('c2000000-0000-0000-0000-000000000001') ->> 'week_minor')::bigint,
  10000::bigint,
  'the week total includes the earlier commission within 7 days');

select is(
  jsonb_array_length(commission_summary('c2000000-0000-0000-0000-000000000001') -> 'by_day'),
  7,
  'the breakdown has one entry per day for the last 7 days');

-- ------------------------------------------------------------------ Role and type
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select commission_summary('c2000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'a merchant business has no commission statement');

select throws_ok(
  $$ select commission_summary('c2000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a non-member cannot read the agent commission statement');

select * from finish();
rollback;
