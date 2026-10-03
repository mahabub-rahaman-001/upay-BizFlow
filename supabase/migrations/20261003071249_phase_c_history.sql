-- Phase C: profile completeness and read-only closing/audit history.
-- History RPCs are intentionally bounded. Both authenticate inside the function before
-- reading through SECURITY DEFINER, and only authenticated callers receive EXECUTE.

-- `businesses.upay_account_ref` already exists, but the session payload did not expose it.
-- Keep the existing me() contract and add that one profile field; this is not a new RPC.
create or replace function me()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_businesses jsonb;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED: no session'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'business_id', b.id,
             'type', b.type,
             'name', b.name,
             'category', b.category,
             'upay_account_ref', b.upay_account_ref,
             'verified', b.verified,
             'status', b.status,
             'role', m.role,
             'permissions', m.permissions
           ) order by b.created_at),
         '[]'::jsonb)
    into v_businesses
    from memberships m
    join businesses b on b.id = m.business_id
   where m.user_id = v_uid and m.status = 'active';

  return jsonb_build_object('user_id', v_uid, 'businesses', v_businesses);
end $$;

create or replace function closing_history(
  p_business_id uuid,
  p_before_period_date date default null,
  p_before_version integer default null,
  p_limit integer default 50
) returns table (
  closing_id uuid,
  period_date date,
  expected_cash_minor bigint,
  counted_cash_minor bigint,
  variance_minor bigint,
  version integer,
  status text,
  created_at timestamptz,
  note text,
  exception_reason text,
  can_reopen boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_type business_type;
  v_can_reopen boolean;
begin
  if not is_member(p_business_id) then
    raise exception 'NOT_A_MEMBER: no active membership for this business'
      using errcode = '42501';
  end if;

  select b.type into v_type from businesses b where b.id = p_business_id;
  if v_type is distinct from 'MERCHANT'::business_type then
    raise exception 'MERCHANT_BUSINESS_REQUIRED: closing history is only for merchants'
      using errcode = '42501';
  end if;

  v_can_reopen := has_role(
    p_business_id,
    array['merchant_owner']::member_role[]
  );

  return query
  select c.id,
         c.period_date,
         c.expected_cash_minor,
         c.counted_cash_minor,
         c.variance_minor,
         c.version,
         c.status,
         c.created_at,
         c.note,
         c.exception_reason,
         v_can_reopen
           and c.status = 'CLOSED'
           and not exists (
             select 1 from daily_closings later where later.supersedes_id = c.id
           ) as can_reopen
    from daily_closings c
   where c.business_id = p_business_id
     and c.scope = 'business'
     and (
       p_before_period_date is null
       or p_before_version is null
       or (c.period_date, c.version) < (p_before_period_date, p_before_version)
     )
   order by c.period_date desc, c.version desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

create or replace function audit_history(
  p_business_id uuid,
  p_before_period_date date default null,
  p_limit integer default 50
) returns table (
  audit_id uuid,
  period_date date,
  expected_cash_minor bigint,
  counted_cash_minor bigint,
  cash_variance_minor bigint,
  expected_upay_minor bigint,
  actual_upay_minor bigint,
  upay_variance_minor bigint,
  commission_minor bigint,
  note text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_type business_type;
begin
  if not has_role(
    p_business_id,
    array['agent_owner','manager']::member_role[]
  ) then
    raise exception 'ROLE_NOT_PERMITTED: agent owner or manager role required'
      using errcode = '42501';
  end if;

  select b.type into v_type from businesses b where b.id = p_business_id;
  if v_type is distinct from 'AGENT'::business_type then
    raise exception 'AGENT_BUSINESS_REQUIRED: audit history is only for agents'
      using errcode = '42501';
  end if;

  return query
  select a.id,
         a.period_date,
         a.expected_cash_minor,
         a.counted_cash_minor,
         a.cash_variance_minor,
         a.expected_upay_minor,
         a.actual_upay_minor,
         a.upay_variance_minor,
         a.commission_minor,
         a.note,
         a.created_at
    from agent_float_audits a
   where a.business_id = p_business_id
     and (p_before_period_date is null or a.period_date < p_before_period_date)
   order by a.period_date desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- Supabase's default privileges grant EXECUTE to anon on functions created by postgres, so
-- revoking from public is not enough to keep an anonymous caller out: revoke from anon too.
revoke execute on function me() from public, anon;
revoke execute on function closing_history(uuid, date, integer, integer) from public, anon;
revoke execute on function audit_history(uuid, date, integer) from public, anon;

grant execute on function me() to authenticated;
grant execute on function closing_history(uuid, date, integer, integer) to authenticated;
grant execute on function audit_history(uuid, date, integer) to authenticated;
