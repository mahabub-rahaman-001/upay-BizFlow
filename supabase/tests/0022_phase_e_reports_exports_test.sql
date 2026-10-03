-- pgTAP tests for Phase E deterministic reports and audited exports.
begin;
select plan(10);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001','report-owner@test.local'),
  ('e1000000-0000-0000-0000-000000000002','report-staff@test.local'),
  ('e1000000-0000-0000-0000-000000000003','report-agent@test.local');

insert into businesses (id, type, name, category) values
  ('e2000000-0000-0000-0000-000000000001','MERCHANT','Report Shop','grocery'),
  ('e2000000-0000-0000-0000-000000000002','AGENT','Report Agent','agent');
select seed_accounts('e2000000-0000-0000-0000-000000000001','MERCHANT');
select seed_accounts('e2000000-0000-0000-0000-000000000002','AGENT');

insert into memberships (user_id, business_id, role) values
  ('e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','merchant_owner'),
  ('e1000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000001','staff'),
  ('e1000000-0000-0000-0000-000000000003','e2000000-0000-0000-0000-000000000002','agent_owner');

insert into transactions (id,business_id,kind,source,amount_minor,category,note,actor_user_id,occurred_at) values
  ('e3000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','CASH_SALE','manual',12500,'grocery',null,'e1000000-0000-0000-0000-000000000001','2026-10-02 10:00+06'),
  ('e3000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000001','EXPENSE','manual',2500,'rent','stall rent','e1000000-0000-0000-0000-000000000001','2026-10-02 11:00+06'),
  ('e3000000-0000-0000-0000-000000000003','e2000000-0000-0000-0000-000000000002','AGENT_COMMISSION','verified',3000,null,null,'e1000000-0000-0000-0000-000000000003','2026-10-02 12:00+06');
insert into journal_entries (id,business_id,transaction_id) values
  ('e4000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001'),
  ('e4000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000002'),
  ('e4000000-0000-0000-0000-000000000003','e2000000-0000-0000-0000-000000000002','e3000000-0000-0000-0000-000000000003');
insert into journal_lines (entry_id,business_id,account_id,debit_minor,credit_minor)
select 'e4000000-0000-0000-0000-000000000001'::uuid,a.business_id,a.id,12500,0 from accounts a where a.business_id='e2000000-0000-0000-0000-000000000001' and a.code='1000'
union all select 'e4000000-0000-0000-0000-000000000001',a.business_id,a.id,0,12500 from accounts a where a.business_id='e2000000-0000-0000-0000-000000000001' and a.code='4000'
union all select 'e4000000-0000-0000-0000-000000000002',a.business_id,a.id,2500,0 from accounts a where a.business_id='e2000000-0000-0000-0000-000000000001' and a.code='5100'
union all select 'e4000000-0000-0000-0000-000000000002',a.business_id,a.id,0,2500 from accounts a where a.business_id='e2000000-0000-0000-0000-000000000001' and a.code='1000'
union all select 'e4000000-0000-0000-0000-000000000003',a.business_id,a.id,3000,0 from accounts a where a.business_id='e2000000-0000-0000-0000-000000000002' and a.code='1010'
union all select 'e4000000-0000-0000-0000-000000000003',a.business_id,a.id,0,3000 from accounts a where a.business_id='e2000000-0000-0000-0000-000000000002' and a.code='4200';

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select (r->>'sales_minor')::bigint from report_rows('e2000000-0000-0000-0000-000000000001','sales_by_day','2026-10-01','2026-10-03') r),12500::bigint,'sales amount comes from the sales journal line');
select is((select (r->>'expense_minor')::bigint from report_rows('e2000000-0000-0000-0000-000000000001','expenses','2026-10-01','2026-10-03') r),2500::bigint,'expense amount comes from the expense journal line');
select is((select (r->>'cash_minor')::bigint from report_rows('e2000000-0000-0000-0000-000000000001','cash_vs_digital','2026-10-01','2026-10-03') r),12500::bigint,'cash versus digital uses ledger-backed sales only');
select is((select count(*) from report_rows('e2000000-0000-0000-0000-000000000001','sales_by_day','2026-10-03','2026-10-03')),0::bigint,'date range excludes other days');
select throws_ok($$ select * from report_rows('e2000000-0000-0000-0000-000000000001','sales_by_day','2026-10-03','2026-10-01') $$,'22007',null,'invalid date range is rejected');

set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$ select * from report_rows('e2000000-0000-0000-0000-000000000001','sales_by_day','2026-10-01','2026-10-03') $$,'42501',null,'merchant staff cannot read owner reports');

set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select (r->>'commission_minor')::bigint from report_rows('e2000000-0000-0000-0000-000000000002','commission','2026-10-01','2026-10-03') r),3000::bigint,'agent owner receives agent commission report');
select throws_ok($$ select * from report_rows('e2000000-0000-0000-0000-000000000002','sales_by_day','2026-10-01','2026-10-03') $$,'42501',null,'agent cannot request merchant sales report');

set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$ select log_export('e2000000-0000-0000-0000-000000000001','sales_by_day','{}','csv',1,'sales.csv') $$,'42501',null,'export requires recent reauthentication');
select request_reauth();
-- Run the export in its own statement so the assertion below reads its committed writes.
-- A single statement that both calls log_export and reads the rows it inserts would use one
-- snapshot and not see them.
select log_export('e2000000-0000-0000-0000-000000000001','sales_by_day','{"from":"2026-10-01","to":"2026-10-03"}','csv',1,'sales.csv');
select ok(
  exists(select 1 from exports where business_id='e2000000-0000-0000-0000-000000000001' and report_key='sales_by_day')
  and exists(select 1 from audit_events where business_id='e2000000-0000-0000-0000-000000000001' and action='REPORT_EXPORTED'),
  'export record and audit event are written together');

select * from finish();
rollback;
