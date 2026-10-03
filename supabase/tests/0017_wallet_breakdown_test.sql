-- pgTAP tests for wallet_breakdown (Phase A2, migration 20261003130000).
-- Run with: pnpm db:test

begin;
select plan(5);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001','wb-agent@test.local'),
  ('d1000000-0000-0000-0000-000000000002','wb-merch@test.local');

insert into businesses (id, type, name, category) values
  ('d2000000-0000-0000-0000-000000000001','AGENT','WB Agent','agent'),
  ('d2000000-0000-0000-0000-000000000002','MERCHANT','WB Shop','grocery');
select seed_accounts('d2000000-0000-0000-0000-000000000001','AGENT');
select seed_accounts('d2000000-0000-0000-0000-000000000002','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','agent_owner','{}'),
  ('d1000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000002','merchant_owner','{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Two bKash entries and one Nagad, through the real RPC.
select post_manual_wallet('d2000000-0000-0000-0000-000000000001', 100000, gen_random_uuid(), 'bKash');
select post_manual_wallet('d2000000-0000-0000-0000-000000000001', 50000, gen_random_uuid(), 'bKash');
select post_manual_wallet('d2000000-0000-0000-0000-000000000001', 80000, gen_random_uuid(), 'Nagad');

select is(
  jsonb_array_length(wallet_breakdown('d2000000-0000-0000-0000-000000000001') -> 'wallets'),
  2,
  'the breakdown groups entries into distinct wallets');

select is(
  (select (w ->> 'total_minor')::bigint
     from jsonb_array_elements(wallet_breakdown('d2000000-0000-0000-0000-000000000001') -> 'wallets') w
    where w ->> 'wallet' = 'bKash'),
  150000::bigint,
  'bKash total sums both bKash entries');

select is(
  (select (w ->> 'count')::int
     from jsonb_array_elements(wallet_breakdown('d2000000-0000-0000-0000-000000000001') -> 'wallets') w
    where w ->> 'wallet' = 'bKash'),
  2,
  'bKash count is the number of bKash entries');

-- ------------------------------------------------------------------ Role and type
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select wallet_breakdown('d2000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'a merchant business has no wallet breakdown');

select throws_ok(
  $$ select wallet_breakdown('d2000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a non-member cannot read the agent wallet breakdown');

select * from finish();
rollback;
