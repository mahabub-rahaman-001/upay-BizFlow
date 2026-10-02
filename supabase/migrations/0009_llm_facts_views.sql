-- P7 Language AI: the facts the LLM is allowed to see.
--
-- The model never computes a number and never reads the ledger. It receives this facts
-- payload and writes sentences around figures that are already final, and a validator
-- then checks every number in its text came from here (CLAUDE.md, docs/08).
--
-- So the rules for this file are:
--   - every figure is derived from the journal, the same way the app derives it
--   - a reversed transaction and its mirror are excluded from totals, or the facts would
--     disagree with what the owner sees on screen
--   - business time is Asia/Dhaka, not UTC: "yesterday" must mean the shop's yesterday
--   - views run as the caller (security_invoker), so RLS does the scoping
--   - the llm_facts_* wrappers are for the AI service's service-role key only
--
-- Nothing here reports on suppliers, payables or a review queue: those features do not
-- exist yet, and a facts view that invents them would feed the model numbers that are not
-- real. They arrive with P4 M6 and the matching work.

-- ------------------------------------------------------------------ Display helper
-- The LLM is handed money already formatted so it never has to render a figure itself.
-- Grouping is South Asian (lakh): 12,34,567 rather than 1,234,567.
create or replace function poisha_to_tk(p_minor bigint)
returns text
language plpgsql immutable as $$
declare
  v_taka text := trunc(abs(p_minor) / 100.0)::bigint::text;
  v_head text;
  v_tail text;
begin
  if length(v_taka) <= 3 then
    return 'Tk ' || case when p_minor < 0 then '-' else '' end || v_taka;
  end if;

  v_tail := right(v_taka, 3);
  v_head := left(v_taka, length(v_taka) - 3);
  -- Everything above the last three digits groups in pairs.
  v_head := reverse(regexp_replace(reverse(v_head), '(\d{2})(?=\d)', '\1,', 'g'));

  return 'Tk ' || case when p_minor < 0 then '-' else '' end || v_head || ',' || v_tail;
end $$;

-- ------------------------------------------------------------------ Live transactions
-- Sales and expenses that still stand: a transaction that was reversed, and the REVERSAL
-- that cancelled it, are both left out so totals match the books.
create or replace view v_live_transactions
with (security_invoker = true) as
select
  t.id,
  t.business_id,
  t.kind,
  t.source,
  t.amount_minor,
  t.category,
  t.occurred_at,
  (t.occurred_at at time zone 'Asia/Dhaka')::date as business_date
from transactions t
where t.kind <> 'REVERSAL'
  and not exists (select 1 from transactions r where r.reverses_txn_id = t.id);

