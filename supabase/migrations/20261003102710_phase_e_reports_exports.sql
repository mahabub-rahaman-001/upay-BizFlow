-- Phase E: deterministic ledger reports and audited exports.
-- The AI service may choose a report key and dates, but every amount returned here is
-- calculated from journal_lines. Only the owner role matching the business type may call
-- these RPCs.

create table exports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  report_key text not null,
  filters jsonb not null default '{}',
  format text not null check (format in ('csv')),
  row_count integer not null check (row_count >= 0),
  file_name text not null,
  requested_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index exports_business_created_idx on exports (business_id, created_at desc);

alter table exports enable row level security;

create policy exports_owner_read on exports for select to authenticated
  using (has_role(business_id, array['merchant_owner','agent_owner']::member_role[]));

revoke all on table exports from anon, authenticated;
grant select on table exports to authenticated;

create or replace function report_rows(
  p_business_id uuid,
  p_report_key text,
  p_from date,
  p_to date
) returns setof jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_type business_type;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: no session' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'DATE_RANGE_INVALID: from must be on or before to' using errcode = '22007';
  end if;
  if p_to - p_from > 366 then
    raise exception 'DATE_RANGE_TOO_LARGE: maximum range is 366 days' using errcode = '22007';
  end if;

  select type into v_type from businesses where id = p_business_id;
  if v_type = 'MERCHANT'
     and not has_role(p_business_id, array['merchant_owner']::member_role[]) then
    raise exception 'OWNER_REQUIRED: merchant owner role required' using errcode = '42501';
  elsif v_type = 'AGENT'
     and not has_role(p_business_id, array['agent_owner']::member_role[]) then
    raise exception 'OWNER_REQUIRED: agent owner role required' using errcode = '42501';
  elsif v_type is null then
    raise exception 'BUSINESS_NOT_FOUND' using errcode = '42501';
  end if;

  if p_report_key = 'sales_by_day' then
    if v_type <> 'MERCHANT' then
      raise exception 'REPORT_NOT_AVAILABLE: sales reports are merchant-only' using errcode = '42501';
    end if;
    return query
      select jsonb_build_object(
        'date', t.occurred_at::date,
        'transaction_count', count(distinct t.id),
        'sales_minor', sum(jl.credit_minor - jl.debit_minor)::bigint
      )
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join transactions t on t.id = je.transaction_id
      join accounts a on a.id = jl.account_id
      where jl.business_id = p_business_id and a.code = '4000'
        and t.occurred_at >= p_from::timestamptz
        and t.occurred_at < (p_to + 1)::timestamptz
      group by t.occurred_at::date
      order by t.occurred_at::date;

  elsif p_report_key = 'sales_by_category' then
    if v_type <> 'MERCHANT' then
      raise exception 'REPORT_NOT_AVAILABLE: sales reports are merchant-only' using errcode = '42501';
    end if;
    return query
      select jsonb_build_object(
        'category', coalesce(t.category, 'uncategorized'),
        'transaction_count', count(distinct t.id),
        'sales_minor', sum(jl.credit_minor - jl.debit_minor)::bigint
      )
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join transactions t on t.id = je.transaction_id
      join accounts a on a.id = jl.account_id
      where jl.business_id = p_business_id and a.code = '4000'
        and t.occurred_at >= p_from::timestamptz
        and t.occurred_at < (p_to + 1)::timestamptz
      group by coalesce(t.category, 'uncategorized')
      order by sum(jl.credit_minor - jl.debit_minor) desc;

  elsif p_report_key = 'expenses' then
    if v_type <> 'MERCHANT' then
      raise exception 'REPORT_NOT_AVAILABLE: expense reports are merchant-only' using errcode = '42501';
    end if;
    return query
      select jsonb_build_object(
        'date', t.occurred_at::date,
        'category', coalesce(t.category, 'other'),
        'note', t.note,
        'expense_minor', sum(jl.debit_minor - jl.credit_minor)::bigint
      )
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join transactions t on t.id = je.transaction_id
      join accounts a on a.id = jl.account_id
      where jl.business_id = p_business_id and a.code in ('5000','5100','9000')
        and t.occurred_at >= p_from::timestamptz
        and t.occurred_at < (p_to + 1)::timestamptz
      group by t.id, t.occurred_at, t.category, t.note
      having sum(jl.debit_minor - jl.credit_minor) <> 0
      order by t.occurred_at::date, t.id;

  elsif p_report_key = 'baki' then
    if v_type <> 'MERCHANT' then
      raise exception 'REPORT_NOT_AVAILABLE: baki reports are merchant-only' using errcode = '42501';
    end if;
    return query
      select jsonb_build_object(
        'customer', c.name,
        'baki_given_minor', coalesce(sum(jl.debit_minor) filter (where t.kind = 'BAKI_SALE'), 0)::bigint,
        'baki_collected_minor', coalesce(sum(jl.credit_minor) filter (where t.kind = 'BAKI_COLLECTION'), 0)::bigint,
        'net_minor', sum(jl.debit_minor - jl.credit_minor)::bigint
      )
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join transactions t on t.id = je.transaction_id
      join accounts a on a.id = jl.account_id
      join customers c on c.id = t.customer_id
      where jl.business_id = p_business_id and a.code = '1100'
        and t.occurred_at >= p_from::timestamptz
        and t.occurred_at < (p_to + 1)::timestamptz
      group by c.id, c.name
      order by c.name;

  elsif p_report_key = 'cash_vs_digital' then
    return query
      select jsonb_build_object(
        'date', t.occurred_at::date,
        'cash_minor', coalesce(sum(jl.debit_minor - jl.credit_minor) filter (where a.code = '1000'), 0)::bigint,
        'digital_minor', coalesce(sum(jl.debit_minor - jl.credit_minor) filter (where a.code = '1010'), 0)::bigint
      )
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join transactions t on t.id = je.transaction_id
      join accounts a on a.id = jl.account_id
      where jl.business_id = p_business_id and a.code in ('1000','1010')
        and t.occurred_at >= p_from::timestamptz
        and t.occurred_at < (p_to + 1)::timestamptz
      group by t.occurred_at::date
      order by t.occurred_at::date;

  elsif p_report_key = 'agent_book' then
    if v_type <> 'AGENT' then
      raise exception 'REPORT_NOT_AVAILABLE: agent book is agent-only' using errcode = '42501';
    end if;
    return query
      select jsonb_build_object(
        'date', t.occurred_at::date,
        'kind', t.kind,
        'wallet', t.wallet,
        'amount_minor', greatest(
          sum(jl.debit_minor) filter (where a.code in ('1000','1010','1030')),
          sum(jl.credit_minor) filter (where a.code in ('1000','1010','1030'))
        )::bigint
      )
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join transactions t on t.id = je.transaction_id
      join accounts a on a.id = jl.account_id
      where jl.business_id = p_business_id and a.code in ('1000','1010','1030')
        and t.occurred_at >= p_from::timestamptz
        and t.occurred_at < (p_to + 1)::timestamptz
      group by t.id, t.occurred_at, t.kind, t.wallet
      order by t.occurred_at::date, t.id;

  elsif p_report_key = 'commission' then
    if v_type <> 'AGENT' then
      raise exception 'REPORT_NOT_AVAILABLE: commission is agent-only' using errcode = '42501';
    end if;
    return query
      select jsonb_build_object(
        'date', t.occurred_at::date,
        'transaction_count', count(distinct t.id),
        'commission_minor', sum(jl.credit_minor - jl.debit_minor)::bigint
      )
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join transactions t on t.id = je.transaction_id
      join accounts a on a.id = jl.account_id
      where jl.business_id = p_business_id and a.code = '4200'
        and t.occurred_at >= p_from::timestamptz
        and t.occurred_at < (p_to + 1)::timestamptz
      group by t.occurred_at::date
      order by t.occurred_at::date;
  else
    raise exception 'REPORT_KEY_INVALID: unsupported report' using errcode = '22023';
  end if;
