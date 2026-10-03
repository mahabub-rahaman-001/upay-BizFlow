-- P9: privileged identities are provisioned by a database operator, never by a client.
create schema if not exists private;
create table public.admin_accounts (
  user_id uuid primary key references auth.users(id),
  role text not null check (role in ('upay_admin','upay_support')),
  active boolean not null default true,
  demo_access boolean not null default false
);
alter table public.admin_accounts enable row level security;
revoke all on public.admin_accounts from public, anon, authenticated;

create function private.admin_role(p_required text default null) returns text
language plpgsql stable security definer set search_path = '' as $$
declare a public.admin_accounts;
begin
  select * into a from public.admin_accounts where user_id = auth.uid() and active;
  if a.user_id is null or (p_required is not null and a.role <> p_required) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if not a.demo_access and coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode = '42501';
  end if;
  return a.role;
end $$;
revoke all on function private.admin_role(text) from public, anon, authenticated;

create function public.admin_session() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.admin_accounts;
begin
  select * into a from public.admin_accounts where user_id = auth.uid() and active;
  if a.user_id is null then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object('user_id', a.user_id, 'role', a.role, 'demo_access', a.demo_access,
    'requires_mfa', not a.demo_access and coalesce(auth.jwt()->>'aal','') <> 'aal2');
end $$;

create table public.support_sla_rules (
  key text primary key,
  duration interval not null check (duration > interval '0'),
  working_days boolean not null default false
);
insert into public.support_sla_rules values
  ('issuer_decision', interval '2 days', true),
  ('chargeback', interval '7 days', false),
  ('arbitration', interval '30 days', false);
create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  assigned_to uuid not null references public.admin_accounts(user_id),
  subject text not null check (length(subject) between 1 and 160),
  status text not null default 'open' check (status in ('open','resolved')),
  sla_key text not null references public.support_sla_rules(key),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index support_cases_assigned_idx on public.support_cases(assigned_to, status, due_at);
create index support_cases_business_idx on public.support_cases(business_id, created_at desc);
create table public.admin_access_grants (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id),
  business_id uuid not null references public.businesses(id),
  actor uuid not null references auth.users(id),
  reason text not null,
  scope text not null default 'transactions' check (scope = 'transactions'),
  expires_at timestamptz not null default now() + interval '60 minutes',
  created_at timestamptz not null default now()
);
create index admin_access_grants_lookup on public.admin_access_grants(actor, case_id, expires_at);
create table public.access_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  case_id uuid not null references public.support_cases(id),
  actor uuid not null references auth.users(id),
  reason text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index access_log_business_idx on public.access_log(business_id, created_at desc);
create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key in ('ai.forecast','ai.assistant')),
  business_id uuid references public.businesses(id),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (key, business_id)
);
insert into public.feature_flags(key, enabled) values ('ai.forecast', true), ('ai.assistant', true);
create table public.admin_flag_requests (
  id uuid primary key default gen_random_uuid(),
  flag_id uuid not null references public.feature_flags(id),
  enabled boolean not null,
  reason text not null,
  proposed_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  check (approved_by is distinct from proposed_by)
);
create table public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null references auth.users(id),
  action text not null,
  reason text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.admin_request_results (
  actor uuid not null references auth.users(id),
  request_id uuid not null,
  request_body jsonb not null,
  result jsonb not null,
  primary key(actor, request_id)
);
create table public.ai_evaluations (
  id uuid primary key default gen_random_uuid(),
  model_version text not null,
  dataset text not null,
  metrics jsonb not null,
  evaluated_at timestamptz not null default now()
);

-- All admin reads are guarded RPCs. Owners can inspect their access log; mobile clients
-- can read global flags and their own overrides for realtime invalidation.
do $$ declare n text; begin
  foreach n in array array['support_sla_rules','support_cases','admin_access_grants',
    'access_log','feature_flags','admin_flag_requests','admin_audit_events',
    'admin_request_results','ai_evaluations'] loop
    execute format('alter table public.%I enable row level security', n);
    execute format('revoke all on public.%I from public, anon, authenticated', n);
  end loop;
  foreach n in array array['admin_access_grants','access_log','admin_audit_events','admin_request_results','ai_evaluations'] loop
    execute format('create trigger append_only before update or delete on public.%I for each row execute function public.block_mutation()', n);
  end loop;
end $$;
create policy owner_access_log on public.access_log for select to authenticated
  using (public.has_role(business_id, array['merchant_owner','agent_owner']::public.member_role[]));
create policy readable_flags on public.feature_flags for select to authenticated
  using (business_id is null or public.is_member(business_id));