-- ------------------------------------------------------------------ Daily summary
-- Yesterday in Dhaka terms, for the morning briefing and the KPI explanation.
create or replace view v_llm_daily_summary
with (security_invoker = true) as
select
  b.id as business_id,
  coalesce(sum(lt.amount_minor) filter (
    where lt.kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE')), 0)::bigint
    as yesterday_sales_minor,
  coalesce(sum(lt.amount_minor) filter (where lt.kind = 'QR_PAYMENT'), 0)::bigint
    as yesterday_digital_minor,
  coalesce(sum(lt.amount_minor) filter (where lt.kind = 'CASH_SALE'), 0)::bigint
    as yesterday_cash_minor,
  coalesce(sum(lt.amount_minor) filter (where lt.kind = 'BAKI_SALE'), 0)::bigint
    as yesterday_baki_minor,
  coalesce(sum(lt.amount_minor) filter (where lt.kind = 'EXPENSE'), 0)::bigint
    as yesterday_expense_minor,
  coalesce(round(
    100.0 * sum(lt.amount_minor) filter (where lt.kind = 'QR_PAYMENT')
    / nullif(sum(lt.amount_minor) filter (
        where lt.kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE')), 0)
  ), 0)::int as digital_share_pct,
  count(*) filter (
    where lt.kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE'))::int
    as txn_count_yesterday,
  (
    select lt2.category
      from v_live_transactions lt2
     where lt2.business_id = b.id
       and lt2.business_date = (now() at time zone 'Asia/Dhaka')::date - 1
       and lt2.kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE')
       and lt2.category is not null
     group by lt2.category
     order by sum(lt2.amount_minor) desc
     limit 1
  ) as top_category
from businesses b
left join v_live_transactions lt
       on lt.business_id = b.id
      and lt.business_date = (now() at time zone 'Asia/Dhaka')::date - 1
group by b.id;

-- ------------------------------------------------------------------ Seven-day KPIs
create or replace view v_llm_kpi_facts
with (security_invoker = true) as
select
  b.id as business_id,
  coalesce(sum(lt.amount_minor) filter (
    where lt.kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE')), 0)::bigint
    as revenue_7d_minor,
  coalesce(sum(lt.amount_minor) filter (where lt.kind = 'EXPENSE'), 0)::bigint
    as expense_7d_minor,
  coalesce(round(
    100.0 * sum(lt.amount_minor) filter (where lt.kind = 'QR_PAYMENT')
    / nullif(sum(lt.amount_minor) filter (
        where lt.kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE')), 0)
  ), 0)::int as digital_share_7d_pct,
  -- What customers still owe is the balance of 1100 Baki receivable, the same figure the
  -- Books screen shows; there is no separate baki table to drift from it.
  coalesce((
    select sum(jl.debit_minor) - sum(jl.credit_minor)
      from journal_lines jl
      join accounts a on a.id = jl.account_id
     where a.business_id = b.id and a.code = '1100'
  ), 0)::bigint as baki_outstanding_minor
from businesses b
left join v_live_transactions lt
       on lt.business_id = b.id
      and lt.occurred_at >= now() - interval '7 days'
group by b.id;

-- ------------------------------------------------------------------ Forecast facts
-- The latest run per business, with the week's range. The model's own numbers, passed
-- through untouched.
create or replace view v_llm_forecast_facts
with (security_invoker = true) as
select distinct on (fr.business_id)
  fr.business_id,
  fr.model_version,
  fr.confidence as forecast_confidence,
  fr.cutoff_date,
  fr.abstained,
  fr.abstain_reason,
  coalesce((select sum((d ->> 'p10_minor')::bigint)
              from jsonb_array_elements(fr.days) d), 0)::bigint
    as forecast_week_p10_minor,
  coalesce((select sum((d ->> 'p50_minor')::bigint)
              from jsonb_array_elements(fr.days) d), 0)::bigint
    as forecast_week_p50_minor,
  coalesce((select sum((d ->> 'p90_minor')::bigint)
              from jsonb_array_elements(fr.days) d), 0)::bigint
    as forecast_week_p90_minor
from forecast_runs fr
where fr.capability = 'sales7d'
order by fr.business_id, fr.cutoff_date desc;

-- ------------------------------------------------------------------ Float facts (agent)
-- Cash drawer and e-float straight from the ledger, which is where the agent screens read
-- them from too.
create or replace view v_llm_float_facts
with (security_invoker = true) as
select
  a.business_id,
  coalesce(sum(jl.debit_minor - jl.credit_minor) filter (where a.code = '1000'), 0)::bigint
    as drawer_cash_minor,
  coalesce(sum(jl.debit_minor - jl.credit_minor) filter (where a.code = '1010'), 0)::bigint
    as efloat_minor,
  coalesce(sum(jl.debit_minor - jl.credit_minor) filter (where a.code = '1030'), 0)::bigint
    as other_wallets_minor
from accounts a
join journal_lines jl on jl.account_id = a.id
where a.code in ('1000','1010','1030')
group by a.business_id;

-- ------------------------------------------------------------------ Pending settlement
-- The closest thing we have to a review queue today: money taken but not yet settled.
create or replace view v_llm_pending_facts
with (security_invoker = true) as
select
  t.business_id,
  count(*)::int as pending_count,
  coalesce(sum(t.amount_minor), 0)::bigint as pending_total_minor
from transactions t
where t.kind = 'QR_PAYMENT'
  and t.wallet = 'pending'
  and not exists (select 1 from transactions r where r.reverses_txn_id = t.id)
  and not exists (
    select 1
      from transactions s
      join payment_events se on se.id = s.payment_event_id
      join payment_events oe on oe.id = t.payment_event_id
     where s.kind = 'SETTLEMENT'
       and se.provider_txn_id = oe.provider_txn_id)
group by t.business_id;

grant select on
  v_live_transactions, v_llm_daily_summary, v_llm_kpi_facts,
  v_llm_forecast_facts, v_llm_float_facts, v_llm_pending_facts
to authenticated;

-- ------------------------------------------------------------------ Facts RPCs
-- The AI service calls these with the service-role key while building a facts payload. A
-- service-role caller has no auth.uid(), so the scoping is the business_id argument, and
-- the job that supplies it came from our own queue - never from user input. They are
-- granted to service_role alone: an app user reads the views above instead, where RLS
-- applies.
create or replace function llm_facts_daily_summary(p_business_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(v) from v_llm_daily_summary v where v.business_id = p_business_id;
$$;

create or replace function llm_facts_kpis(p_business_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(v) from v_llm_kpi_facts v where v.business_id = p_business_id;
$$;

create or replace function llm_facts_forecast(p_business_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(v) from v_llm_forecast_facts v where v.business_id = p_business_id;
$$;

create or replace function llm_facts_float(p_business_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(v) from v_llm_float_facts v where v.business_id = p_business_id;
$$;

create or replace function llm_facts_pending(p_business_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select to_jsonb(v) from v_llm_pending_facts v where v.business_id = p_business_id),
    jsonb_build_object('business_id', p_business_id,
                       'pending_count', 0, 'pending_total_minor', 0));
$$;

-- Everything the briefing needs, in one call, with the display strings filled in so the
-- model copies them rather than formatting anything itself.
create or replace function llm_facts_briefing(p_business_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'business_id', p_business_id,
    'as_of', (now() at time zone 'Asia/Dhaka'),
    'daily', llm_facts_daily_summary(p_business_id),
    'kpis', llm_facts_kpis(p_business_id),
    'forecast', llm_facts_forecast(p_business_id),
    'pending', llm_facts_pending(p_business_id),
    'display', jsonb_build_object(
      'yesterday_sales',
        poisha_to_tk((llm_facts_daily_summary(p_business_id) ->> 'yesterday_sales_minor')::bigint),
      'yesterday_expense',
        poisha_to_tk((llm_facts_daily_summary(p_business_id) ->> 'yesterday_expense_minor')::bigint),
      'baki_outstanding',
        poisha_to_tk((llm_facts_kpis(p_business_id) ->> 'baki_outstanding_minor')::bigint),
      'pending_total',
        poisha_to_tk((llm_facts_pending(p_business_id) ->> 'pending_total_minor')::bigint)
    )
  );
$$;

revoke execute on function poisha_to_tk(bigint) from public;
revoke execute on function llm_facts_daily_summary(uuid) from public;
revoke execute on function llm_facts_kpis(uuid) from public;
revoke execute on function llm_facts_forecast(uuid) from public;
revoke execute on function llm_facts_float(uuid) from public;
revoke execute on function llm_facts_pending(uuid) from public;
revoke execute on function llm_facts_briefing(uuid) from public;

grant execute on function poisha_to_tk(bigint) to service_role, authenticated;
grant execute on function llm_facts_daily_summary(uuid) to service_role;
grant execute on function llm_facts_kpis(uuid) to service_role;
grant execute on function llm_facts_forecast(uuid) to service_role;
grant execute on function llm_facts_float(uuid) to service_role;
grant execute on function llm_facts_pending(uuid) to service_role;
grant execute on function llm_facts_briefing(uuid) to service_role;

-- ------------------------------------------------------------------ Assistant tools
-- Answers to the questions the in-app assistant can be asked. These run as the signed-in
-- user, so is_member decides what is visible and a member of one shop cannot ask about
-- another by passing its id.
create or replace function assistant_sales_summary(
  p_business_id uuid,
  p_period text default 'yesterday'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_from date;
  v_to date;
begin
  if not is_member(p_business_id) then
    raise exception 'NOT_A_MEMBER: no active membership for this business'
      using errcode = '42501';
  end if;

  case p_period
    when 'today'     then v_from := v_today;      v_to := v_today + 1;
    when 'yesterday' then v_from := v_today - 1;  v_to := v_today;
    when 'week'      then v_from := v_today - 7;  v_to := v_today + 1;
    when 'month'     then v_from := v_today - 30; v_to := v_today + 1;
    else
      raise exception 'PERIOD_INVALID: period must be today, yesterday, week or month'
        using errcode = '22023';
  end case;

  return (
    select jsonb_build_object(
      'period', p_period,
      'from_date', v_from,
      'to_date', v_to - 1,
      'total_minor', coalesce(sum(lt.amount_minor), 0),
      'digital_minor', coalesce(sum(lt.amount_minor) filter (where lt.kind = 'QR_PAYMENT'), 0),
      'cash_minor', coalesce(sum(lt.amount_minor) filter (where lt.kind = 'CASH_SALE'), 0),
      'baki_minor', coalesce(sum(lt.amount_minor) filter (where lt.kind = 'BAKI_SALE'), 0),
      'txn_count', count(*)
    )
    from v_live_transactions lt
    where lt.business_id = p_business_id
      and lt.kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE')
      and lt.business_date >= v_from
      and lt.business_date < v_to
  );
end $$;

create or replace function assistant_baki_summary(p_business_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_business_id) then
    raise exception 'NOT_A_MEMBER: no active membership for this business'
      using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'total_outstanding_minor', coalesce(sum(balance_minor) filter (where balance_minor > 0), 0),
      'customer_count', count(*) filter (where balance_minor > 0)
    )
    from customer_balances(p_business_id)
  );
end $$;

create or replace function assistant_pending_summary(p_business_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_business_id) then
    raise exception 'NOT_A_MEMBER: no active membership for this business'
      using errcode = '42501';
  end if;

  return llm_facts_pending(p_business_id);
end $$;

revoke execute on function assistant_sales_summary(uuid, text) from public;
revoke execute on function assistant_baki_summary(uuid) from public;
revoke execute on function assistant_pending_summary(uuid) from public;

grant execute on function assistant_sales_summary(uuid, text) to authenticated;
grant execute on function assistant_baki_summary(uuid) to authenticated;
grant execute on function assistant_pending_summary(uuid) to authenticated;

-- ------------------------------------------------------------------ Briefing cache
-- One briefing per business per day, so a reopened app does not pay for the same LLM call
-- twice. facts_hash lets a changed day invalidate it.
create table llm_briefing_cache (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  cache_date date not null,
  briefing_bn text not null,
  facts_hash text not null,
  prompt_version text not null default 'briefing-v1.0',
  model_version text,
  -- True when the model was unavailable and the deterministic template answered instead.
  from_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, cache_date)
);

alter table llm_briefing_cache enable row level security;

create policy briefing_cache_read on llm_briefing_cache for select
  to authenticated
  using (has_role(business_id,
                  array['merchant_owner','agent_owner','manager','staff']::member_role[]));

-- Written by the AI service only.
revoke all on llm_briefing_cache from public, anon, authenticated;
grant select on llm_briefing_cache to authenticated;
