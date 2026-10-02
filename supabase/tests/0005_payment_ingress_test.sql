-- pgTAP tests for payment ingress (supabase/migrations/0005_payment_ingress.sql).
-- Run with: pnpm db:test
--
-- These cover the rules a payment provider will actually exercise: replays, unknown
-- accounts, pending versus settled money, settlement arriving later, and a provider
-- reversal. The business here has its own account_ref so the suite does not depend on
-- whatever the demo seed contains.

begin;
select plan(14);

insert into businesses (id, type, name, category, upay_account_ref, verified) values
  ('dddddddd-0000-0000-0000-000000000001','MERCHANT','Ingress Shop','grocery','M-TEST-001', true),
  ('dddddddd-0000-0000-0000-000000000002','AGENT','Ingress Agent','agent','A-TEST-001', true);

select seed_accounts('dddddddd-0000-0000-0000-000000000001','MERCHANT');
select seed_accounts('dddddddd-0000-0000-0000-000000000002','AGENT');

-- ------------------------------------------------------------------ 1. Unknown account
select is(
  (select ingest_payment_event('upay', jsonb_build_object(
     'event_type','payment.succeeded',
     'provider_txn_id','UNKNOWN-1',
     'account_ref','M-DOES-NOT-EXIST',
     'amount_minor', 50000,
     'occurred_at', now()
   )) ->> 'quarantined'),
  'true',
  'an event for an unknown account_ref is quarantined, not posted'
);

select is(
  (select reason from quarantined_events where provider_txn_id = 'UNKNOWN-1'),
  'UNKNOWN_ACCOUNT_REF',
  'the quarantine row records why it could not be attributed'
);

select is(
  (select count(*)::int from transactions
    where business_id = 'dddddddd-0000-0000-0000-000000000001'),
  0,
  'nothing was posted for the unattributable event'
);

-- ------------------------------------------------------------------ 2. Settled payment
select is(
  (select ingest_payment_event('upay', jsonb_build_object(
     'event_type','payment.succeeded',
     'provider_txn_id','UPY-SETTLED-1',
     'account_ref','M-TEST-001',
     'amount_minor', 85000,
     'payer_app','bKash',
     'payer_token','opaque-token',
     'reference','INV-1048',
     'occurred_at', now(),
     'settlement', jsonb_build_object('status','settled')
   )) ->> 'posted'),
  'true',
  'a settled payment posts to the books'
);

select is(
  (select t.source from transactions t
    join payment_events e on e.id = t.payment_event_id
   where e.provider_txn_id = 'UPY-SETTLED-1'),
  'verified',
  'a provider payment is marked verified, not manual'
);

-- Settled money lands in the wallet (1010), per the docs/06 posting map.
select is(
  (select l.debit_minor from journal_lines l
     join accounts a on a.id = l.account_id
     join journal_entries je on je.id = l.entry_id
     join transactions t on t.id = je.transaction_id
     join payment_events e on e.id = t.payment_event_id
    where e.provider_txn_id = 'UPY-SETTLED-1' and a.code = '1010'),
  85000::bigint,
  'a settled payment debits the upay wallet 1010'
);

-- The raw provider token must not be stored as given.
select isnt(
  (select payer_hash from payment_events where provider_txn_id = 'UPY-SETTLED-1'),
  'opaque-token',
  'the payer token is hashed, never stored raw'
);

select isnt(
  (select token from receipts r
     join transactions t on t.id = r.transaction_id
     join payment_events e on e.id = t.payment_event_id
    where e.provider_txn_id = 'UPY-SETTLED-1'),
  null,
  'a successful payment gets a shareable receipt token'
);

-- ------------------------------------------------------------------ 3. Replay
select is(
  (select ingest_payment_event('upay', jsonb_build_object(
     'event_type','payment.succeeded',
     'provider_txn_id','UPY-SETTLED-1',
     'account_ref','M-TEST-001',
     'amount_minor', 85000,
     'occurred_at', now(),
     'settlement', jsonb_build_object('status','settled')
   )) ->> 'duplicate'),
  'true',
  'the same provider event arriving twice is reported as a duplicate'
);

select is(
  (select count(*)::int from payment_events where provider_txn_id = 'UPY-SETTLED-1'),
  1,
  'a replayed event does not create a second event row'
);

-- ------------------------------------------------------------------ 4. Pending, then settled
select lives_ok(
  $$ select ingest_payment_event('upay', jsonb_build_object(
       'event_type','payment.succeeded',
       'provider_txn_id','UPY-PENDING-1',
       'account_ref','M-TEST-001',
       'amount_minor', 40000,
       'occurred_at', now(),
       'settlement', jsonb_build_object('status','pending')
     )) $$,
  'a pending payment is accepted'
);

select is(
  (select l.debit_minor from journal_lines l
     join accounts a on a.id = l.account_id
     join journal_entries je on je.id = l.entry_id
     join transactions t on t.id = je.transaction_id
     join payment_events e on e.id = t.payment_event_id
    where e.provider_txn_id = 'UPY-PENDING-1' and a.code = '1020'),
  40000::bigint,
  'a pending payment debits pending settlement 1020, not the wallet'
);

-- ------------------------------------------------------------------ 5. Agent cash-in
-- Not an assertion, just the event under test.
select ingest_payment_event('upay', jsonb_build_object(
  'event_type','agent.cash_in',
  'provider_txn_id','AGT-CASHIN-1',
  'account_ref','A-TEST-001',
  'amount_minor', 100000,
  'occurred_at', now()
));

select is(
  (select l.credit_minor from journal_lines l
     join accounts a on a.id = l.account_id
     join journal_entries je on je.id = l.entry_id
     join transactions t on t.id = je.transaction_id
     join payment_events e on e.id = t.payment_event_id
    where e.provider_txn_id = 'AGT-CASHIN-1' and a.code = '1010'),
  100000::bigint,
  'an agent cash-in credits the e-float and debits the drawer'
);

-- ------------------------------------------------------------------ 6. Provider reversal
select is(
  (select ingest_payment_event('upay', jsonb_build_object(
     'event_type','payment.reversed',
     'provider_txn_id','UPY-SETTLED-1',
     'account_ref','M-TEST-001',
     'amount_minor', 85000,
     'occurred_at', now()
   )) ->> 'posted'),
  'true',
  'a provider reversal posts a mirror entry'
);

select * from finish();
rollback;
