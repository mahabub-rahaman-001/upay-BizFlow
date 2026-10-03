-- pgTAP tests for today_insights (docs/14, migration 20261002194634_role_insights.sql).
-- Run with: pnpm db:test
--
-- The insights feed must be role-scoped: a merchant gets sales and cash-flow cards, an
-- agent gets liquidity and peak-hour cards, and neither ever receives the other's. Staff
-- see a limited feed (the manager-only cards are withheld), not a denial.

begin;
select plan(9);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001','ins-merch@test.local'),
  ('f1000000-0000-0000-0000-000000000002','ins-agent@test.local'),
  ('f1000000-0000-0000-0000-000000000003','ins-staff@test.local');

insert into businesses (id, type, name, category) values
  ('f2000000-0000-0000-0000-000000000001','MERCHANT','Insight Shop','grocery'),
  ('f2000000-0000-0000-0000-000000000002','AGENT','Insight Agent','agent');
select seed_accounts('f2000000-0000-0000-0000-000000000001','MERCHANT');
select seed_accounts('f2000000-0000-0000-0000-000000000002','AGENT');

insert into memberships (user_id, business_id, role, permissions) values
  ('f1000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','merchant_owner','{}'),
  ('f1000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000002','agent_owner','{}'),
  ('f1000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000001','staff','{"can_add_entries":true}');

-- A sales forecast for today, so the merchant's sales-forecast card renders.
insert into forecast_runs (business_id, capability, cutoff_date, model_version, confidence, abstained, days) values
  ('f2000000-0000-0000-0000-000000000001','sales7d', current_date,'m','medium',false,
   jsonb_build_array(jsonb_build_object('day', current_date::text,
     'p10_minor',100000,'p50_minor',150000,'p90_minor',200000))),
  ('f2000000-0000-0000-0000-000000000002','float24h', current_date,'m','medium',false, '[]'::jsonb);

set local role authenticated;

-- ------------------------------------------------------------------ Merchant
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (today_insights('f2000000-0000-0000-0000-000000000001') ->> 'role'),
  'MERCHANT',
  'the merchant feed is typed MERCHANT');

select ok(
  jsonb_array_length(today_insights('f2000000-0000-0000-0000-000000000001') -> 'cards') > 0,
  'the merchant gets at least one insight card');

select ok(
  exists (select 1 from jsonb_array_elements(
            today_insights('f2000000-0000-0000-0000-000000000001') -> 'cards') c
          where c ->> 'id' = 'sales-forecast'),
  'the merchant feed has a sales forecast card');

select ok(
  not exists (select 1 from jsonb_array_elements(
                today_insights('f2000000-0000-0000-0000-000000000001') -> 'cards') c
              where c ->> 'id' in ('liquidity','peak-hours')),
  'no agent card appears in the merchant feed');

-- ------------------------------------------------------------------ Agent
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}';

select ok(
  exists (select 1 from jsonb_array_elements(
            today_insights('f2000000-0000-0000-0000-000000000002') -> 'cards') c
          where c ->> 'id' = 'liquidity'),
  'the agent feed has a liquidity card');

select ok(
  exists (select 1 from jsonb_array_elements(
            today_insights('f2000000-0000-0000-0000-000000000002') -> 'cards') c
          where c ->> 'id' = 'peak-hours'),
  'the agent feed has a peak-hours card');

select ok(
  not exists (select 1 from jsonb_array_elements(
                today_insights('f2000000-0000-0000-0000-000000000002') -> 'cards') c
              where c ->> 'id' in ('sales-forecast','cash-flow','sales-trend')),
  'no merchant card appears in the agent feed');

-- ------------------------------------------------------------------ Staff: limited, not denied
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$ select today_insights('f2000000-0000-0000-0000-000000000001') $$,
  'staff can open the feed (it is not denied)');

select ok(
  not exists (select 1 from jsonb_array_elements(
                today_insights('f2000000-0000-0000-0000-000000000001') -> 'cards') c
              where c ->> 'id' = 'sales-forecast'),
  'staff do not see the manager-only forecast card');

select * from finish();
rollback;
