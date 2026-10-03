-- pgTAP tests for the admin console (supabase/migrations/20261002112702_admin_console.sql).
-- Run with: pnpm db:test
--
-- Covers the controls that make privileged access safe: MFA gating, case-scoped access
-- grants, the audit trail, and dual control on feature-flag changes.

begin;
select plan(13);

insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000001','admin-a@upay.test'),
  ('ad000000-0000-0000-0000-000000000002','admin-b@upay.test'),
  ('ad000000-0000-0000-0000-000000000003','support@upay.test'),
  ('ad000000-0000-0000-0000-000000000004','nobody@upay.test');

insert into businesses (id, type, name, category) values
  ('bd000000-0000-0000-0000-000000000001','MERCHANT','Case Shop','grocery');
select seed_accounts('bd000000-0000-0000-0000-000000000001','MERCHANT');

-- Two upay_admins (A and B, both demo so MFA is not required in the test) and one support
-- agent. A non-admin user has no admin_accounts row at all.
-- Admin A is non-demo, so it exercises the MFA gate; B and support are demo.
insert into admin_accounts (user_id, role, demo_access) values
  ('ad000000-0000-0000-0000-000000000001','upay_admin', false),
  ('ad000000-0000-0000-0000-000000000002','upay_admin', true),
  ('ad000000-0000-0000-0000-000000000003','upay_support', true);

insert into support_cases (id, business_id, assigned_to, subject, sla_key, due_at) values
  ('ca000000-0000-0000-0000-000000000001','bd000000-0000-0000-0000-000000000001',
   'ad000000-0000-0000-0000-000000000003','Chargeback on INV-1048','chargeback', now() + interval '7 days');


-- ------------------------------------------------------------------ 1. Non-admin is refused
set local request.jwt.claims = '{"sub":"ad000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$ select admin_session() $$, '42501', null,
  'a user with no admin account cannot open an admin session');

-- ------------------------------------------------------------------ 2. MFA gate
-- Admin A (non-demo) without aal2 is blocked from privileged reads.
set local request.jwt.claims = '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$ select admin_dashboard() $$, '42501', null,
  'an admin without MFA (aal2) is blocked from privileged reads');

-- With aal2 in the token, the same admin is allowed.
set local request.jwt.claims = '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select lives_ok($$ select admin_dashboard() $$,
  'the same admin with aal2 can read the dashboard');

-- ------------------------------------------------------------------ 3. Support session
set local request.jwt.claims = '{"sub":"ad000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((admin_session() ->> 'role'), 'upay_support',
  'the support agent session reports the support role');

-- ------------------------------------------------------------------ 4. Access grant is required before reading a business
select throws_ok(
  $$ select admin_case_transactions('ca000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'reading a case business without an active grant is denied');

-- Grant access through admin_command (reason required, idempotency key required).
select is(
  (admin_command('grant',
     jsonb_build_object('case_id','ca000000-0000-0000-0000-000000000001','reason','reviewing chargeback'),
     '10000000-0000-0000-0000-000000000001') ->> 'expires_at') is not null,
  true,
  'the assigned agent can grant themselves case-scoped access');

select lives_ok(
  $$ select admin_case_transactions('ca000000-0000-0000-0000-000000000001') $$,
  'with an active grant the agent can read the case business');

-- The grant and the read are both written to the access log.
select is(
  (select count(*)::int from access_log where case_id = 'ca000000-0000-0000-0000-000000000001'),
  2,
  'the grant and the subsequent read are both logged');

-- ------------------------------------------------------------------ 5. Idempotency
-- The same request id replays the first result rather than granting twice.
select is(
  (select count(*)::int from admin_access_grants where case_id = 'ca000000-0000-0000-0000-000000000001'),
  1,
  'one grant exists');
select lives_ok(
  $$ select admin_command('grant',
       jsonb_build_object('case_id','ca000000-0000-0000-0000-000000000001','reason','reviewing chargeback'),
       '10000000-0000-0000-0000-000000000001') $$,
  'replaying the same request id is accepted');
select is(
  (select count(*)::int from admin_access_grants where case_id = 'ca000000-0000-0000-0000-000000000001'),
  1,
  'the replay did not create a second grant');

-- ------------------------------------------------------------------ 6. Dual control on flags
-- Admin A proposes turning a global flag off; A cannot approve their own request.
set local request.jwt.claims = '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select admin_command('propose_flag',
  jsonb_build_object('key','ai.forecast','enabled',false,'reason','model drift seen'),
  '20000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ select admin_command('approve_flag',
       jsonb_build_object('id', (select id from admin_flag_requests order by created_at desc limit 1),
                          'reason','self approve'),
       '20000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'the proposing admin cannot approve their own flag change');

-- A second admin approves it, and the global flag flips.
set local request.jwt.claims = '{"sub":"ad000000-0000-0000-0000-000000000002","role":"authenticated"}';
select admin_command('approve_flag',
  jsonb_build_object('id', (select id from admin_flag_requests order by created_at desc limit 1),
                     'reason','confirmed drift'),
  '30000000-0000-0000-0000-000000000001');

select is(
  (select enabled from feature_flags where key = 'ai.forecast' and business_id is null),
  false,
  'a second admin approving the request flips the global flag');

select * from finish();
rollback;
