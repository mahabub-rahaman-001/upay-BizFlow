begin;
select plan(15);

insert into auth.users (id, email) values
  ('88888888-0000-0000-0000-000000000001','merchant-owner@test.local'),
  ('88888888-0000-0000-0000-000000000002','other-owner@test.local');
insert into businesses (id, type, name, category) values
  ('88888888-1000-0000-0000-000000000001','MERCHANT','Shop Test','grocery'),
  ('88888888-1000-0000-0000-000000000002','MERCHANT','Other Shop','clothing');
select seed_accounts('88888888-1000-0000-0000-000000000001','MERCHANT');
select seed_accounts('88888888-1000-0000-0000-000000000002','MERCHANT');
insert into memberships (user_id, business_id, role, permissions) values
  ('88888888-0000-0000-0000-000000000001','88888888-1000-0000-0000-000000000001','merchant_owner','{}'),
  ('88888888-0000-0000-0000-000000000002','88888888-1000-0000-0000-000000000002','merchant_owner','{}');

-- 1. Insert forecast_runs (as service role / migration runner)
insert into forecast_runs (
  id, business_id, capability, cutoff_date, model_version, confidence, abstained, days
) values (
  '88888888-2000-0000-0000-000000000001',
  '88888888-1000-0000-0000-000000000001',
  'sales7d',
  '2026-10-01',
  'lgbm-quantile-0.1.0',
  'high',
  false,
  '[{"day":"2026-10-02","p10_minor":100000,"p50_minor":150000,"p90_minor":200000}]'::jsonb
);

select is(
  (select count(*) from forecast_runs where business_id = '88888888-1000-0000-0000-000000000001'),
  1::bigint,
  'forecast_run inserted successfully'
);

-- 2. Unique constraint on (business_id, capability, cutoff_date)
select throws_ok(
  $$ insert into forecast_runs (business_id, capability, cutoff_date, model_version, confidence)
     values ('88888888-1000-0000-0000-000000000001', 'sales7d', '2026-10-01', 'v2', 'low') $$,
  '23505', null, 'cannot insert duplicate forecast run for same business, capability, cutoff'
);

-- 3. Append-only triggers: update or delete on forecast_runs must fail
select throws_ok(
  $$ update forecast_runs set confidence = 'low' where id = '88888888-2000-0000-0000-000000000001' $$,
  'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.',
  'forecast_runs cannot be updated'
);
select throws_ok(
  $$ delete from forecast_runs where id = '88888888-2000-0000-0000-000000000001' $$,
  'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.',
  'forecast_runs cannot be deleted'
);

-- 4. ai_outputs insert and append-only
insert into ai_outputs (
  id, business_id, capability, what_en, confidence
) values (
  '88888888-3000-0000-0000-000000000001',
  '88888888-1000-0000-0000-000000000001',
  'sales_forecast',
  'Expected sales: 1,500 BDT',
  'high'
);

select throws_ok(
  $$ update ai_outputs set what_en = 'changed' where id = '88888888-3000-0000-0000-000000000001' $$,
  'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.',
  'ai_outputs cannot be updated'
);

-- 5. View v_latest_forecast
select is(
  (select model_version from v_latest_forecast where business_id = '88888888-1000-0000-0000-000000000001' and capability = 'sales7d'),
  'lgbm-quantile-0.1.0',
  'v_latest_forecast returns the latest forecast run'
);

-- 6. Anomaly flags & resolve_anomaly_flag
-- Create a dummy transaction for the flag
-- actor_user_id is NOT NULL: every posted row names who entered it, so a fixture has to
-- say so too.
insert into transactions (
  id, business_id, kind, source, amount_minor, actor_user_id, occurred_at
) values (
  '88888888-4000-0000-0000-000000000001',
  '88888888-1000-0000-0000-000000000001',
  'CASH_SALE',
  'manual',
  5000000,
  '88888888-0000-0000-0000-000000000001',
  now()
);

insert into ai_anomaly_flags (
  id, business_id, transaction_id, score, label, reason_codes, reason_bn
) values (
  '88888888-5000-0000-0000-000000000001',
  '88888888-1000-0000-0000-000000000001',
  '88888888-4000-0000-0000-000000000001',
  0.850,
  'needs_review',
  array['amount_outlier'],
  array['স্বাভাবিকের চেয়ে অনেক বেশি লেনদেন']
);

select throws_ok(
  $$ delete from ai_anomaly_flags where id = '88888888-5000-0000-0000-000000000001' $$,
  'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.',
  'ai_anomaly_flags cannot be deleted'
);

-- 7. Owner resolves anomaly flag
set local role authenticated;
set local request.jwt.claims = '{"sub":"88888888-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select resolve_anomaly_flag('88888888-5000-0000-0000-000000000001') $$,
  'owner can resolve anomaly flag'
);

select is(
  (select resolved from ai_anomaly_flags where id = '88888888-5000-0000-0000-000000000001'),
  true,
  'anomaly flag is marked resolved'
);

-- 8. Non-owner cannot resolve or see other business anomaly flag
set local role authenticated;
set local request.jwt.claims = '{"sub":"88888888-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*) from forecast_runs),
  0::bigint,
  'RLS hides other business forecast_runs'
);

select is(
  (select count(*) from ai_outputs),
  0::bigint,
  'RLS hides other business ai_outputs'
);

select is(
  (select count(*) from ai_anomaly_flags),
  0::bigint,
  'RLS hides other business ai_anomaly_flags'
);

-- The function is SECURITY DEFINER, so it can see the flag and knows which business it
-- belongs to; the caller is then rejected as not an owner of that business (42501), which
-- is the same answer they would get for any business they do not belong to.
select throws_ok(
  $$ select resolve_anomaly_flag('88888888-5000-0000-0000-000000000001') $$,
  '42501', null, 'other business owner cannot resolve flag'
);

-- 9. AI tables are written by the service role alone.
-- The nightly Edge Function holds that key; an app user must not be able to write a
-- forecast or an AI card for their own business, which would let them fabricate advice.
select throws_ok(
  $$ insert into forecast_runs (business_id, capability, cutoff_date, model_version, confidence)
     values ('88888888-1000-0000-0000-000000000002','sales7d','2026-10-02','fake','high') $$,
  '42501',
  null,
  'an app user cannot insert a forecast run'
);

-- 10. business_daily_sales returns daily series
reset role;
select is(
  (select count(*) from business_daily_sales('88888888-1000-0000-0000-000000000001', '2026-10-01'::date, '2026-10-05'::date)),
  5::bigint,
  'business_daily_sales returns 5 days in series'
);

select * from finish();
rollback;
