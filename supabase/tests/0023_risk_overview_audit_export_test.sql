-- pgTAP tests for admin risk overview and audit CSV export
-- (migration 20261003170000_risk_overview_audit_export.sql).
-- Both are upay_admin only. The risk numbers come from the ledger; the CSV export is
-- itself written to the audit trail before it reads anything.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001','risk-admin@test.local'),
  ('f1000000-0000-0000-0000-000000000002','risk-owner@test.local');

-- demo_access true so the admin gate does not also require an aal2 (MFA) claim here.
insert into public.admin_accounts (user_id, role, active, demo_access) values
  ('f1000000-0000-0000-0000-000000000001','upay_admin',true,true);

insert into businesses (id, type, name, category, upay_account_ref) values
  ('f2000000-0000-0000-0000-000000000001','MERCHANT','Risk Shop','grocery','M-RISK-1');
select seed_accounts('f2000000-0000-0000-0000-000000000001','MERCHANT');
insert into memberships (user_id, business_id, role, permissions) values
  ('f1000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000001','merchant_owner','{}');

-- A large QR payment taken but still pending settlement -> pending settlement signal.
select ingest_payment_event('upay', jsonb_build_object(
  'event_type','payment.succeeded','provider_txn_id','RISK-PAY-1','account_ref','M-RISK-1',
  'amount_minor', 500000, 'occurred_at', now(),
  'settlement', jsonb_build_object('status','pending')));

-- ------------------------------------------------------------------ 1-2. Non-admin refused
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$ select admin_risk_overview() $$, '42501', null,
  'a non-admin cannot read the risk overview');
select throws_ok($$ select admin_audit_export_csv(10) $$, '42501', null,
  'a non-admin cannot export the audit log');

-- ------------------------------------------------------------------ 3-4. Risk numbers from ledger
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select (e->>'pending_settlement_count')::int
     from jsonb_array_elements(admin_risk_overview()) e
    where e->>'business_id' = 'f2000000-0000-0000-0000-000000000001'),
  1,
  'the shop shows one pending-settlement payment');

select is(
  (select (e->>'pending_settlement_minor')
     from jsonb_array_elements(admin_risk_overview()) e
    where e->>'business_id' = 'f2000000-0000-0000-0000-000000000001'),
  '500000',
  'the pending-settlement amount comes from the ledger transaction');

-- ------------------------------------------------------------------ 5-6. CSV export, self-audited
select ok(
  admin_audit_export_csv(10) like 'id,actor,action,reason,detail,created_at_dhaka%',
  'the audit CSV begins with the header row');

-- admin_audit_events is not readable by the authenticated role directly (only through admin
-- RPCs), so drop back to the privileged test role just to confirm the row landed.
reset role;
select ok(
  exists(select 1 from admin_audit_events where action = 'audit.csv_exported'),
  'exporting the audit log is itself recorded in the audit trail');

select * from finish();
rollback;
