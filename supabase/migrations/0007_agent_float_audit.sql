-- P5 agent float and drawer audit.
-- Audits are append-only observations. A mismatch never silently changes the ledger;
-- the owner can investigate it and use the existing correction flow if required.

create table agent_float_audits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  period_date date not null,
  expected_cash_minor bigint not null,
  counted_cash_minor bigint not null check (counted_cash_minor >= 0),
  cash_variance_minor bigint not null,
  expected_upay_minor bigint not null,
  actual_upay_minor bigint not null check (actual_upay_minor >= 0),
  upay_variance_minor bigint not null,
  commission_minor bigint not null default 0,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (business_id, period_date)
);

create table agent_float_snapshots (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references agent_float_audits(id),
  business_id uuid not null references businesses(id),
  wallet text not null check (length(btrim(wallet)) > 0),
  expected_minor bigint not null,
  actual_minor bigint not null check (actual_minor >= 0),
  variance_minor bigint not null,
  source text not null check (source in ('verified','manual')),
  created_at timestamptz not null default now(),
  unique (audit_id, wallet)
);

create index agent_float_audits_business_idx
  on agent_float_audits (business_id, period_date desc);
create index agent_float_snapshots_business_idx
  on agent_float_snapshots (business_id, created_at desc);

alter table agent_float_audits enable row level security;
alter table agent_float_snapshots enable row level security;

create policy agent_audit_owner_read on agent_float_audits for select
  to authenticated
  using (has_role(business_id, array['agent_owner','manager']::member_role[]));
create policy agent_snapshot_owner_read on agent_float_snapshots for select
  to authenticated
  using (has_role(business_id, array['agent_owner','manager']::member_role[]));

revoke all on agent_float_audits, agent_float_snapshots from public, anon, authenticated;
grant select on agent_float_audits, agent_float_snapshots to authenticated;

create trigger trg_agent_audit_append_only
  before update or delete on agent_float_audits
  for each row execute function block_mutation();
create trigger trg_agent_snapshot_append_only
  before update or delete on agent_float_snapshots
  for each row execute function block_mutation();

-- Expected values always come from the ledger. Other-wallet balances are derived from
-- their manual transactions so each named wallet remains visible even though account
-- 1030 is the aggregate control account.
create or replace function agent_audit_preview(
  p_business_id uuid,
  p_period_date date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_date date := coalesce(p_period_date, (now() at time zone 'Asia/Dhaka')::date);
  v_type business_type;
  v_cash bigint;
  v_upay bigint;
  v_commission bigint;
  v_wallets jsonb;
begin
  v_actor := _assert_is_owner(p_business_id);
  select type into v_type from businesses where id = p_business_id;
  if v_type is distinct from 'AGENT'::business_type then
    raise exception 'AGENT_BUSINESS_REQUIRED: float audit is only for agents'
      using errcode = '22023';
  end if;

  select coalesce(sum(l.debit_minor) - sum(l.credit_minor), 0)::bigint
    into v_cash
    from journal_lines l join accounts a on a.id = l.account_id
   where l.business_id = p_business_id and a.code = '1000';

  select coalesce(sum(l.debit_minor) - sum(l.credit_minor), 0)::bigint
    into v_upay
    from journal_lines l join accounts a on a.id = l.account_id
   where l.business_id = p_business_id and a.code = '1010';

  select coalesce(sum(t.amount_minor), 0)::bigint
    into v_commission
    from transactions t
   where t.business_id = p_business_id
     and t.kind = 'AGENT_COMMISSION'
     and (t.occurred_at at time zone 'Asia/Dhaka')::date = v_date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'wallet', wallet, 'expected_minor', expected_minor, 'source', 'manual'
         ) order by wallet), '[]'::jsonb)
    into v_wallets
    from (
      select t.wallet, sum(t.amount_minor)::bigint as expected_minor
        from transactions t
       where t.business_id = p_business_id
         and t.kind = 'MANUAL_WALLET'
         and t.wallet is not null
       group by t.wallet
    ) w;

  return jsonb_build_object(
    'period_date', v_date,
    'expected_cash_minor', v_cash,
    'expected_upay_minor', v_upay,
    'commission_minor', v_commission,
    'wallets', v_wallets,
    'already_audited', exists (
      select 1 from agent_float_audits
       where business_id = p_business_id and period_date = v_date
    )
  );
end $$;

