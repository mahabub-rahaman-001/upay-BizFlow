-- pgTAP tests for offers (supabase/migrations/0013_offers.sql).
-- Run with: pnpm db:test

begin;
select plan(22);

-- ------------------------------------------------------------------ Setup
insert into auth.users (id, email) values
  ('a0f11111-0000-0000-0000-000000000001','offer-owner@test.local'),
  ('a0f11111-0000-0000-0000-000000000002','offer-staff@test.local');

insert into businesses (id, type, name, category) values
  ('b0fb1211-0000-0000-0000-000000000001','MERCHANT','Offer Shop','grocery');

select seed_accounts('b0fb1211-0000-0000-0000-000000000001','MERCHANT');

insert into memberships (user_id, business_id, role, permissions) values
  ('a0f11111-0000-0000-0000-000000000001','b0fb1211-0000-0000-0000-000000000001',
   'merchant_owner','{}'),
  ('a0f11111-0000-0000-0000-000000000002','b0fb1211-0000-0000-0000-000000000001',
   'staff','{"can_add_entries":true}');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0f11111-0000-0000-0000-000000000001","role":"authenticated"}';

-- Helper: post a small cash sale so we have a real transaction to redeem against.
select post_cash_sale(
  'b0fb1211-0000-0000-0000-000000000001',
  20000, gen_random_uuid(), null, 'grocery', null
);

-- ------------------------------------------------------------------ 1. create_offer returns DRAFT
select is(
  (create_offer(
    'b0fb1211-0000-0000-0000-000000000001',
    'AMOUNT_OFF'::offer_type,
    'Eid Sale',
    '{"off_minor":1000}'::jsonb,
    50000,
    now() - interval '1 hour',
    now() + interval '7 days'
  ) ->> 'status'),
  'DRAFT',
  'create_offer returns DRAFT'
);

-- ------------------------------------------------------------------ 2. Staff cannot create offers
set local request.jwt.claims =
  '{"sub":"a0f11111-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ select create_offer(
       'b0fb1211-0000-0000-0000-000000000001',
       'AMOUNT_OFF'::offer_type,'Staff Offer','{}',10000,now(),now()+interval'1 day') $$,
  '42501', null,
  'staff cannot create offers'
);

set local request.jwt.claims =
  '{"sub":"a0f11111-0000-0000-0000-000000000001","role":"authenticated"}';

-- ------------------------------------------------------------------ 3. publish_offer moves to ACTIVE
select is(
  (publish_offer(
    'b0fb1211-0000-0000-0000-000000000001',
    (select id from offers where title = 'Eid Sale')
  ) ->> 'status'),
  'ACTIVE',
  'publish_offer moves offer to ACTIVE'
);

select is(
  (select status from offers where title = 'Eid Sale'),
  'ACTIVE',
  'offer row status is ACTIVE after publish'
);

-- ------------------------------------------------------------------ 4. Cannot publish an ACTIVE offer
select throws_ok(
  $$ select publish_offer(
       'b0fb1211-0000-0000-0000-000000000001',
       (select id from offers where title = 'Eid Sale')) $$,
  '22023', null,
  'cannot publish a non-DRAFT offer'
);

-- ------------------------------------------------------------------ 5. pause_offer
select is(
  (pause_offer(
    'b0fb1211-0000-0000-0000-000000000001',
    (select id from offers where title = 'Eid Sale'),
    'testing'
  ) ->> 'status'),
  'PAUSED',
  'pause_offer moves offer to PAUSED'
);

-- 6. resume_offer
select is(
  (resume_offer(
    'b0fb1211-0000-0000-0000-000000000001',
    (select id from offers where title = 'Eid Sale')
  ) ->> 'status'),
  'ACTIVE',
  'resume_offer moves offer back to ACTIVE'
);

-- ------------------------------------------------------------------ 7. redeem_offer posts ledger entry
select lives_ok(
  $$ select redeem_offer(
       'b0fb1211-0000-0000-0000-000000000001',
       (select id from offers where title = 'Eid Sale'),
       (select id from transactions
         where business_id = 'b0fb1211-0000-0000-0000-000000000001' limit 1),
       1000
     ) $$,
  'redeem_offer succeeds within budget'
);

-- 8. Redemption row exists
select is(
  (select count(*)::int from offer_redemptions
    where offer_id = (select id from offers where title = 'Eid Sale')),
  1,
  'one redemption row created'
);

-- 9. spent_minor updated
select is(
  (select spent_minor from offers where title = 'Eid Sale'),
  1000::bigint,
  'spent_minor incremented by discount amount'
);

-- 10. 4010 debit posted in journal
select is(
  (select coalesce(sum(jl.debit_minor), 0)::bigint
     from journal_lines jl
     join accounts a on a.id = jl.account_id
    where a.business_id = 'b0fb1211-0000-0000-0000-000000000001'
      and a.code = '4010'),
  1000::bigint,
  'account 4010 has a debit equal to the discount'
);