grant select on public.access_log, public.feature_flags to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.feature_flags;
  end if;
end $$;

create function public.admin_dashboard() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_result jsonb; v_today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  v_role := private.admin_role();
  select jsonb_build_object('cases', coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'business_id', c.business_id, 'business_name', b.name, 'subject', c.subject,
    'status', c.status, 'due_at', c.due_at, 'sla_key', c.sla_key, 'assigned_to', c.assigned_to,
    'grant', (select jsonb_build_object('id', g.id, 'expires_at', g.expires_at)
      from public.admin_access_grants g where g.case_id = c.id and g.actor = auth.uid()
        and g.expires_at > now() order by g.expires_at desc limit 1)
    ) order by c.due_at), '[]')) into v_result
  from public.support_cases c join public.businesses b on b.id = c.business_id
  where v_role = 'upay_admin' or c.assigned_to = auth.uid();
  if v_role <> 'upay_admin' then return v_result; end if;
  return v_result || jsonb_build_object(
    'portfolio', (select jsonb_build_object(
      'businesses', count(*), 'merchants', count(*) filter (where type = 'MERCHANT'),
      'agents', count(*) filter (where type = 'AGENT')) from public.businesses),
    'activity', (select jsonb_build_object('active_7d', count(distinct business_id),
      'qr_gmv_minor', coalesce(sum(amount_minor) filter (where kind = 'QR_PAYMENT' and source = 'verified'),0)::text,
      'agent_volume_minor', coalesce(sum(amount_minor) filter (where kind in ('AGENT_CASH_IN','AGENT_CASH_OUT','AGENT_SEND_MONEY')),0)::text)
      from public.transactions where occurred_at >= (v_today - 6)::timestamp at time zone 'Asia/Dhaka'
      and reverses_txn_id is null and not exists (select 1 from public.transactions r where r.reverses_txn_id = transactions.id)),
    'closing', (select jsonb_build_object('wab4', count(*) filter (where days >= 4), 'adoption_count', count(*))
      from (select business_id, count(distinct period_date) days from public.daily_closings
        where period_date between v_today - 6 and v_today and status = 'CLOSED'
        and not exists (select 1 from public.daily_closings newer where newer.supersedes_id = daily_closings.id)
        group by business_id) c),
    'ai_health', (select coalesce(jsonb_agg(row_to_json(h)), '[]') from (
      select capability, count(*) runs, round(avg(latency_ms)) latency_ms,
        count(*) filter (where confidence = 'low') low_confidence,
        count(*) filter (where feedback = 'wrong') wrong_feedback
      from public.ai_outputs where created_at >= now() - interval '7 days' group by capability) h),
    'forecasts', (select jsonb_build_object('runs', count(*), 'abstained', count(*) filter (where abstained),
      'latest_at', max(created_at)) from public.forecast_runs where created_at >= now() - interval '7 days'),
    'evaluations', (select coalesce(jsonb_agg(row_to_json(e)), '[]') from
      (select model_version, dataset, metrics, evaluated_at from public.ai_evaluations order by evaluated_at desc limit 10) e),
    'flags', (select coalesce(jsonb_agg(to_jsonb(f) || jsonb_build_object('business_name', b.name)), '[]')
      from public.feature_flags f left join public.businesses b on b.id = f.business_id),
    'pending', (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('key', f.key)), '[]')
      from public.admin_flag_requests r join public.feature_flags f on f.id = r.flag_id where r.approved_at is null),
    'audit', (select coalesce(jsonb_agg(row_to_json(e)), '[]') from
      (select * from public.admin_audit_events order by created_at desc limit 50) e),
    'businesses', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]') from public.businesses),
    'as_of', now());
end $$;

