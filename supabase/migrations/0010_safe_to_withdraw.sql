-- P8 planner: safe-to-withdraw, the deterministic answer to "how much can I take out today
-- without running short this week" (docs/08 section 6, docs/07 section 9).
--
-- This never calls a model. It walks the stored 7-day forecast against today's cleared
-- balance and the expenses that are already on the books, finds the lowest the balance is
-- projected to reach, and keeps a reserve and an uncertainty buffer back from it. Every
-- term is returned so the "Why?" sheet can show the full sum.
--
-- Features the formula references but we do not have yet (confirmed supplier dues, dispute
-- or refund holds) are reported as 0 and named in the payload, so the number is honest
-- about what it did and did not count rather than silently dropping a term.

create or replace function get_safe_to_withdraw(p_business_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_cleared bigint;
  v_forecast forecast_runs;
  v_reserve bigint;
  v_avg_daily_expense bigint;
  v_inflow_to_lowest bigint := 0;
  v_running bigint;
  v_lowest bigint;
  v_lowest_day date;
  v_buffer bigint := 0;
  v_safe bigint;
  v_shortfall bigint;
  v_day jsonb;
  v_idx int := 0;
begin
  if not has_role(p_business_id,
                  array['merchant_owner','agent_owner','manager']::member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED: planner is owner and manager only'
      using errcode = '42501';
  end if;

  -- Cleared balance now: the upay wallet (verified money) plus the cash drawer. Manual
  -- other-wallet balances (1030) are excluded by default per docs/08.
  select coalesce(sum(
           case when a.code in ('1000','1010')
                then jl.debit_minor - jl.credit_minor else 0 end), 0)::bigint
    into v_cleared
    from journal_lines jl
    join accounts a on a.id = jl.account_id
   where a.business_id = p_business_id;

  -- Latest sales forecast. No run, or an abstained one, means no recommendation.
  select * into v_forecast
    from forecast_runs
   where business_id = p_business_id and capability = 'sales7d'
   order by cutoff_date desc
   limit 1;

  if v_forecast.id is null or v_forecast.abstained or v_forecast.confidence = 'low' then
    return jsonb_build_object(
      'as_of', now(),
      'available', false,
      'reason', case
        when v_forecast.id is null then 'NO_FORECAST'
        when v_forecast.abstained then 'FORECAST_ABSTAINED'
        else 'CONFIDENCE_TOO_LOW' end,
      'current_cleared_minor', v_cleared,
      'confidence', coalesce(v_forecast.confidence, 'low')
    );
  end if;

  -- Operating reserve: three days of average operating expense over the last 30 days,
  -- or the owner's override from settings.
  select coalesce(sum(amount_minor), 0) / 30
    into v_avg_daily_expense
    from transactions
   where business_id = p_business_id
     and kind = 'EXPENSE'
     and occurred_at >= now() - interval '30 days'
     and not exists (select 1 from transactions r where r.reverses_txn_id = transactions.id);

  select coalesce(
           (settings ->> 'operating_reserve_minor')::bigint,
           v_avg_daily_expense * 3)
    into v_reserve
    from businesses where id = p_business_id;

  -- Walk the forecast days. The projected balance each day is today's cleared balance plus
  -- the conservative (p10) inflow so far. We have no dated future expenses yet, so the
  -- only downward pressure is what is already recorded; the lowest day is therefore the
  -- first, but the loop is written to hold once dues and holds are added later.
  v_running := v_cleared;
  v_lowest := v_cleared;
  v_lowest_day := v_today;

  for v_day in select * from jsonb_array_elements(v_forecast.days) loop
    v_idx := v_idx + 1;
    v_running := v_running + (v_day ->> 'p10_minor')::bigint;
    if v_running < v_lowest then
      v_lowest := v_running;
      v_lowest_day := (v_day ->> 'day')::date;
      v_inflow_to_lowest := v_running - v_cleared;
    end if;
  end loop;

  -- If the balance never dips below today (the usual case with inflow and no dated dues),
  -- the lowest point is now and the inflow-to-lowest is zero.
  if v_lowest >= v_cleared then
    v_lowest := v_cleared;
    v_lowest_day := v_today;
    v_inflow_to_lowest := 0;
  end if;

  -- Buffer widens as confidence falls: none on high, 5% of inflow-to-lowest on medium.
  if v_forecast.confidence = 'medium' then
    v_buffer := round(0.05 * greatest(v_inflow_to_lowest, 0))::bigint;
  end if;

  v_safe := greatest(0, v_lowest - v_reserve - v_buffer);
  v_shortfall := greatest(0, v_reserve - v_lowest);

  return jsonb_build_object(
    'as_of', now(),
    'available', true,
    'current_cleared_minor', v_cleared,
    'forecast_inflow_p10_7d_minor', (
      select coalesce(sum((d ->> 'p10_minor')::bigint), 0)
        from jsonb_array_elements(v_forecast.days) d),
    -- Named so the UI can show the gaps honestly: these terms are not yet counted.
    'confirmed_expenses_7d_minor', 0,
    'supplier_dues_7d_minor', 0,
    'dispute_refund_hold_minor', 0,
    'lowest_projected_day', v_lowest_day,
    'lowest_projected_balance_p10_minor', v_lowest,
    'reserve_minor', v_reserve,
    'uncertainty_buffer_minor', v_buffer,
    'safe_to_withdraw_minor', v_safe,
    'shortfall_minor', v_shortfall,
    'confidence', v_forecast.confidence,
    'model_version', v_forecast.model_version
  );
end $$;

-- What-if: re-run the same arithmetic with a hypothetical withdrawal and reserve, never a
-- model (docs/07 section 9). Returns whether the plan still stays above the reserve.
create or replace function simulate_withdrawal(
  p_business_id uuid,
  p_withdraw_minor bigint default 0,
  p_reserve_minor bigint default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_base jsonb;
  v_lowest bigint;
  v_reserve bigint;
  v_after bigint;
begin
  v_base := get_safe_to_withdraw(p_business_id);

  if not (v_base ->> 'available')::boolean then
    return v_base;
  end if;

  v_lowest := (v_base ->> 'lowest_projected_balance_p10_minor')::bigint;
  v_reserve := coalesce(p_reserve_minor, (v_base ->> 'reserve_minor')::bigint);

  -- Taking the money out today lowers every projected day by the same amount.
  v_after := v_lowest - greatest(coalesce(p_withdraw_minor, 0), 0);

  return jsonb_build_object(
    'withdraw_minor', greatest(coalesce(p_withdraw_minor, 0), 0),
    'reserve_minor', v_reserve,
    'lowest_after_minor', v_after,
    'below_reserve', v_after < v_reserve,
    'shortfall_minor', greatest(0, v_reserve - v_after),
    'lowest_projected_day', v_base ->> 'lowest_projected_day'
  );
end $$;

revoke execute on function get_safe_to_withdraw(uuid) from public;
revoke execute on function simulate_withdrawal(uuid, bigint, bigint) from public;
grant execute on function get_safe_to_withdraw(uuid) to authenticated;
grant execute on function simulate_withdrawal(uuid, bigint, bigint) to authenticated;
