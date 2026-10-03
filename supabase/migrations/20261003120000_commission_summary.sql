-- Phase A1 (docs/14 role features): agent commission statement.
--
-- commission_summary(business_id) rolls up AGENT_COMMISSION earnings for the agent's own
-- business: today, this week, this month, and a per-day breakdown of the last 7 days. It is
-- agent-only and owner/manager-only, and every figure is the sum of posted commission
-- transactions - the ledger, never an estimate.

create or replace function commission_summary(p_business_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_type business_type;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_week_start date := v_today - 6;          -- last 7 days inclusive
  v_month_start date := date_trunc('month', v_today)::date;
  v_result jsonb;
begin
  if not has_role(p_business_id, array['agent_owner','manager']::member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED: commission is owner and manager only'
      using errcode = '42501';
  end if;

  select type into v_type from businesses where id = p_business_id;
  if v_type <> 'AGENT' then
    raise exception 'ROLE_NOT_PERMITTED: wrong business type' using errcode = '42501';
  end if;

  with live as (
    -- Posted commission that still stands (a reversed one and its mirror are excluded).
    select t.amount_minor, (t.occurred_at at time zone 'Asia/Dhaka')::date as d
      from transactions t
     where t.business_id = p_business_id
       and t.kind = 'AGENT_COMMISSION'
       and not exists (select 1 from transactions r where r.reverses_txn_id = t.id)
  )
  select jsonb_build_object(
    'today_minor', coalesce(sum(amount_minor) filter (where d = v_today), 0),
    'count_today', count(*) filter (where d = v_today),
    'week_minor', coalesce(sum(amount_minor) filter (where d >= v_week_start), 0),
    'month_minor', coalesce(sum(amount_minor) filter (where d >= v_month_start), 0),
    'by_day', (
      -- One row per day for the last 7 days, zero-filled, newest first.
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', day,
               'amount_minor', coalesce((select sum(l.amount_minor) from live l where l.d = day), 0))
             order by day desc), '[]'::jsonb)
        from generate_series(v_week_start, v_today, interval '1 day') g(day)
    )
  ) into v_result
  from live;

  return v_result;
end $$;

revoke execute on function commission_summary(uuid) from public;
grant execute on function commission_summary(uuid) to authenticated;