-- 11. 4000 credit posted
select is(
  (select coalesce(sum(jl.credit_minor), 0)::bigint
     from journal_lines jl
     join journal_entries je on je.id = jl.entry_id
     join offer_redemptions r on r.journal_entry_id = je.id
     join accounts a on a.id = jl.account_id
    where je.business_id = 'b0fb1211-0000-0000-0000-000000000001'
      and a.code = '4000'),
  1000::bigint,
  'account 4000 has a matching credit on the redemption entry'
);

-- ------------------------------------------------------------------ 12. Fill the budget
select lives_ok(
  $$ select redeem_offer(
       'b0fb1211-0000-0000-0000-000000000001',
       (select id from offers where title = 'Eid Sale'),
       (select id from transactions
         where business_id = 'b0fb1211-0000-0000-0000-000000000001' limit 1),
       49000
     ) $$,
  'redeem for the remaining budget succeeds (exactly hits cap)'
);

select is(
  (select spent_minor from offers where title = 'Eid Sale'),
  50000::bigint,
  'spent_minor equals budget after two redemptions'
);

-- ------------------------------------------------------------------ 13. Budget exhaustion raises error
select throws_ok(
  $$ select redeem_offer(
       'b0fb1211-0000-0000-0000-000000000001',
       (select id from offers where title = 'Eid Sale'),
       (select id from transactions
         where business_id = 'b0fb1211-0000-0000-0000-000000000001' limit 1),
       1
     ) $$,
  '22023', null,
  'redemption past budget raises OFFER_BUDGET_EXHAUSTED'
);

-- ------------------------------------------------------------------ 14. STAMP offer
select post_cash_sale(
  'b0fb1211-0000-0000-0000-000000000001',
  5000, gen_random_uuid(), null, 'grocery', null
);

select lives_ok(
  $$ select create_offer(
       'b0fb1211-0000-0000-0000-000000000001',
       'STAMP'::offer_type,
       'Loyalty Card',
       '{"goal":3,"reward_minor":2000}'::jsonb,
       100000,
       now() - interval '1 hour',
       now() + interval '30 days'
     ) $$,
  'STAMP offer can be created'
);

select publish_offer(
  'b0fb1211-0000-0000-0000-000000000001',
  (select id from offers where title = 'Loyalty Card')
);

-- 15. stamp 1 of 3
select is(
  (stamp_progress(
    'b0fb1211-0000-0000-0000-000000000001',
    (select id from offers where title = 'Loyalty Card'),
    'cust-hash-001',
    (select id from transactions
      where business_id = 'b0fb1211-0000-0000-0000-000000000001'
      order by created_at desc limit 1)
  ) ->> 'completed'),
  'false',
  'stamp 1 of 3 not yet completed'
);

-- stamp 2 (not counted as a test)
select stamp_progress(
  'b0fb1211-0000-0000-0000-000000000001',
  (select id from offers where title = 'Loyalty Card'),
  'cust-hash-001',
  (select id from transactions
    where business_id = 'b0fb1211-0000-0000-0000-000000000001'
    order by created_at desc limit 1)
);

-- 16. stamp 3 completes the card
select is(
  (stamp_progress(
    'b0fb1211-0000-0000-0000-000000000001',
    (select id from offers where title = 'Loyalty Card'),
    'cust-hash-001',
    (select id from transactions
      where business_id = 'b0fb1211-0000-0000-0000-000000000001'
      order by created_at desc limit 1)
  ) ->> 'completed'),
  'true',
  'third stamp completes the loyalty card'
);

-- 17. stamps reset to 0
select is(
  (select stamps from stamp_cards
    where offer_id = (select id from offers where title = 'Loyalty Card')
      and customer_ref = 'cust-hash-001'),
  0,
  'stamps reset to 0 after card completion'
);

-- ------------------------------------------------------------------ 18. end_offer
select is(
  (end_offer(
    'b0fb1211-0000-0000-0000-000000000001',
    (select id from offers where title = 'Loyalty Card')
  ) ->> 'status'),
  'ENDED',
  'end_offer moves offer to ENDED'
);

-- 19. Cannot redeem ENDED offer
select throws_ok(
  $$ select redeem_offer(
       'b0fb1211-0000-0000-0000-000000000001',
       (select id from offers where title = 'Loyalty Card'),
       (select id from transactions
         where business_id = 'b0fb1211-0000-0000-0000-000000000001' limit 1),
       500
     ) $$,
  '22023', null,
  'redeem on an ENDED offer is rejected'
);

-- 20. list_offers returns both offers
select is(
  (select count(*)::int from list_offers('b0fb1211-0000-0000-0000-000000000001')),
  2,
  'list_offers returns all two offers'
);

select * from finish();
rollback;
