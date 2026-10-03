begin;
select plan(12);

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000001','agent-owner@test.local'),
  ('77777777-0000-0000-0000-000000000002','merchant-owner@test.local');
insert into businesses (id, type, name, category) values
  ('77777777-1000-0000-0000-000000000001','AGENT','Agent Test','agent'),
  ('77777777-1000-0000-0000-000000000002','MERCHANT','Shop Test','grocery');
select seed_accounts('77777777-1000-0000-0000-000000000001','AGENT');
select seed_accounts('77777777-1000-0000-0000-000000000002','MERCHANT');
insert into memberships (user_id, business_id, role, permissions) values
  ('77777777-0000-0000-0000-000000000001','77777777-1000-0000-0000-000000000001','agent_owner','{}'),
  ('77777777-0000-0000-0000-000000000002','77777777-1000-0000-0000-000000000002','merchant_owner','{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"77777777-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select post_manual_wallet('77777777-1000-0000-0000-000000000001', 200000,
       '77777777-2000-0000-0000-000000000001', 'bKash', 'cash out') $$,
  'agent can record an other-wallet float'
);
select is(
  (agent_audit_preview('77777777-1000-0000-0000-000000000001') -> 'wallets' -> 0 ->> 'wallet'),
  'bKash', 'preview names the manual wallet'
);
select is(
  (agent_audit_preview('77777777-1000-0000-0000-000000000001') -> 'wallets' -> 0 ->> 'expected_minor')::bigint,
  200000::bigint, 'preview derives the wallet balance from transactions'
);
select lives_ok(
  $$ select post_agent_audit('77777777-1000-0000-0000-000000000001', 0, 0,
       '[{"wallet":"bKash","actual_minor":199500}]'::jsonb) $$,
  'owner can save the agent day audit'
);
select is((select variance_minor from agent_float_snapshots where wallet = 'bKash'),
          -500::bigint, 'wallet variance is actual minus expected');
select is((select source from agent_float_snapshots where wallet = 'upay'),
          'verified', 'upay snapshot is visibly verified');
select is((select source from agent_float_snapshots where wallet = 'bKash'),
          'manual', 'other-wallet snapshot is visibly manual');
select throws_ok(
  $$ select post_agent_audit('77777777-1000-0000-0000-000000000001', 0, 0, '[]'::jsonb) $$,
  '23505', null, 'the same day cannot be audited twice'
);
-- The client grant already denies UPDATE. As the migration owner, the trigger is the
-- second line of defence and must still reject mutation.
reset role;
select throws_ok(
  $$ update agent_float_audits set note = 'changed' $$,
  'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.',
  'an audit cannot be edited'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"77777777-0000-0000-0000-000000000002","role":"authenticated"}';
-- The role-type guard (migration 20261002194634) now denies this as a wrong business type
-- (42501) rather than a bad argument (22023): an agent feature on a merchant business is a
-- role boundary, not a validation error.
select throws_ok(
  $$ select agent_audit_preview('77777777-1000-0000-0000-000000000002') $$,
  '42501', null, 'merchant businesses cannot use an agent audit'
);
select is((select count(*) from agent_float_audits), 0::bigint,
          'RLS hides another business audit');
select is((select count(*) from agent_float_snapshots), 0::bigint,
          'RLS hides another business snapshots');

select * from finish();
rollback;
