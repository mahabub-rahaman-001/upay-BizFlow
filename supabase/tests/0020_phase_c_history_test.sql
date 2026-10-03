begin;
select plan(13);

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-000000000001', 'c-merchant-owner@test.local'),
  ('c0000000-0000-0000-0000-000000000002', 'c-merchant-staff@test.local'),
  ('c0000000-0000-0000-0000-000000000003', 'c-agent-owner@test.local'),
  ('c0000000-0000-0000-0000-000000000004', 'c-agent-manager@test.local'),
  ('c0000000-0000-0000-0000-000000000005', 'c-outsider@test.local');

insert into businesses (id, type, name, category, upay_account_ref, verified) values
  ('c1000000-0000-0000-0000-000000000001', 'MERCHANT', 'C Shop', 'grocery', 'UPAY-C-SHOP', true),
  ('c1000000-0000-0000-0000-000000000002', 'AGENT', 'C Agent', 'agent', 'UPAY-C-AGENT', true);

insert into memberships (user_id, business_id, role, permissions) values
  ('c0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'merchant_owner', '{}'),
  ('c0000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'staff', '{}'),
  ('c0000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002', 'agent_owner', '{}'),
  ('c0000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000002', 'manager', '{}');

insert into daily_closings (
  id, business_id, period_date, version, status, expected_cash_minor,
  counted_cash_minor, variance_minor, supersedes_id, closed_by
) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '2026-10-01', 1, 'CLOSED', 10000, 9900, -100, null, 'c0000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '2026-10-01', 2, 'REOPENED', 10000, 9900, -100, 'c2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', '2026-10-02', 1, 'CLOSED', 20000, 20200, 200, null, 'c0000000-0000-0000-0000-000000000001');

insert into agent_float_audits (
  id, business_id, period_date, expected_cash_minor, counted_cash_minor,
  cash_variance_minor, expected_upay_minor, actual_upay_minor,
  upay_variance_minor, commission_minor, created_by
) values
  ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '2026-10-01', 50000, 49900, -100, 100000, 100200, 200, 500, 'c0000000-0000-0000-0000-000000000003'),
  ('c3000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', '2026-10-02', 60000, 60000, 0, 120000, 119900, -100, 600, 'c0000000-0000-0000-0000-000000000003');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(me() -> 'businesses' -> 0 ->> 'upay_account_ref', 'UPAY-C-SHOP', 'me exposes the upay reference');
select is((select count(*) from closing_history('c1000000-0000-0000-0000-000000000001')), 3::bigint, 'merchant history returns every version');
select is((select period_date from closing_history('c1000000-0000-0000-0000-000000000001') limit 1), '2026-10-02'::date, 'merchant history is newest first');
select ok((select can_reopen from closing_history('c1000000-0000-0000-0000-000000000001') where closing_id = 'c2000000-0000-0000-0000-000000000003'), 'current owner closing can be reopened');
select is((select count(*) from closing_history('c1000000-0000-0000-0000-000000000001', '2026-10-02', 1)), 2::bigint, 'merchant history cursor returns older versions');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from closing_history('c1000000-0000-0000-0000-000000000001')), 3::bigint, 'merchant staff can read closing history');
select isnt((select bool_or(can_reopen) from closing_history('c1000000-0000-0000-0000-000000000001')), true, 'merchant staff cannot reopen a closing');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_ok($$ select * from closing_history('c1000000-0000-0000-0000-000000000001') $$, '42501', null, 'an outsider cannot read closing history');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from audit_history('c1000000-0000-0000-0000-000000000002')), 2::bigint, 'agent owner can read audit history');
select is((select upay_variance_minor from audit_history('c1000000-0000-0000-0000-000000000002') limit 1), -100::bigint, 'audit history returns saved variance');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*) from audit_history('c1000000-0000-0000-0000-000000000002')), 2::bigint, 'agent manager can read audit history');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$ select * from audit_history('c1000000-0000-0000-0000-000000000002') $$, '42501', null, 'merchant cannot read an agent audit history');

reset role;
select ok(
  not has_function_privilege('anon', 'closing_history(uuid,date,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'audit_history(uuid,date,integer)', 'EXECUTE'),
  'anonymous callers cannot execute either history RPC'
);

select * from finish();
rollback;
