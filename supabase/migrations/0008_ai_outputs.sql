-- P6 AI outputs schema.
-- forecast_runs: one row per nightly model run per business.
-- ai_outputs: every AI card shown in the app (advice, anomaly flags, match suggestions).
-- Both tables are append-only; no UPDATE/DELETE (block_mutation trigger).
-- The nightly Edge Function writes here; the app reads via the RPC/view.

create table forecast_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  capability text not null check (capability in ('sales7d', 'float24h')),
  cutoff_date date not null,
  model_version text not null,
  feature_version text not null default 'v1',
  confidence text not null check (confidence in ('high','medium','low')),
  abstained boolean not null default false,
  abstain_reason text,
  days jsonb not null default '[]',   -- array of {day, p10_minor, p50_minor, p90_minor}
  hours jsonb,                        -- float24h only: array of {date, hour, p50_minor, p90_minor}
  advice_en text,
  advice_bn text,
  input_hash text,
  latency_ms int,
  created_at timestamptz not null default now(),
  -- Only one run per business per capability per cutoff date.
  unique (business_id, capability, cutoff_date)
);

create table ai_outputs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  capability text not null check (capability in (
    'sales_forecast','float_forecast','match_suggestion',
    'anomaly_flag','briefing','kpi_explanation'
  )),
  -- What / Why / Confidence / Action fields (docs/08 section 3)
  what_en text,
  what_bn text,
  why_en text,
  why_bn text,
  action_en text,
  action_bn text,
  confidence text check (confidence in ('high','medium','low')),
  -- Machine-readable payload (raw model output)
  payload jsonb not null default '{}',
  -- Lineage
  model_version text,
  feature_version text,
  prompt_version text,
  input_hash text,
  latency_ms int,
  -- User feedback
  feedback text check (feedback in ('helpful','not_helpful','wrong')),
  feedback_at timestamptz,
  feedback_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Anomaly flags are a special case: one row per flagged transaction.
create table ai_anomaly_flags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  transaction_id uuid not null references transactions(id),
  score numeric(4,3) not null check (score between 0 and 1),
  label text not null default 'needs_review' check (label = 'needs_review'),
  reason_codes text[] not null default '{}',
  reason_bn text[] not null default '{}',
  model_version text,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Indexes
create index forecast_runs_business_idx
  on forecast_runs (business_id, capability, cutoff_date desc);
create index ai_outputs_business_idx
  on ai_outputs (business_id, capability, created_at desc);
create index ai_anomaly_flags_business_idx
  on ai_anomaly_flags (business_id, resolved, created_at desc);
create index ai_anomaly_flags_txn_idx
  on ai_anomaly_flags (transaction_id);

-- RLS
alter table forecast_runs      enable row level security;
alter table ai_outputs         enable row level security;
alter table ai_anomaly_flags   enable row level security;

-- Owners and managers can read their own AI outputs.
create policy forecast_runs_owner_read on forecast_runs for select
  to authenticated
  using (has_role(business_id, array['merchant_owner','agent_owner','manager']::member_role[]));

create policy ai_outputs_owner_read on ai_outputs for select
  to authenticated
  using (has_role(business_id, array['merchant_owner','agent_owner','manager','staff']::member_role[]));

create policy ai_anomaly_flags_owner_read on ai_anomaly_flags for select
  to authenticated
  using (has_role(business_id, array['merchant_owner','agent_owner','manager']::member_role[]));

-- Write is only via Edge Function (service role); revoke direct client writes.
revoke all on forecast_runs, ai_outputs, ai_anomaly_flags from public, anon, authenticated;
grant select on forecast_runs, ai_outputs, ai_anomaly_flags to authenticated;

-- Append-only for forecast_runs and ai_outputs.
create trigger trg_forecast_runs_append_only
  before update or delete on forecast_runs
  for each row execute function block_mutation();
create trigger trg_ai_outputs_append_only
  before update or delete on ai_outputs
  for each row execute function block_mutation();

-- Anomaly flags CAN be resolved (boolean flip) but not deleted.
-- Use a restricted update policy via RPC instead.
create trigger trg_ai_anomaly_flags_no_delete
  before delete on ai_anomaly_flags
  for each row execute function block_mutation();

-- View: latest forecast per business (the app reads this).
create or replace view v_latest_forecast as
select distinct on (business_id, capability)
  business_id, capability, cutoff_date, model_version, confidence,
  abstained, abstain_reason, days, hours, advice_en, advice_bn, created_at
from forecast_runs
order by business_id, capability, cutoff_date desc;

-- Resolve anomaly flag RPC (owner-only).
create or replace function resolve_anomaly_flag(
  p_flag_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_bid   uuid;
begin
  select business_id into v_bid from ai_anomaly_flags where id = p_flag_id;
  if v_bid is null then
    raise exception 'FLAG_NOT_FOUND' using errcode = '22023';
  end if;
  v_actor := _assert_is_owner(v_bid);
  update ai_anomaly_flags
     set resolved = true, resolved_at = now(), resolved_by = v_actor
   where id = p_flag_id and resolved = false;
end $$;

revoke execute on function resolve_anomaly_flag(uuid) from public;
grant  execute on function resolve_anomaly_flag(uuid) to authenticated;

-- Daily sales helper for the nightly AI edge function and merchant analytics.
create or replace function business_daily_sales(
  p_business_id uuid,
  p_since date,
  p_until date
) returns table (
  day date,
  sales_minor bigint
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with days as (
    select generate_series(p_since, p_until, '1 day'::interval)::date as d
  ),
  daily as (
    select (t.occurred_at at time zone 'Asia/Dhaka')::date as dt,
           coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint as net_sales
      from journal_lines l
      join accounts a on a.id = l.account_id
      join journal_entries je on je.id = l.entry_id
      join transactions t on t.id = je.transaction_id
     where a.business_id = p_business_id
       and a.code in ('4000', '4010')
       and (t.occurred_at at time zone 'Asia/Dhaka')::date between p_since and p_until
     group by (t.occurred_at at time zone 'Asia/Dhaka')::date
  )
  select days.d as day, coalesce(daily.net_sales, 0)::bigint as sales_minor
    from days
    left join daily on daily.dt = days.d
   order by days.d asc;
end $$;

revoke execute on function business_daily_sales(uuid, date, date) from public;
grant  execute on function business_daily_sales(uuid, date, date) to authenticated, service_role;

