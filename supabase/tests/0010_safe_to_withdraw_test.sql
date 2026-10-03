-- pgTAP tests for safe-to-withdraw (supabase/migrations/0010_safe_to_withdraw.sql).
-- Run with: pnpm db:test

begin;
select plan(9);

insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001','stw-owner@test.local'),
  ('99999999-0000-0000-0000-000000000002','stw-staff@test.local');

insert into businesses (id, type, name, category, settings) values
  ('99999999-1000-0000-0000-000000000001','MERCHANT','STW Shop','grocery',
   '{"operating_reserve_minor": 100000}');

select seed_accounts('99999999-1000-0000-0000-000000000001','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('99999999-0000-0000-0000-000000000001','99999999-1000-0000-0000-000000000001','merchant_owner','{}'),
  ('99999999-0000-0000-0000-000000000001','99999999-1000-0000-0000-000000000001','merchant_owner','{}')
on conflict do nothing;
insert into memberships (user_id, business_id, role, permissions) values
  ('99999999-0000-0000-0000-000000000002','99999999-1000-0000-0000-000000000001','staff','{"can_add_entries":true}');

-- Opening cash of Tk 2,000 so there is a cleared balance to draw from.
do $$
declare v_txn uuid;
begin
  insert into transactions (business_id, kind, source, amount_minor, actor_user_id, client_uuid, occurred_at)
  values ('99999999-1000-0000-0000-000000000001','OWNER_DEPOSIT','manual',200000,
          '99999999-0000-0000-0000-000000000001', gen_random_uuid(), now())
  returning id into v_txn;
  perform _post_journal('99999999-1000-0000-0000-000000000001', v_txn, jsonb_build_array(
    jsonb_build_object('code','1000','debit',200000),
    jsonb_build_object('code','3000','credit',200000)), 'opening');
end $$;

-- ------------------------------------------------------------------ 1. No forecast yet
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (get_safe_to_withdraw('99999999-1000-0000-0000-000000000001') ->> 'available'),
  'false',
  'with no forecast run, no recommendation is made'
);

select is(
  (get_safe_to_withdraw('99999999-1000-0000-0000-000000000001') ->> 'reason'),
  'NO_FORECAST',
  'and the reason says so'
);

-- ------------------------------------------------------------------ Add a high-confidence forecast
reset role;
insert into forecast_runs (business_id, capability, cutoff_date, model_version, confidence, abstained, days)
values ('99999999-1000-0000-0000-000000000001','sales7d', current_date,
        'lgbm-quantile-0.1.0','high', false,
        '[{"day":"2026-10-03","p10_minor":50000,"p50_minor":80000,"p90_minor":110000}]'::jsonb);

set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000001","role":"authenticated"}';

-- ------------------------------------------------------------------ 2. Now available
select is(
  (get_safe_to_withdraw('99999999-1000-0000-0000-000000000001') ->> 'available'),
  'true',
  'with a high-confidence forecast, a recommendation is made'
);

select is(
  (get_safe_to_withdraw('99999999-1000-0000-0000-000000000001') ->> 'current_cleared_minor')::bigint,
  200000::bigint,
  'cleared balance is the drawer plus wallet'
);

-- Lowest projected day is today (inflow only pushes the balance up), so safe = cleared
-- minus the Tk 1,000 reserve, with no buffer on high confidence.
select is(
  (get_safe_to_withdraw('99999999-1000-0000-0000-000000000001') ->> 'safe_to_withdraw_minor')::bigint,
  100000::bigint,
  'safe-to-withdraw is cleared minus the reserve on a rising forecast'
);

select is(
  (get_safe_to_withdraw('99999999-1000-0000-0000-000000000001') ->> 'uncertainty_buffer_minor')::bigint,
  0::bigint,
  'high confidence carries no uncertainty buffer'
);

-- ------------------------------------------------------------------ 3. Simulation
select is(
  (simulate_withdrawal('99999999-1000-0000-0000-000000000001', 150000) ->> 'below_reserve'),
  'true',
  'withdrawing more than the safe amount drops below the reserve'
);

select is(
  (simulate_withdrawal('99999999-1000-0000-0000-000000000001', 50000) ->> 'below_reserve'),
  'false',
  'withdrawing within the safe amount stays above the reserve'
);

-- ------------------------------------------------------------------ 4. Role check
set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select get_safe_to_withdraw('99999999-1000-0000-0000-000000000001') $$,
  '42501',
  null,
  'staff cannot see the planner'
);

select * from finish();
rollback;
