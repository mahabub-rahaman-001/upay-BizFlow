-- pgTAP tests for 8.1 risk overview, 8.2 audit CSV export, 8.3 business overview, 8.4 SLA metrics.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001','admin-risk@upay.test'),
  ('f1000000-0000-0000-0000-000000000002','support-risk@upay.test'),
  ('f1000000-0000-0000-0000-000000000003','user-risk@upay.test');

insert into businesses (id, type, name, category) values
  ('fb000000-0000-0000-0000-000000000001','MERCHANT','Risk Mart','grocery');
select seed_accounts('fb000000-0000-0000-0000-000000000001','MERCHANT');

insert into admin_accounts (user_id, role, demo_access) values
  ('f1000000-0000-0000-0000-000000000001','upay_admin', true),
  ('f1000000-0000-0000-0000-000000000002','upay_support', true);

-- ------------------------------------------------------------------ 1. Non-admin is refused
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$ select admin_risk_overview() $$, '42501', null,
  'non-admin cannot read risk overview');
select throws_ok($$ select admin_audit_export_csv(100) $$, '42501', null,
  'non-admin cannot export audit csv');
select throws_ok($$ select admin_business_overview('fb000000-0000-0000-0000-000000000001') $$, '42501', null,
  'non-admin cannot read business overview');

-- ------------------------------------------------------------------ 2. Support role is refused
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$ select admin_risk_overview() $$, '42501', null,
  'upay_support cannot read risk overview');
select throws_ok($$ select admin_audit_export_csv(100) $$, '42501', null,
  'upay_support cannot export audit csv');
select throws_ok($$ select admin_business_overview('fb000000-0000-0000-0000-000000000001') $$, '42501', null,
  'upay_support cannot read business overview');

-- ------------------------------------------------------------------ 3. upay_admin is allowed
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$ select admin_risk_overview() $$,
  'upay_admin can read risk overview');

-- 8.2: CSV export returns valid header and RFC-compliant rows
select ok((select admin_audit_export_csv(10)) like 'id,actor,action,reason,detail,created_at_dhaka%',
  'admin_audit_export_csv returns expected CSV header');

-- 8.2: Self-auditing: calling export logs an event in admin_audit_events
select is(
  (select count(*)::int from admin_audit_events where action = 'audit.csv_exported' and actor = 'f1000000-0000-0000-0000-000000000001'),
  1,
  'export action is recorded in audit log');

-- 8.3: Business overview returns business JSON
select is(
  (select admin_business_overview('fb000000-0000-0000-0000-000000000001') -> 'business' ->> 'name'),
  'Risk Mart',
  'admin_business_overview returns correct business details');

-- 8.4: admin_dashboard includes SLA metrics
select ok(
  (select (admin_dashboard() -> 'sla') is not null),
  'admin_dashboard includes sla metrics object');

select ok(
  (select (admin_dashboard() -> 'sla' ? 'open_count') and (admin_dashboard() -> 'sla' ? 'overdue_count')),
  'admin_dashboard sla object includes open_count and overdue_count');

select * from finish();
rollback;
