-- 8.1  Platform-wide risk overview (read-only, upay_admin only).
-- Returns one JSON row per business with three risk signals:
--   pending_settlement_count / pending_settlement_minor
--   refund_spike_7d / refund_spike_minor_7d
--   float_cash_variance_minor / float_upay_variance_minor (agents)
--   closing_variance_minor                               (merchants)
-- No money moves; every column is derived from existing append-only tables.

create or replace function public.admin_risk_overview()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  v_role := private.admin_role('upay_admin');

  return (
    select coalesce(jsonb_agg(row_to_json(r)), '[]')
    from (
      select
        b.id                       as business_id,
        b.name                     as business_name,
        b.type                     as business_type,
        b.status                   as business_status,

        -- Pending settlement: QR payments in wallet='pending' not yet settled or reversed
        coalesce(ps.cnt, 0)::int   as pending_settlement_count,
        coalesce(ps.tot, 0)::text  as pending_settlement_minor,

        -- Refund spike: SUCCEEDED refunds posted in the last 7 days
        coalesce(rs.cnt, 0)::int   as refund_spike_7d,
        coalesce(rs.tot, 0)::text  as refund_spike_minor_7d,

        -- Latest agent float audit variances (agents only; null for merchants)
        fa.cash_variance_minor::text as float_cash_variance_minor,
        fa.upay_variance_minor::text as float_upay_variance_minor,
        fa.period_date               as float_audit_date,

        -- Latest merchant closing variance (merchants only; null for agents)
        dc.variance_minor::text      as closing_variance_minor,
        dc.period_date               as closing_date

      from public.businesses b

      -- Pending settlement lateral
      left join lateral (
        select count(*)::bigint           as cnt,
               coalesce(sum(t.amount_minor), 0)::bigint as tot
        from public.transactions t
        where t.business_id = b.id
          and t.kind = 'QR_PAYMENT'
          and t.wallet = 'pending'
          and t.reverses_txn_id is null
          and not exists (
            select 1 from public.transactions r
             where r.reverses_txn_id = t.id)
          and not exists (
            select 1 from public.transactions s
              join public.payment_events se on se.id = s.payment_event_id
              join public.payment_events oe on oe.id = t.payment_event_id
             where s.kind = 'SETTLEMENT'
               and se.provider_txn_id = oe.provider_txn_id)
      ) ps on true

      -- 7-day refund spike lateral
      left join lateral (
        select count(*)::bigint           as cnt,
               coalesce(sum(r.amount_minor), 0)::bigint as tot
        from public.refunds r
        where r.business_id = b.id
          and r.status = 'SUCCEEDED'
          and r.created_at >= now() - interval '7 days'
      ) rs on true

      -- Latest agent float audit (agents only)
      left join lateral (
        select a.cash_variance_minor, a.upay_variance_minor, a.period_date
        from public.agent_float_audits a
        where a.business_id = b.id
        order by a.period_date desc
        limit 1
      ) fa on b.type = 'AGENT'

      -- Latest merchant daily closing (merchants only, latest non-superseded CLOSED row)
      left join lateral (
        select dc2.variance_minor, dc2.period_date
        from public.daily_closings dc2
        where dc2.business_id = b.id
          and dc2.status = 'CLOSED'
          and not exists (
            select 1 from public.daily_closings newer
             where newer.supersedes_id = dc2.id)
        order by dc2.period_date desc
        limit 1
      ) dc on b.type = 'MERCHANT'

      -- Surface businesses with the worst signals first
      order by
        coalesce(ps.tot, 0) desc,
        coalesce(rs.cnt, 0) desc,
        b.name
    ) r
  );
end $$;

revoke all on function public.admin_risk_overview() from public, anon, authenticated;
grant execute on function public.admin_risk_overview() to authenticated;


-- 8.2  Audit CSV export (upay_admin only, self-auditing).
-- Fetches the last p_limit admin_audit_events rows as RFC 4180 CSV text.
-- Logs the export action to admin_audit_events BEFORE reading, so the
-- "admin downloaded audit logs" event is itself in the immutable audit trail.
-- Return value is plain UTF-8 text; clients add the BOM if needed.

create or replace function public.admin_audit_export_csv(p_limit int default 500)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_role  text;
  v_lines text[];
  v_row   record;
  v_limit int;
begin
  v_role  := private.admin_role('upay_admin');
  v_limit := least(coalesce(p_limit, 500), 5000);
  if v_limit < 1 then
    raise exception 'LIMIT_INVALID: must be between 1 and 5000' using errcode = '22023';
  end if;

  -- Audit the export itself before we read anything
  insert into public.admin_audit_events(actor, action, reason, detail)
  values (auth.uid(), 'audit.csv_exported',
          'Admin audit log export',
          jsonb_build_object('limit', v_limit, 'requested_at', now()));

  -- Header row
  v_lines := array['id,actor,action,reason,detail,created_at_dhaka'];

  -- Data rows (most recent first, up to v_limit)
  for v_row in
    select
      e.id::text                                                      as id,
      e.actor::text                                                   as actor,
      e.action                                                        as action,
      replace(e.reason, '"', '""')                                    as reason,
      replace(e.detail::text, '"', '""')                              as detail,
      to_char(e.created_at at time zone 'Asia/Dhaka',
              'YYYY-MM-DD"T"HH24:MI:SS+06:00')                        as created_at
    from public.admin_audit_events e
    order by e.created_at desc
    limit v_limit
  loop
    v_lines := v_lines || (
      v_row.id    || ','  ||
      v_row.actor || ','  ||
      v_row.action|| ',"' ||
      regexp_replace(v_row.reason, E'[\\r\\n]+', ' ', 'g') || '","' ||
      regexp_replace(v_row.detail, E'[\\r\\n]+', ' ', 'g') || '",' ||
      v_row.created_at
    );
  end loop;

  return array_to_string(v_lines, E'\r\n') || E'\r\n';
end $$;

revoke all on function public.admin_audit_export_csv(int) from public, anon, authenticated;
grant execute on function public.admin_audit_export_csv(int) to authenticated;
