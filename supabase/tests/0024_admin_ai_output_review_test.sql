-- pgTAP tests for 8.5: AI output review and wrong-mark feedback.
begin;
select plan(11);

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001','admin-ai@upay.test'),
  ('a1000000-0000-0000-0000-000000000002','support-ai@upay.test'),
  ('a1000000-0000-0000-0000-000000000003','user-ai@upay.test');

insert into businesses (id, type, name, category) values
  ('ab000000-0000-0000-0000-000000000001','MERCHANT','AI Shop','grocery');
select seed_accounts('ab000000-0000-0000-0000-000000000001','MERCHANT');

insert into admin_accounts (user_id, role, demo_access) values
  ('a1000000-0000-0000-0000-000000000001','upay_admin', true),
  ('a1000000-0000-0000-0000-000000000002','upay_support', true);

-- Insert a test AI output
insert into ai_outputs (
  id, business_id, capability, what_en, what_bn, why_en, why_bn, action_en, action_bn,
  confidence, payload, model_version, created_at
) values (
  'a5000000-0000-0000-0000-000000000001',
  'ab000000-0000-0000-0000-000000000001',
  'sales_forecast',
  'Sales forecast for next week',
  'পরবর্তী সপ্তাহের বিক্রির পূর্বাভাস',
  'High recent volume',
  'সাম্প্রতিক উচ্চ লেনদেন',
  'Check inventory',
  'মজুদ পরীক্ষা করুন',
  'high',
  '{"facts":{"sales_7d":50000}}'::jsonb,
  'v1.0',
  now()
);

-- ------------------------------------------------------------------ 1. Non-admin is refused
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$ select admin_ai_outputs(10) $$, '42501', null,
  'non-admin cannot read ai outputs');
select throws_ok(
  $$ select admin_command('mark_ai_wrong',
       jsonb_build_object('output_id','a5000000-0000-0000-0000-000000000001','reason','incorrect projection'),
       '90000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'non-admin cannot mark ai output wrong');

-- ------------------------------------------------------------------ 2. Support role is refused
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$ select admin_ai_outputs(10) $$, '42501', null,
  'upay_support cannot read ai outputs');
select throws_ok(
  $$ select admin_command('mark_ai_wrong',
       jsonb_build_object('output_id','a5000000-0000-0000-0000-000000000001','reason','incorrect projection'),
       '90000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'upay_support cannot mark ai output wrong');

-- ------------------------------------------------------------------ 3. Core content is immutable (append-only)
select throws_ok(
  $$ update ai_outputs set what_en = 'mutated' where id = 'a5000000-0000-0000-0000-000000000001' $$,
  'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.',
  'ai_outputs content columns cannot be mutated');
select throws_ok(
  $$ delete from ai_outputs where id = 'a5000000-0000-0000-0000-000000000001' $$,
  'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.',
  'ai_outputs cannot be deleted');

-- ------------------------------------------------------------------ 4. upay_admin can read ai outputs
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select (admin_ai_outputs(10) -> 0 ->> 'business_name')),
  'AI Shop',
  'upay_admin can read ai outputs with business join');

-- ------------------------------------------------------------------ 5. upay_admin can mark output wrong
select is(
  (admin_command('mark_ai_wrong',
     jsonb_build_object('output_id','a5000000-0000-0000-0000-000000000001','reason','unrealistic spikes'),
     '90000000-0000-0000-0000-000000000001') ->> 'feedback'),
  'wrong',
  'mark_ai_wrong marks feedback as wrong');

-- Feedback updated on row
select is(
  (select feedback from ai_outputs where id = 'a5000000-0000-0000-0000-000000000001'),
  'wrong',
  'ai_outputs feedback column is updated to wrong');

-- Action is audited in admin_audit_events
select is(
  (select count(*)::int from admin_audit_events where action = 'mark_ai_wrong' and actor = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'mark_ai_wrong is recorded in audit log');

-- Idempotency: replaying same request id returns original result without duplicate audit row
select lives_ok(
  $$ select admin_command('mark_ai_wrong',
       jsonb_build_object('output_id','a5000000-0000-0000-0000-000000000001','reason','unrealistic spikes'),
       '90000000-0000-0000-0000-000000000001') $$,
  'idempotent replay of mark_ai_wrong is accepted');

select * from finish();
rollback;
