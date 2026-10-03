-- 8.3  Per-business admin drill-down (read-only, upay_admin only).
-- Returns KPIs, open cases, last activity, and membership count for one business.
-- Transaction-level detail is NOT included here; that still requires a support grant
-- and goes through admin_case_transactions().

create or replace function public.admin_business_overview(p_business_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  v_role := private.admin_role('upay_admin');

  return jsonb_build_object(
    'business', (
      select jsonb_build_object(
        'id',       b.id,
        'name',     b.name,
        'type',     b.type,
        'status',   b.status,
        'verified', b.verified,
        'category', b.category,
        'created_at', b.created_at
      )
      from public.businesses b
      where b.id = p_business_id
    ),

    -- Members: count by role
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('role', role, 'count', cnt) order by cnt desc), '[]')
      from (
        select m.role, count(*)::int as cnt
        from public.memberships m
        where m.business_id = p_business_id and m.status = 'active'
        group by m.role
      ) r
    ),

    -- KPIs: 7-day window from journals/transactions
    'kpi_7d', (
      select jsonb_build_object(
        'txn_count',         count(distinct t.id),
        'gmv_minor',         coalesce(sum(t.amount_minor) filter (
                               where t.kind in ('QR_PAYMENT','CASH_SALE','AGENT_CASH_IN',
                                                'AGENT_CASH_OUT','AGENT_SEND_MONEY')), 0)::text,
        'refund_count',      count(distinct t.id) filter (where t.kind = 'REFUND'),
        'refund_minor',      coalesce(sum(t.amount_minor) filter (where t.kind = 'REFUND'), 0)::text,
        'last_txn_at',       max(t.occurred_at)
      )
      from public.transactions t
      where t.business_id = p_business_id
        and t.occurred_at >= (v_today - 6)::timestamp at time zone 'Asia/Dhaka'
        and t.reverses_txn_id is null
        and not exists (select 1 from public.transactions r where r.reverses_txn_id = t.id)
    ),

    -- Open support cases for this business
    'open_cases', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',          c.id,
        'subject',     c.subject,
        'sla_key',     c.sla_key,
        'due_at',      c.due_at,
        'assigned_to', c.assigned_to,
        'overdue',     c.due_at < now()
      ) order by c.due_at), '[]')
      from public.support_cases c
      where c.business_id = p_business_id and c.status = 'open'
    ),

    -- Latest daily closing (merchants) or float audit (agents)
    'last_closing', (
      select to_jsonb(dc)
      from (
        select period_date, variance_minor, status, counted_cash_minor, expected_cash_minor
        from public.daily_closings
        where business_id = p_business_id and status = 'CLOSED'
          and not exists (
            select 1 from public.daily_closings n where n.supersedes_id = daily_closings.id)
        order by period_date desc limit 1
      ) dc
    ),
    'last_float_audit', (
      select to_jsonb(fa)
      from (
        select period_date, cash_variance_minor, upay_variance_minor, commission_minor
        from public.agent_float_audits
        where business_id = p_business_id
        order by period_date desc limit 1
      ) fa
    ),

    'as_of', now()
  );
end $$;

revoke all on function public.admin_business_overview(uuid) from public, anon, authenticated;
grant execute on function public.admin_business_overview(uuid) to authenticated;


-- 8.4  SLA metrics folded into admin_dashboard().
-- Replaces the existing admin_dashboard() to add a 'sla' key with:
--   overdue_count       open cases past their due_at
--   avg_resolution_h    average hours from created_at to resolved_at (closed cases, 30 d)
--   open_count          total open cases right now
-- Computed entirely from support_cases timestamps; no new table.

create or replace function public.admin_dashboard() returns jsonb
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
    -- 8.4: SLA health metrics derived from support_cases timestamps
    'sla', (select jsonb_build_object(
        'open_count',         count(*) filter (where status = 'open'),
        'overdue_count',      count(*) filter (where status = 'open' and due_at < now()),
        'avg_resolution_h',   round(avg(
          extract(epoch from (resolved_at - created_at)) / 3600.0
        ) filter (where status = 'resolved' and resolved_at >= now() - interval '30 days'))
      ) from public.support_cases),
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
-- Grant already exists from original migration; re-state for clarity.
revoke all on function public.admin_dashboard() from public, anon, authenticated;
grant execute on function public.admin_dashboard() to authenticated;