-- Idempotency is shared across admin commands, including retries after a lost response.
create function public.admin_command(p_action text, p_body jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_result jsonb; v_prior public.admin_request_results;
  v_case public.support_cases; v_flag public.feature_flags; v_request public.admin_flag_requests;
  v_id uuid; v_reason text := btrim(p_body->>'reason');
begin
  v_role := private.admin_role();
  if p_request_id is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 0));
  select * into v_prior from public.admin_request_results where actor = auth.uid() and request_id = p_request_id;
  if found then
    if v_prior.request_body <> jsonb_build_object('action',p_action,'body',p_body) then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023'; end if;
    return v_prior.result;
  end if;
  if coalesce(length(v_reason),0) < 3 or length(v_reason) > 240 then
    raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if p_action in ('grant','resolve') then
    select * into v_case from public.support_cases where id = (p_body->>'case_id')::uuid for update;
    if v_case.id is null or (v_role <> 'upay_admin' and v_case.assigned_to <> auth.uid()) then
      raise exception 'CASE_ACCESS_DENIED' using errcode = '42501'; end if;
    if v_case.status <> 'open' then raise exception 'CASE_CLOSED' using errcode = '22023'; end if;
    if p_action = 'grant' then
      insert into public.admin_access_grants(case_id,business_id,actor,reason)
        values(v_case.id,v_case.business_id,auth.uid(),v_reason) returning id into v_id;
      insert into public.access_log(business_id,case_id,actor,reason,action)
        values(v_case.business_id,v_case.id,auth.uid(),v_reason,'grant.created');
      v_result := jsonb_build_object('id',v_id,'expires_at',now()+interval '60 minutes');
    else
      update public.support_cases set status = 'resolved', resolved_at = now() where id = v_case.id;
      v_result := jsonb_build_object('id',v_case.id,'status','resolved');
    end if;
  elsif p_action = 'propose_flag' then
    perform private.admin_role('upay_admin');
    if p_body->>'key' not in ('ai.forecast','ai.assistant') or jsonb_typeof(p_body->'enabled') <> 'boolean' then
      raise exception 'FLAG_INVALID' using errcode = '22023'; end if;
    insert into public.feature_flags(key,business_id,enabled)
      values(p_body->>'key',nullif(p_body->>'business_id','')::uuid,true)
      on conflict (key,business_id) do nothing;
    select * into v_flag from public.feature_flags where key = p_body->>'key'
      and business_id is not distinct from nullif(p_body->>'business_id','')::uuid for update;
    if v_flag.business_id is null then
      insert into public.admin_flag_requests(flag_id,enabled,reason,proposed_by)
        values(v_flag.id,(p_body->>'enabled')::boolean,v_reason,auth.uid()) returning id into v_id;
      v_result := jsonb_build_object('id',v_id,'pending',true);
    else
      update public.feature_flags set enabled = (p_body->>'enabled')::boolean, updated_at = now() where id = v_flag.id;
      v_result := jsonb_build_object('id',v_flag.id,'pending',false);
    end if;
  elsif p_action = 'approve_flag' then
    perform private.admin_role('upay_admin');
    select * into v_request from public.admin_flag_requests where id = (p_body->>'id')::uuid for update;
    if v_request.id is null or v_request.proposed_by = auth.uid() or v_request.approved_at is not null then
      raise exception 'SECOND_ADMIN_REQUIRED' using errcode = '42501'; end if;
    update public.feature_flags set enabled = v_request.enabled, updated_at = now() where id = v_request.flag_id;
    update public.admin_flag_requests set approved_by = auth.uid(), approved_at = now() where id = v_request.id;
    v_result := jsonb_build_object('id',v_request.id,'pending',false);
  else raise exception 'ACTION_INVALID' using errcode = '22023'; end if;
  insert into public.admin_audit_events(actor,action,reason,detail) values(auth.uid(),p_action,v_reason,p_body);
  insert into public.admin_request_results values(auth.uid(),p_request_id,jsonb_build_object('action',p_action,'body',p_body),v_result);
  return v_result;
end $$;

