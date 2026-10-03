-- Role boundaries and deterministic daily insights (docs/14).
-- No financial rows are changed. Every displayed number is a server fact.

create function public._assert_business_type(p_business_id uuid, p_type public.business_type)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.businesses where id = p_business_id and type = p_type) then
    raise exception 'ROLE_NOT_PERMITTED: wrong business type' using errcode = '42501';
  end if;
end $$;
revoke all on function public._assert_business_type(uuid, public.business_type) from public, anon, authenticated;

-- Serialize membership changes for one person, including concurrent onboarding.
create function public.enforce_account_role() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_type public.business_type;
begin
  perform 1 from auth.users where id = new.user_id for update;
  select type into v_type from public.businesses where id = new.business_id;
  if (new.role = 'merchant_owner' and v_type <> 'MERCHANT')
     or (new.role = 'agent_owner' and v_type <> 'AGENT')
     or exists (select 1 from public.memberships m join public.businesses b on b.id = m.business_id
       where m.user_id = new.user_id and b.type <> v_type) then
    raise exception 'ROLE_NOT_PERMITTED: one account has one business type' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.enforce_account_role() from public, anon, authenticated;
create trigger memberships_one_role before insert or update on public.memberships
for each row execute function public.enforce_account_role();

create function public.prevent_business_role_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.type <> old.type then
    raise exception 'ROLE_NOT_PERMITTED: business type is permanent' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.prevent_business_role_change() from public, anon, authenticated;
create trigger business_type_permanent before update of type on public.businesses
for each row execute function public.prevent_business_role_change();

-- Retain each RPC's original signature, idempotency and accounting implementation.
-- Add the business-type assertion before its existing permission checks.
do $$
declare r record; v_definition text; v_type text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'post_cash_sale','post_expense','post_baki_sale','post_baki_collection',
      'create_customer','closing_preview','post_closing','reopen_closing',
      'create_supplier','create_payable','confirm_payable','pay_payable','cancel_payable',
      'post_refund','get_safe_to_withdraw','assistant_sales_summary','assistant_baki_summary',
      'post_manual_wallet','agent_audit_preview','post_agent_audit'])
  loop
    v_type := case when r.proname in ('post_manual_wallet','agent_audit_preview','post_agent_audit') then 'AGENT' else 'MERCHANT' end;
    v_definition := pg_get_functiondef(r.oid);
    v_definition := regexp_replace(v_definition, '\mbegin\M',
      'begin' || chr(10) || format('  perform public._assert_business_type(p_business_id, %L);', v_type), 'i');
    execute v_definition;
  end loop;
end $$;

-- Scope direct fact reads as well as service-only RPC wrappers.
do $$
declare r record; v_definition text;
begin
  for r in select * from (values
    ('v_llm_daily_summary','MERCHANT'), ('v_llm_kpi_facts','MERCHANT'),
    ('v_llm_forecast_facts','MERCHANT'), ('v_llm_float_facts','AGENT')) x(name, role_type)
  loop
    v_definition := rtrim(pg_get_viewdef(('public.' || r.name)::regclass, true), ';' || chr(10));
    execute format('create or replace view public.%I with (security_invoker = true) as
      select facts.* from (%s) facts join public.businesses b on b.id = facts.business_id where b.type = %L',
      r.name, v_definition, r.role_type);
  end loop;
end $$;

alter policy forecast_runs_owner_read on public.forecast_runs using (
  public.has_role(business_id, array['merchant_owner','agent_owner','manager']::public.member_role[])
  and exists (select 1 from public.businesses b where b.id = business_id
    and ((b.type = 'MERCHANT' and capability = 'sales7d') or (b.type = 'AGENT' and capability = 'float24h'))));
alter policy ai_outputs_owner_read on public.ai_outputs using (
  public.has_role(business_id, array['merchant_owner','agent_owner','manager','staff']::public.member_role[])
  and exists (select 1 from public.businesses b where b.id = business_id
    and ((b.type = 'MERCHANT' and capability <> 'float_forecast')
      or (b.type = 'AGENT' and capability in ('float_forecast','anomaly_flag','briefing')))));