create or replace function post_agent_audit(
  p_business_id uuid,
  p_counted_cash_minor bigint,
  p_actual_upay_minor bigint,
  p_wallets jsonb default '[]'::jsonb,
  p_period_date date default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_date date := coalesce(p_period_date, (now() at time zone 'Asia/Dhaka')::date);
  v_preview jsonb;
  v_expected_cash bigint;
  v_expected_upay bigint;
  v_audit_id uuid;
  v_wallet jsonb;
  v_expected_wallet bigint;
begin
  v_actor := _assert_is_owner(p_business_id);
  if p_counted_cash_minor is null or p_counted_cash_minor < 0
     or p_actual_upay_minor is null or p_actual_upay_minor < 0 then
    raise exception 'AMOUNT_INVALID: audited balances cannot be negative'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_wallets, '[]'::jsonb)) <> 'array' then
    raise exception 'WALLETS_INVALID: wallets must be an array'
      using errcode = '22023';
  end if;

  v_preview := agent_audit_preview(p_business_id, v_date);
  if (v_preview ->> 'already_audited')::boolean then
    raise exception 'ALREADY_AUDITED: this agent day already has an audit'
      using errcode = '23505';
  end if;
  v_expected_cash := (v_preview ->> 'expected_cash_minor')::bigint;
  v_expected_upay := (v_preview ->> 'expected_upay_minor')::bigint;

  insert into agent_float_audits (
    business_id, period_date, expected_cash_minor, counted_cash_minor,
    cash_variance_minor, expected_upay_minor, actual_upay_minor,
    upay_variance_minor, commission_minor, note, created_by
  ) values (
    p_business_id, v_date, v_expected_cash, p_counted_cash_minor,
    p_counted_cash_minor - v_expected_cash, v_expected_upay, p_actual_upay_minor,
    p_actual_upay_minor - v_expected_upay,
    (v_preview ->> 'commission_minor')::bigint,
    nullif(btrim(coalesce(p_note, '')), ''), v_actor
  ) returning id into v_audit_id;

  insert into agent_float_snapshots (
    audit_id, business_id, wallet, expected_minor, actual_minor, variance_minor, source
  ) values (
    v_audit_id, p_business_id, 'upay', v_expected_upay, p_actual_upay_minor,
    p_actual_upay_minor - v_expected_upay, 'verified'
  );

  for v_wallet in select value from jsonb_array_elements(coalesce(p_wallets, '[]'::jsonb)) loop
    if coalesce(btrim(v_wallet ->> 'wallet'), '') = ''
       or (v_wallet ->> 'actual_minor') is null
       or (v_wallet ->> 'actual_minor')::bigint < 0 then
      raise exception 'WALLETS_INVALID: each wallet needs a name and non-negative actual_minor'
        using errcode = '22023';
    end if;
    select coalesce((w ->> 'expected_minor')::bigint, 0) into v_expected_wallet
      from jsonb_array_elements(v_preview -> 'wallets') w
     where w ->> 'wallet' = v_wallet ->> 'wallet';
    v_expected_wallet := coalesce(v_expected_wallet, 0);
    insert into agent_float_snapshots (
      audit_id, business_id, wallet, expected_minor, actual_minor, variance_minor, source
    ) values (
      v_audit_id, p_business_id, btrim(v_wallet ->> 'wallet'), v_expected_wallet,
      (v_wallet ->> 'actual_minor')::bigint,
      (v_wallet ->> 'actual_minor')::bigint - v_expected_wallet, 'manual'
    );
  end loop;

  insert into audit_events (business_id, actor_user_id, action, reason, detail)
  values (p_business_id, v_actor, 'agent.day_audited', p_note,
          jsonb_build_object('agent_audit_id', v_audit_id,
                             'cash_variance_minor', p_counted_cash_minor - v_expected_cash,
                             'upay_variance_minor', p_actual_upay_minor - v_expected_upay));

  return jsonb_build_object(
    'audit_id', v_audit_id,
    'period_date', v_date,
    'cash_variance_minor', p_counted_cash_minor - v_expected_cash,
    'upay_variance_minor', p_actual_upay_minor - v_expected_upay
  );
end $$;

revoke execute on function agent_audit_preview(uuid, date) from public;
revoke execute on function post_agent_audit(uuid, bigint, bigint, jsonb, date, text) from public;
grant execute on function agent_audit_preview(uuid, date) to authenticated;
grant execute on function post_agent_audit(uuid, bigint, bigint, jsonb, date, text) to authenticated;