end $$;

create or replace function log_export(
  p_business_id uuid,
  p_report_key text,
  p_filters jsonb,
  p_format text,
  p_row_count integer,
  p_file_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_type business_type;
begin
  perform _assert_reauth();
  select type into v_type from businesses where id = p_business_id;
  if (v_type = 'MERCHANT' and not has_role(p_business_id, array['merchant_owner']::member_role[]))
     or (v_type = 'AGENT' and not has_role(p_business_id, array['agent_owner']::member_role[]))
     or v_type is null then
    raise exception 'OWNER_REQUIRED: matching owner role required' using errcode = '42501';
  end if;
  if p_format <> 'csv' or p_row_count < 0 or nullif(btrim(p_file_name), '') is null then
    raise exception 'EXPORT_INVALID: invalid export metadata' using errcode = '22023';
  end if;

  insert into exports (business_id, report_key, filters, format, row_count, file_name, requested_by)
  values (p_business_id, p_report_key, coalesce(p_filters, '{}'), p_format, p_row_count,
          p_file_name, auth.uid())
  returning id into v_id;

  insert into audit_events (business_id, actor_user_id, action, detail)
  values (p_business_id, auth.uid(), 'REPORT_EXPORTED', jsonb_build_object(
    'export_id', v_id, 'report_key', p_report_key, 'format', p_format,
    'row_count', p_row_count, 'filters', coalesce(p_filters, '{}')));

  return jsonb_build_object('export_id', v_id, 'expires_at', now() + interval '24 hours');
end $$;

revoke execute on function report_rows(uuid, text, date, date) from public, anon;
revoke execute on function log_export(uuid, text, jsonb, text, integer, text) from public, anon;
grant execute on function report_rows(uuid, text, date, date) to authenticated;
grant execute on function log_export(uuid, text, jsonb, text, integer, text) to authenticated;