create function public.admin_case_transactions(p_case_id uuid, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_role text; c public.support_cases; g public.admin_access_grants; v_rows jsonb;
begin
  v_role := private.admin_role();
  select * into c from public.support_cases where id = p_case_id;
  if c.id is null or c.status <> 'open' or (v_role <> 'upay_admin' and c.assigned_to <> auth.uid()) then
    raise exception 'CASE_ACCESS_DENIED' using errcode = '42501'; end if;
  select * into g from public.admin_access_grants where case_id = c.id and business_id = c.business_id
    and actor = auth.uid() and expires_at > now() order by expires_at desc limit 1;
  if g.id is null then raise exception 'GRANT_REQUIRED' using errcode = '42501'; end if;
  if p_offset < 0 or p_offset > 10000 then raise exception 'PAGE_INVALID' using errcode = '22023'; end if;
  insert into public.access_log(business_id,case_id,actor,reason,action)
    values(c.business_id,c.id,auth.uid(),g.reason,'transactions.read');
  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_rows from (
    select id, kind, source, amount_minor::text, occurred_at from public.transactions
      where business_id = c.business_id order by occurred_at desc, id limit 50 offset p_offset) t;
  return v_rows;
end $$;

create function public.feature_enabled(p_key text, p_business_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(p_business_id) then raise exception 'NOT_A_MEMBER' using errcode = '42501'; end if;
  -- A global kill switch always wins over an enabled business override.
  return coalesce((select bool_and(enabled) from public.feature_flags where key = p_key
    and (business_id is null or business_id = p_business_id)), false);
end $$;

create function public.get_forecast(p_business_id uuid, p_capability text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_mean bigint; v_today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  if not public.has_role(p_business_id,array['merchant_owner','agent_owner','manager']::public.member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED' using errcode = '42501'; end if;
  if public.feature_enabled('ai.forecast',p_business_id) then
    select to_jsonb(f) into v_result from public.forecast_runs f
      where business_id=p_business_id and capability=p_capability order by cutoff_date desc limit 1;
    return v_result;
  end if;
  select coalesce(sum(sales_minor)/7,0)::bigint into v_mean
    from public.business_daily_sales(p_business_id,v_today-7,v_today-1);
  return jsonb_build_object('capability',p_capability,'model_version','baseline-ai-off',
    'confidence','low','abstained',false,'cutoff_date',v_today,'fallback',true,
    'days',(select jsonb_agg(jsonb_build_object('day',v_today+i,'p10_minor',0,
      'p50_minor',greatest(0,v_mean),'p90_minor',greatest(0,v_mean)*2)) from generate_series(1,7) i),
    'hours','[]'::jsonb,'advice_en','Simple estimate (AI off). Based on the previous seven days.',
    'advice_bn','সাধারণ হিসাব (AI বন্ধ)। আগের সাত দিনের তথ্য থেকে হিসাব করা হয়েছে।');
end $$;
alter view public.v_latest_forecast set (security_invoker = true);

-- Keep the existing planner calculation, with a server-side conservative fallback.
alter function public.get_safe_to_withdraw(uuid) rename to _get_safe_to_withdraw_model;
revoke all on function public._get_safe_to_withdraw_model(uuid) from public, anon, authenticated;
create function public.get_safe_to_withdraw(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_cash bigint; v_reserve bigint;
begin
  if not public.has_role(p_business_id,array['merchant_owner','agent_owner','manager']::public.member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED' using errcode = '42501'; end if;
  if public.feature_enabled('ai.forecast',p_business_id) then
    return public._get_safe_to_withdraw_model(p_business_id); end if;
  select coalesce(sum(l.debit_minor-l.credit_minor),0)::bigint into v_cash
    from public.journal_lines l join public.accounts a on a.id=l.account_id
    where l.business_id=p_business_id and a.code in ('1000','1010');
  select greatest(0,coalesce((settings->>'operating_reserve_minor')::bigint,
    (select coalesce(sum(amount_minor),0)::bigint / 10 from public.transactions t
     where t.business_id=p_business_id and kind='EXPENSE' and occurred_at>=now()-interval '30 days'
     and not exists(select 1 from public.transactions r where r.reverses_txn_id=t.id))))
    into v_reserve from public.businesses where id=p_business_id;
  return jsonb_build_object('available',true,'fallback',true,'reason','AI_DISABLED',
    'current_cleared_minor',v_cash,'forecast_inflow_p10_7d_minor',0,
    'lowest_projected_balance_p10_minor',v_cash,'lowest_projected_day',(now() at time zone 'Asia/Dhaka')::date,
    'reserve_minor',v_reserve,'uncertainty_buffer_minor',0,'safe_to_withdraw_minor',greatest(0,v_cash-v_reserve),
    'confidence','low','model_version','baseline-ai-off','shortfall_minor',greatest(0,v_reserve-v_cash));
end $$;

create function public.admin_simulator_target(p_business_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_ref text;
begin
  perform private.admin_role('upay_admin');
  if not exists(select 1 from public.admin_accounts where user_id=auth.uid() and demo_access) then
    raise exception 'SIMULATOR_DISABLED' using errcode='42501'; end if;
  select upay_account_ref into v_ref from public.businesses where id=p_business_id and settings->>'demo'='true';
  if v_ref is null then raise exception 'DEMO_BUSINESS_REQUIRED' using errcode='42501'; end if;
  insert into public.admin_audit_events(actor,action,reason,detail)
    values(auth.uid(),'simulator.target','Demo payment',jsonb_build_object('business_id',p_business_id));
  return v_ref;
end $$;

do $$ declare sig text; begin
  foreach sig in array array['admin_session()','admin_dashboard()','admin_command(text,jsonb,uuid)',
    'admin_case_transactions(uuid,integer)','feature_enabled(text,uuid)',
    'get_forecast(uuid,text)','get_safe_to_withdraw(uuid)','admin_simulator_target(uuid)'] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to authenticated';
  end loop;
end $$;
