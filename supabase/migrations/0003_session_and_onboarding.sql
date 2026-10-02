-- BizFlow P2: session and onboarding.
--   me()              - everything the app shell needs after login, in one round trip
--   create_business() - onboarding: business + owner membership + chart of accounts +
--                       the opening balance entry, in one transaction
--
-- Both are SECURITY DEFINER. me() reads only the caller's own rows; create_business()
-- makes the caller the owner of the business it creates, so it cannot be used to join
-- or modify an existing one.

-- ------------------------------------------------------------------ Session
-- Returns the user, their memberships with role and staff permission toggles, and a
-- summary of each business. The app picks the active business from this list; the
-- posting RPCs re-check membership on every call, so this payload is a convenience,
-- never an authorisation (docs/02 section 7).
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

  return jsonb_build_object(
    'user_id', v_uid,
    'businesses', v_businesses
  );
end $$;

-- ------------------------------------------------------------------ Onboarding
-- Creates a business, makes the caller its owner, seeds the chart of accounts, and posts
-- the opening balances as a single balanced entry against owner equity (docs/06: opening
-- cash and wallet are assets funded by 3000 Owner equity).
--
-- p_opening_cash_minor and p_opening_wallet_minor are integer poisha and may be zero.
-- Idempotent on p_client_uuid so a retried onboarding does not create a second business.
create or replace function create_business(
  p_type business_type,
  p_name text,
  p_category text,
  p_client_uuid uuid,
  p_location_type text default null,
  p_opening_cash_minor bigint default 0,
  p_opening_wallet_minor bigint default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_business_id uuid;
  v_role member_role;
  v_txn_id uuid;
  v_entry_id uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total bigint;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED: no session'
      using errcode = '42501';
  end if;

  if p_client_uuid is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED: client_uuid is required'
      using errcode = '22023';
  end if;

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED: business name is required'
      using errcode = '22023';
  end if;

  if coalesce(p_opening_cash_minor, 0) < 0 or coalesce(p_opening_wallet_minor, 0) < 0 then
    raise exception 'AMOUNT_INVALID: opening balances cannot be negative'
      using errcode = '22023';
  end if;

  -- A retry of the same onboarding returns the business created the first time.
  select k.business_id into v_existing
    from idempotency_keys k
   where k.client_uuid = p_client_uuid
     and exists (select 1 from memberships m
                  where m.business_id = k.business_id and m.user_id = v_uid);
  if v_existing is not null then
    return jsonb_build_object('business_id', v_existing, 'replayed', true);
  end if;

  v_role := case p_type when 'AGENT' then 'agent_owner' else 'merchant_owner' end;

  insert into businesses (type, name, category, location_type)
  values (p_type, btrim(p_name), p_category, p_location_type)
  returning id into v_business_id;

  insert into memberships (user_id, business_id, role)
  values (v_uid, v_business_id, v_role);

  perform seed_accounts(v_business_id, p_type);

  -- Opening balances. Nothing to post when the owner starts from zero.
  v_total := coalesce(p_opening_cash_minor, 0) + coalesce(p_opening_wallet_minor, 0);

  if v_total > 0 then
    if coalesce(p_opening_cash_minor, 0) > 0 then
      v_lines := v_lines || jsonb_build_object('code', '1000', 'debit', p_opening_cash_minor);
    end if;
    if coalesce(p_opening_wallet_minor, 0) > 0 then
      v_lines := v_lines || jsonb_build_object('code', '1010', 'debit', p_opening_wallet_minor);
    end if;
    v_lines := v_lines || jsonb_build_object('code', '3000', 'credit', v_total);

    insert into transactions (
      business_id, kind, source, amount_minor, note,
      actor_user_id, client_uuid, occurred_at
    ) values (
      v_business_id, 'OWNER_DEPOSIT', 'manual', v_total, 'Opening balance',
      v_uid, p_client_uuid, now()
    )
    returning id into v_txn_id;

    v_entry_id := _post_journal(v_business_id, v_txn_id, v_lines, 'Opening balance');

    insert into idempotency_keys (business_id, client_uuid, request_hash, transaction_id)
    values (v_business_id, p_client_uuid,
            md5(concat_ws('|', 'OPENING', v_business_id, v_total)), v_txn_id);
  end if;

  insert into audit_events (business_id, actor_user_id, action, transaction_id, detail)
  values (v_business_id, v_uid, 'business.created', v_txn_id,
          jsonb_build_object('type', p_type, 'opening_total_minor', v_total));

  return jsonb_build_object(
    'business_id', v_business_id,
    'role', v_role,
    'opening_total_minor', v_total,
    'replayed', false
  );
end $$;

-- ------------------------------------------------------------------ Grants
revoke execute on function me() from public;
revoke execute on function create_business(
  business_type, text, text, uuid, text, bigint, bigint) from public;

grant execute on function me() to authenticated;
grant execute on function create_business(
  business_type, text, text, uuid, text, bigint, bigint) to authenticated;

-- A fresh signup needs to insert its own membership row through create_business only;
-- 0001 granted no direct insert on memberships, so nothing further is needed here.