create or replace function public.get_forecast(p_business_id uuid, p_capability text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_type public.business_type; v_result jsonb;
begin
  if not public.has_role(p_business_id, array['merchant_owner','agent_owner','manager']::public.member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED' using errcode = '42501';
  end if;
  select type into v_type from public.businesses where id = p_business_id;
  if p_capability is null or p_capability <> (case v_type when 'MERCHANT' then 'sales7d' else 'float24h' end) then
    raise exception 'ROLE_NOT_PERMITTED: cross-role forecast' using errcode = '42501';
  end if;
  if not public.feature_enabled('ai.forecast', p_business_id) then
    return jsonb_build_object('capability', p_capability, 'abstained', true, 'fallback', true,
      'confidence', 'low', 'abstain_reason', 'AI_DISABLED', 'days', '[]'::jsonb, 'hours', '[]'::jsonb);
  end if;
  select to_jsonb(f) into v_result from public.forecast_runs f
    where business_id = p_business_id and capability = p_capability
    order by cutoff_date desc limit 1;
  return v_result;
end $$;

-- Invoker security keeps staff transaction visibility intact. Only management receives
-- forecast, payable, anomaly or liquidity facts in today_insights.
create function public.agent_peak_hours(p_business_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_days integer; v_count integer; v_start integer; v_expected integer;
begin
  if not public.has_role(p_business_id, array['agent_owner','manager']::public.member_role[])
    or not exists (select 1 from public.businesses where id = p_business_id and type = 'AGENT') then
    raise exception 'ROLE_NOT_PERMITTED' using errcode = '42501';
  end if;
  select count(distinct business_date), count(*) into v_days, v_count
    from public.v_live_transactions where business_id = p_business_id
    and business_date >= v_today - 28 and business_date < v_today
    and kind in ('AGENT_CASH_IN','AGENT_CASH_OUT','AGENT_SEND_MONEY');
  if v_days < 7 or v_count < 20 or not public.feature_enabled('ai.forecast', p_business_id) then
    return jsonb_build_object('abstained', true, 'sample_days', v_days, 'sample_count', v_count,
      'model_version', 'hourly-count-mean-v1', 'confidence', 'low');
  end if;
  select h, round(count(t.id)::numeric / 28)::integer into v_start, v_expected
    from generate_series(0,21) h left join public.v_live_transactions t
      on t.business_id = p_business_id and t.business_date >= v_today - 28 and t.business_date < v_today
      and t.kind in ('AGENT_CASH_IN','AGENT_CASH_OUT','AGENT_SEND_MONEY')
      and extract(hour from t.occurred_at at time zone 'Asia/Dhaka') >= h
      and extract(hour from t.occurred_at at time zone 'Asia/Dhaka') < h + 3
    group by h order by count(t.id) desc, h asc limit 1;
  return jsonb_build_object('abstained', false, 'sample_days', v_days, 'sample_count', v_count,
    'start_hour', v_start, 'end_hour', v_start + 3, 'expected_count', v_expected,
    'confidence', case when v_days >= 21 then 'medium' else 'low' end,
    'model_version', 'hourly-count-mean-v1', 'timezone', 'Asia/Dhaka');
end $$;
revoke all on function public.agent_peak_hours(uuid) from public, anon;
grant execute on function public.agent_peak_hours(uuid) to authenticated;

create function public.insight_card(p_id text, p_icon text, p_severity text,
  p_title_bn text, p_body_bn text, p_title_en text, p_body_en text,
  p_facts jsonb, p_route text default null) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', p_id, 'icon', p_icon, 'severity', p_severity,
    'title_bn', p_title_bn, 'body_bn', translate(p_body_bn, '0123456789', '০১২৩৪৫৬৭৮৯'),
    'title_en', p_title_en, 'body_en', p_body_en, 'facts', p_facts, 'action_route', p_route);
$$;
revoke all on function public.insight_card(text,text,text,text,text,text,text,jsonb,text) from public, anon;
grant execute on function public.insight_card(text,text,text,text,text,text,text,jsonb,text) to authenticated;

create function public.today_insights(p_business_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_type public.business_type;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_cards jsonb := '[]'; v_facts jsonb; v_forecast jsonb; v_day jsonb; v_peak jsonb;
  v_manager boolean; v_pending integer; v_flags integer;
  v_total integer; v_active integer; v_previous integer; v_new integer;
  v_cash bigint; v_float bigint; v_demand bigint; v_efloat_demand bigint;
  v_dues bigint; v_due_count integer; v_summary bigint; v_count integer;
begin
  if not public.is_member(p_business_id) then
    raise exception 'NOT_A_MEMBER' using errcode = '42501';
  end if;
  select type into v_type from public.businesses where id = p_business_id;
  v_manager := public.has_role(p_business_id, array['merchant_owner','agent_owner','manager']::public.member_role[]);

  if v_manager then
    select count(*) filter (where reason_code = 'PENDING_SETTLEMENT'),
      count(*) filter (where reason_code = 'ANOMALY') into v_pending, v_flags
      from public.review_queue(p_business_id);
    if v_pending > 0 then
      v_cards := v_cards || public.insight_card('pending','clock','warn', 'পেমেন্টের অবস্থা দেখুন',
        format('%sটি পেমেন্টের সেটেলমেন্ট যাচাই করা দরকার।', v_pending),
        'Check payment status', format('%s payments need a settlement review.', v_pending),
        jsonb_build_object('pending_count', v_pending), case v_type when 'MERCHANT' then '/review' else '/transactions' end);
    end if;
    if v_flags > 0 then
      v_cards := v_cards || public.insight_card('anomaly','alert-triangle','warn', 'লেনদেন যাচাই করুন',
        format('%sটি অস্বাভাবিক লেনদেন দেখে নিন। এগুলো ভুল বা জালিয়াতির প্রমাণ নয়।', v_flags),
        'Transactions need a look', format('%s unusual transactions need review; this is not a finding of fraud.', v_flags),
        jsonb_build_object('flag_count', v_flags), case v_type when 'MERCHANT' then '/review' else '/transactions' end);
    end if;

    v_forecast := public.get_forecast(p_business_id, case v_type when 'MERCHANT' then 'sales7d' else 'float24h' end);
    if v_type = 'MERCHANT' then
      select d into v_day from jsonb_array_elements(case when jsonb_typeof(v_forecast->'days')='array' then v_forecast->'days' else '[]'::jsonb end) d where d->>'day' = v_today::text limit 1;
      if v_day is not null and not coalesce((v_forecast->>'abstained')::boolean,true) then
        v_cards := v_cards || public.insight_card('sales-forecast','trending-up','info', 'আজকের বিক্রির পূর্বাভাস',
          format('আজ আনুমানিক %s থেকে %s বিক্রি হতে পারে। এটি নিশ্চয়তা নয়।', public.poisha_to_tk((v_day->>'p10_minor')::bigint), public.poisha_to_tk((v_day->>'p90_minor')::bigint)),
          'Today’s sales estimate', format('Estimated sales today: %s to %s. This is not guaranteed.', public.poisha_to_tk((v_day->>'p10_minor')::bigint), public.poisha_to_tk((v_day->>'p90_minor')::bigint)),
          v_day || jsonb_build_object('confidence',v_forecast->>'confidence','model_version',v_forecast->>'model_version'), '/planner');
      else
        v_cards := v_cards || public.insight_card('sales-forecast','trending-up','info','আজকের পূর্বাভাস প্রস্তুত নয়',
          'আজকের জন্য পর্যাপ্ত হালনাগাদ তথ্য নেই। আপাতত খাতার হিসাব দেখুন।','Today’s forecast is unavailable',
          'There is not enough current forecast data for today. Check your books.', jsonb_build_object('abstained',true), '/books');
      end if;
      v_facts := public.get_safe_to_withdraw(p_business_id);
      select coalesce(sum(amount_remaining_minor),0), count(*) into v_dues, v_due_count
        from public.supplier_payables where business_id = p_business_id
        and status in ('CONFIRMED','PARTIALLY_PAID','OVERDUE') and due_date <= v_today + 7;
      v_cards := v_cards || public.insight_card('cash-flow','wallet',case when v_dues > 0 then 'warn' else 'info' end,
        'নগদ ও সরবরাহকারীর পাওনা',
        format('আগামী সপ্তাহসহ বকেয়া বিল %s। %s',public.poisha_to_tk(v_dues),
          case when (v_facts->>'available')::boolean then 'পরিকল্পনার হিসাবে তোলা যেতে পারে ' || public.poisha_to_tk((v_facts->>'safe_to_withdraw_minor')::bigint) || '। সীমাবদ্ধতা দেখে সিদ্ধান্ত নিন।' else 'নিরাপদ উত্তোলনের হিসাব প্রস্তুত নয়।' end),
        'Cash flow and supplier dues', format('Overdue and upcoming bills: %s. %s',public.poisha_to_tk(v_dues),
          case when (v_facts->>'available')::boolean then 'Planner estimate available to withdraw: ' || public.poisha_to_tk((v_facts->>'safe_to_withdraw_minor')::bigint) || '. Check its limitations before deciding.' else 'A withdrawal estimate is unavailable.' end),
        v_facts || jsonb_build_object('due_minor',v_dues,'due_count',v_due_count), '/planner');
      select to_jsonb(k) into v_facts from public.v_llm_kpi_facts k where business_id = p_business_id;
      v_cards := v_cards || public.insight_card('sales-trend','bar-chart','info','বিক্রির ধারা',
        format('সাম্প্রতিক সপ্তাহে বিক্রি %s; ডিজিটাল অংশ %s%%।', public.poisha_to_tk((v_facts->>'revenue_7d_minor')::bigint),v_facts->>'digital_share_7d_pct'),
        'Sales mix',format('Recent weekly sales: %s; digital share: %s%%.',public.poisha_to_tk((v_facts->>'revenue_7d_minor')::bigint),v_facts->>'digital_share_7d_pct'),v_facts, '/transactions');
    else
      select coalesce(sum(balance_minor) filter (where code = '1000'),0), coalesce(sum(balance_minor) filter (where code = '1010'),0)
        into v_cash, v_float from public.v_account_balances where business_id = p_business_id;
      select sum(greatest((h->>'p90_minor')::bigint,0)), sum((h->>'efloat_p90_minor')::bigint)
        into v_demand, v_efloat_demand from jsonb_array_elements(case when jsonb_typeof(v_forecast->'hours')='array' then v_forecast->'hours' else '[]'::jsonb end) h
        where h->>'date' = v_today::text and (h->>'hour')::int >= extract(hour from now() at time zone 'Asia/Dhaka');
      if coalesce((v_forecast->>'abstained')::boolean,true) then v_demand := null; v_efloat_demand := null; end if;
      v_facts := jsonb_build_object('cash_minor',v_cash,'efloat_minor',v_float,'cash_demand_minor',v_demand,
        'efloat_demand_minor',v_efloat_demand,'confidence',coalesce(v_forecast->>'confidence','low'));
      v_cards := v_cards || public.insight_card('liquidity','wallet',case when v_cash < coalesce(v_demand,0) or v_float < coalesce(v_efloat_demand,0) then 'warn' else 'info' end,
        'আজকের নগদ ও ই-ফ্লোট', format('নগদ %s; ই-ফ্লোট %s। %s %s', public.poisha_to_tk(v_cash),public.poisha_to_tk(v_float),
          case when v_demand is null then 'নগদের চাহিদার হালনাগাদ পূর্বাভাস নেই।' else 'বাকি সময়ে আনুমানিক নগদ লাগতে পারে ' || public.poisha_to_tk(v_demand) || '।' end,
          case when v_efloat_demand is null then 'ই-ফ্লোটের চাহিদার পূর্বাভাস নেই।' else 'ই-ফ্লোট লাগতে পারে ' || public.poisha_to_tk(v_efloat_demand) || '।' end),
        'Today’s cash and e-float',format('Cash: %s; e-float: %s. %s %s',public.poisha_to_tk(v_cash),public.poisha_to_tk(v_float),
          case when v_demand is null then 'Current cash demand forecast unavailable.' else 'Estimated remaining cash demand: ' || public.poisha_to_tk(v_demand) || '.' end,
          case when v_efloat_demand is null then 'E-float demand forecast unavailable.' else 'Estimated e-float demand: ' || public.poisha_to_tk(v_efloat_demand) || '.' end),v_facts,'/books');
      v_peak := public.agent_peak_hours(p_business_id);
      v_cards := v_cards || public.insight_card('peak-hours','clock','info','ব্যস্ত সময়ের সম্ভাবনা',
        case when (v_peak->>'abstained')::boolean then 'ব্যস্ত সময় অনুমান করার মতো পর্যাপ্ত লেনদেনের ইতিহাস নেই।'
          else format('%sটা থেকে %sটা তুলনামূলক ব্যস্ত হতে পারে। এটি আগের লেনদেনভিত্তিক অনুমান।',v_peak->>'start_hour',v_peak->>'end_hour') end,
        'Expected busy period',case when (v_peak->>'abstained')::boolean then 'Not enough transaction history to estimate busy hours.'
          else format('%s:00–%s:00 may be busier, based on past transactions.',v_peak->>'start_hour',v_peak->>'end_hour') end,v_peak,'/transactions');
    end if;
  end if;

  -- Count opaque payer tokens through live transactions, deduplicating settlement and
  -- commission events. Null tokens, reversed rows and future-dated rows do not count.
  with payers as (
    select pe.payer_hash, min(t.business_date) first_day, max(t.business_date) last_day,
      bool_or(t.business_date >= v_today-14 and t.business_date < v_today-7) prior_week
    from public.v_live_transactions t join public.transactions tx on tx.id=t.id
      join public.payment_events pe on pe.id=tx.payment_event_id and pe.business_id=t.business_id
    where t.business_id=p_business_id and nullif(pe.payer_hash,'') is not null and t.occurred_at <= now()
      and ((v_type='MERCHANT' and t.kind='QR_PAYMENT') or
        (v_type='AGENT' and t.kind in ('AGENT_CASH_IN','AGENT_CASH_OUT','AGENT_SEND_MONEY')))
    group by pe.payer_hash
  ) select count(*),count(*) filter(where last_day>=v_today-7),
    count(*) filter(where prior_week),count(*) filter(where first_day>=v_today-7)
    into v_total,v_active,v_previous,v_new from payers;
  v_facts := jsonb_build_object('distinct_payers',v_total,'active_week',v_active,'previous_week',v_previous,'new_week',v_new,'approximate',true);
  v_cards := v_cards || public.insight_card('customers','users','info','গ্রাহকের আনুমানিক সক্রিয়তা',
    format('শনাক্ত করা আলাদা গ্রাহক প্রায় %s জন; এ সপ্তাহে সক্রিয় %s জন, আগের সপ্তাহে %s জন; নতুন %s জন। পরিচয়বিহীন পেমেন্ট এতে ধরা নেই।',v_total,v_active,v_previous,v_new),
    'Approximate customer activity',format('About %s distinct payers; %s active this week versus %s previously; %s first seen this week. Unidentified payments are excluded.',v_total,v_active,v_previous,v_new),v_facts);

  select coalesce(sum(amount_minor),0), count(*) into v_summary,v_count from public.v_live_transactions
    where business_id=p_business_id and business_date=v_today-1
    and ((v_type='MERCHANT' and kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE'))
      or (v_type='AGENT' and kind in ('AGENT_CASH_IN','AGENT_CASH_OUT','AGENT_SEND_MONEY')));
  v_cards := v_cards || public.insight_card('yesterday','calendar','info','গতকালের সারাংশ',
    format('গতকাল %sটি %s; মোট %s।',v_count,case v_type when 'MERCHANT' then 'বিক্রি' else 'সেবা লেনদেন' end,public.poisha_to_tk(v_summary)),
    'Yesterday’s summary',format('%s %s yesterday, totaling %s.',v_count,case v_type when 'MERCHANT' then 'sales' else 'service transactions' end,public.poisha_to_tk(v_summary)),
    jsonb_build_object('amount_minor',v_summary,'transaction_count',v_count,'date',v_today-1),'/transactions');
  select coalesce(jsonb_agg(c order by case c->>'severity' when 'bad' then 0 when 'warn' then 1 when 'good' then 2 else 3 end, n),'[]')
    into v_cards from jsonb_array_elements(v_cards) with ordinality as items(c,n);
  return jsonb_build_object('business_id',p_business_id,'role',v_type,'as_of',now(),'date',v_today,'cards',v_cards);
end $$;
revoke all on function public.today_insights(uuid) from public, anon;
grant execute on function public.today_insights(uuid) to authenticated;
