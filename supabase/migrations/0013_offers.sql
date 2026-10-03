-- P8: Offers (docs/03 M10-M11, docs/06 section 3 & 7, docs/08 section 10).
--
-- An offer is a time-bounded discount or loyalty scheme the merchant runs.
-- Budget cap is enforced with SELECT ... FOR UPDATE in redeem_offer: if the
-- next redemption would push spent_minor past budget_minor the offer is
-- AUTO-PAUSED and the call raises OFFER_BUDGET_EXHAUSTED. The caller may
-- choose to still record the sale at full price.
--
-- Lifecycle enforced by RPCs (optimistic concurrency WHERE status = expected):
--   DRAFT -> ACTIVE  (publish_offer)
--   ACTIVE -> PAUSED (pause_offer | auto-pause on budget exhaustion)
--   PAUSED -> ACTIVE (resume_offer)
--   ACTIVE | PAUSED -> ENDED (end_offer)
--
-- Ledger for a redemption (docs/06 section 5):
--   Dr 4010 Returns & discounts  | Cr 4000 Sales   (net sale posted at gross,
--   discount posted as 4010)
-- The gross sale is already in the books from the payment or cash-sale RPC;
-- redeem_offer adds the discount journal entry only.

-- ------------------------------------------------------------------ offers
create type offer_type as enum (
  'PERCENT_OFF',   -- params: {pct: number (1-100), min_purchase_minor?: number}
  'AMOUNT_OFF',    -- params: {off_minor: number, min_purchase_minor?: number}
  'BXGY',          -- params: {buy_qty: number, get_qty: number, product_hint?: text}
  'STAMP'          -- params: {goal: number, reward_minor: number}
);

create table offers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  type           offer_type not null,
  -- Type-specific parameters (pct, off_minor, buy/get, goal, reward_minor ...)
  params         jsonb not null default '{}',
  title          text not null,
  budget_minor   bigint not null check (budget_minor > 0),
  spent_minor    bigint not null default 0 check (spent_minor >= 0),
  -- Invariant enforced in redeem_offer via row lock (rule 6, docs/06 section 8).
  check (spent_minor <= budget_minor),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  check (ends_at > starts_at),
  audience       text not null default 'all'
                   check (audience in ('all','returning','new')),
  status         text not null default 'DRAFT'
                   check (status in ('DRAFT','ACTIVE','PAUSED','ENDED')),
  status_changed_at timestamptz not null default now(),
  pause_reason   text,
  created_by     uuid not null,
  created_at     timestamptz not null default now()
);

create index offers_business_status_idx on offers (business_id, status, starts_at desc);

alter table offers enable row level security;

create policy offer_owner_read on offers for select
  using (has_role(business_id, array['merchant_owner','agent_owner','manager']::member_role[]));

create policy offer_staff_read on offers for select
  using (is_member(business_id));

revoke insert, update, delete on offers from authenticated;

-- ------------------------------------------------------------------ offer_redemptions
create table offer_redemptions (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references offers(id),
  business_id    uuid not null references businesses(id),
  transaction_id uuid not null references transactions(id),
  customer_ref   text,
  discount_minor bigint not null check (discount_minor > 0),
  journal_entry_id uuid references journal_entries(id),
  created_at     timestamptz not null default now()
);

create index redemptions_offer_idx on offer_redemptions (offer_id, created_at desc);
create index redemptions_customer_idx on offer_redemptions (offer_id, customer_ref)
  where customer_ref is not null;

alter table offer_redemptions enable row level security;

create policy redemption_read on offer_redemptions for select
  using (is_member(business_id));

create trigger trg_redemption_append_only
  before update or delete on offer_redemptions
  for each row execute function block_mutation();

-- ------------------------------------------------------------------ stamp_cards
create table stamp_cards (
  id             uuid primary key default gen_random_uuid(),
  offer_id       uuid not null references offers(id),
  business_id    uuid not null references businesses(id),
  customer_ref   text not null,
  stamps         int not null default 0 check (stamps >= 0),
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  unique (offer_id, customer_ref)
);

create index stamp_cards_offer_idx on stamp_cards (offer_id, customer_ref);

alter table stamp_cards enable row level security;

create policy stamp_card_read on stamp_cards for select
  using (is_member(business_id));

-- ------------------------------------------------------------------ offer_results (DiD)
create table offer_results (
  offer_id           uuid primary key references offers(id),
  business_id        uuid not null references businesses(id),
  pre_period_days    int not null default 14,
  post_period_days   int not null default 14,
  pre_sales_minor    bigint not null default 0,
  post_sales_minor   bigint not null default 0,
  redemption_count   int not null default 0,
  total_discount_minor bigint not null default 0,
  net_lift_minor     bigint generated always as (post_sales_minor - pre_sales_minor) stored,
  computed_at        timestamptz not null default now()
);

alter table offer_results enable row level security;

create policy offer_results_read on offer_results for select
  using (has_role(business_id, array['merchant_owner','agent_owner','manager']::member_role[]));

-- ------------------------------------------------------------------ Helpers
create or replace function _assert_offer_manager(p_business_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role(p_business_id,
      array['merchant_owner','agent_owner','manager']::member_role[]) then
    raise exception 'ROLE_NOT_PERMITTED: owner or manager required for offers'
      using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ------------------------------------------------------------------ create_offer
create or replace function create_offer(
  p_business_id  uuid,
  p_type         offer_type,
  p_title        text,
  p_params       jsonb,
  p_budget_minor bigint,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_audience     text default 'all'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_id    uuid;
begin
  v_actor := _assert_offer_manager(p_business_id);
  perform _assert_amount(p_budget_minor);

  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'NAME_REQUIRED: offer title is required' using errcode = '22023';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'OFFER_DATE_INVALID: ends_at must be after starts_at'
      using errcode = '22023';
  end if;

  if coalesce(p_audience, 'all') not in ('all','returning','new') then
    raise exception 'OFFER_AUDIENCE_INVALID: audience must be all, returning or new'
      using errcode = '22023';
  end if;

  insert into offers (
    business_id, type, title, params, budget_minor,
    starts_at, ends_at, audience, status, created_by
  ) values (
    p_business_id, p_type, btrim(p_title), coalesce(p_params, '{}'),
    p_budget_minor, p_starts_at, p_ends_at,
    coalesce(p_audience, 'all'), 'DRAFT', v_actor
  ) returning id into v_id;

  return jsonb_build_object('offer_id', v_id, 'status', 'DRAFT');
end $$;

-- ------------------------------------------------------------------ publish_offer
create or replace function publish_offer(
  p_business_id uuid,
  p_offer_id    uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_offer offers;
begin
  v_actor := _assert_offer_manager(p_business_id);

  select * into v_offer
    from offers
   where id = p_offer_id and business_id = p_business_id and status = 'DRAFT'
   for update;

  if v_offer.id is null then
    raise exception 'OFFER_NOT_DRAFT: offer is not in DRAFT status'
      using errcode = '22023';
  end if;

  if v_offer.ends_at <= now() then
    raise exception 'OFFER_ALREADY_ENDED: offer end date is in the past'
      using errcode = '22023';
  end if;

  update offers
     set status = 'ACTIVE', status_changed_at = now(), pause_reason = null
   where id = p_offer_id;

  return jsonb_build_object('offer_id', p_offer_id, 'status', 'ACTIVE');
end $$;

-- ------------------------------------------------------------------ pause_offer
create or replace function pause_offer(
  p_business_id uuid,
  p_offer_id    uuid,
  p_reason      text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_offer offers;
begin
  v_actor := _assert_offer_manager(p_business_id);

  select * into v_offer
    from offers
   where id = p_offer_id and business_id = p_business_id and status = 'ACTIVE'
   for update;

  if v_offer.id is null then
    raise exception 'OFFER_NOT_ACTIVE: offer is not ACTIVE' using errcode = '22023';
  end if;

  update offers
     set status = 'PAUSED',
         status_changed_at = now(),
         pause_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_offer_id;

  return jsonb_build_object('offer_id', p_offer_id, 'status', 'PAUSED');
end $$;

-- ------------------------------------------------------------------ resume_offer
create or replace function resume_offer(
  p_business_id uuid,
  p_offer_id    uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_offer offers;
begin
  v_actor := _assert_offer_manager(p_business_id);

  select * into v_offer
    from offers
   where id = p_offer_id and business_id = p_business_id and status = 'PAUSED'
   for update;

  if v_offer.id is null then
    raise exception 'OFFER_NOT_PAUSED: offer is not PAUSED' using errcode = '22023';
  end if;

  if v_offer.ends_at <= now() then
    raise exception 'OFFER_ALREADY_ENDED: offer end date is in the past'
      using errcode = '22023';
  end if;

  if v_offer.spent_minor >= v_offer.budget_minor then
    raise exception 'OFFER_BUDGET_EXHAUSTED: budget fully spent, cannot resume'
      using errcode = '22023';
  end if;

  update offers
     set status = 'ACTIVE', status_changed_at = now(), pause_reason = null
   where id = p_offer_id;

  return jsonb_build_object('offer_id', p_offer_id, 'status', 'ACTIVE');
end $$;

-- ------------------------------------------------------------------ end_offer
create or replace function end_offer(
  p_business_id uuid,
  p_offer_id    uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_offer offers;
begin
  v_actor := _assert_offer_manager(p_business_id);

  select * into v_offer
    from offers
   where id = p_offer_id and business_id = p_business_id
     and status in ('ACTIVE','PAUSED')
   for update;

  if v_offer.id is null then
    raise exception 'OFFER_NOT_ENDABLE: offer must be ACTIVE or PAUSED to end'
      using errcode = '22023';
  end if;

  update offers
     set status = 'ENDED', status_changed_at = now()
   where id = p_offer_id;

  -- Compute DiD results immediately.
  perform _compute_offer_results(p_business_id, p_offer_id);

  return jsonb_build_object('offer_id', p_offer_id, 'status', 'ENDED');
end $$;

-- ------------------------------------------------------------------ redeem_offer
-- Called after the sale is already posted (the QR payment or cash-sale RPC ran).
-- Adds the discount journal entry (Dr 4010 / Cr 4000) and records the redemption.
-- Budget cap enforced here with FOR UPDATE row lock.
create or replace function redeem_offer(
  p_business_id    uuid,
  p_offer_id       uuid,
  p_transaction_id uuid,
  p_discount_minor bigint,
  p_customer_ref   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor    uuid;
  v_offer    offers;
  v_entry_id uuid;
  v_red_id   uuid;
begin
  v_actor := _assert_can_post(p_business_id, 'can_add_entries');
  perform _assert_amount(p_discount_minor);

  -- Lock the offer row so concurrent redemptions cannot both pass the cap check.
  select * into v_offer
    from offers
   where id = p_offer_id and business_id = p_business_id
   for update;

  if v_offer.id is null then
    raise exception 'OFFER_NOT_FOUND: no such offer in this business'
      using errcode = 'P0002';
  end if;

  if v_offer.status <> 'ACTIVE' then
    raise exception 'OFFER_NOT_ACTIVE: offer is % and cannot be redeemed', v_offer.status
      using errcode = '22023';
  end if;

  if v_offer.ends_at < now() then
    update offers set status = 'ENDED', status_changed_at = now() where id = p_offer_id;
    raise exception 'OFFER_EXPIRED: offer has ended' using errcode = '22023';
  end if;

  -- Budget cap: auto-pause if this redemption would exceed the budget.
  if v_offer.spent_minor + p_discount_minor > v_offer.budget_minor then
    update offers
       set status = 'PAUSED',
           status_changed_at = now(),
           pause_reason = 'budget_exhausted'
     where id = p_offer_id;
    raise exception 'OFFER_BUDGET_EXHAUSTED: budget reached, offer paused'
      using errcode = '22023';
  end if;

  -- Post the 4010 discount journal entry.
  -- Dr 4010 Returns & discounts | Cr 4000 Sales
  insert into journal_entries (business_id, transaction_id, memo)
  values (p_business_id, p_transaction_id,
          concat_ws(' ', 'Offer discount:', v_offer.title))
  returning id into v_entry_id;

  insert into journal_lines (entry_id, business_id, account_id, debit_minor, credit_minor)
  values
    (v_entry_id, p_business_id, _account_id(p_business_id, '4010'), p_discount_minor, 0),
    (v_entry_id, p_business_id, _account_id(p_business_id, '4000'), 0, p_discount_minor);

  insert into offer_redemptions (
    offer_id, business_id, transaction_id, customer_ref, discount_minor, journal_entry_id
  ) values (
    p_offer_id, p_business_id, p_transaction_id,
    nullif(btrim(coalesce(p_customer_ref, '')), ''),
    p_discount_minor, v_entry_id
  ) returning id into v_red_id;

  update offers
     set spent_minor = spent_minor + p_discount_minor
   where id = p_offer_id;

  return jsonb_build_object(
    'redemption_id', v_red_id,
    'discount_minor', p_discount_minor,
    'spent_minor', v_offer.spent_minor + p_discount_minor,
    'budget_minor', v_offer.budget_minor
  );
end $$;

-- ------------------------------------------------------------------ stamp_progress
create or replace function stamp_progress(
  p_business_id    uuid,
  p_offer_id       uuid,
  p_customer_ref   text,
  p_transaction_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_offer     offers;
  v_goal      int;
  v_reward    bigint;
  v_stamps    int;
  v_completed boolean := false;
begin
  perform _assert_can_post(p_business_id, 'can_add_entries');

  select * into v_offer
    from offers
   where id = p_offer_id and business_id = p_business_id and type = 'STAMP'
   for share;

  if v_offer.id is null then
    raise exception 'OFFER_NOT_FOUND: no STAMP offer with this id' using errcode = 'P0002';
  end if;

  if v_offer.status <> 'ACTIVE' then
    raise exception 'OFFER_NOT_ACTIVE: stamp offer is not active' using errcode = '22023';
  end if;

  v_goal   := (v_offer.params ->> 'goal')::int;
  v_reward := (v_offer.params ->> 'reward_minor')::bigint;

  insert into stamp_cards (offer_id, business_id, customer_ref, stamps)
  values (p_offer_id, p_business_id, p_customer_ref, 1)
  on conflict (offer_id, customer_ref) do update
     set stamps = stamp_cards.stamps + 1,
         updated_at = now()
  returning stamps into v_stamps;

  if v_stamps >= v_goal then
    update stamp_cards
       set completed_at = now(), stamps = 0
     where offer_id = p_offer_id and customer_ref = p_customer_ref;
    v_stamps := 0;
    v_completed := true;
  end if;

  return jsonb_build_object(
    'stamps', v_stamps,
    'goal', v_goal,
    'completed', v_completed,
    'reward_minor', case when v_completed then v_reward else null end
  );
end $$;

-- ------------------------------------------------------------------ list_offers
create or replace function list_offers(
  p_business_id uuid,
  p_status      text default null
) returns table (
  id uuid, type offer_type, title text, params jsonb,
  budget_minor bigint, spent_minor bigint,
  starts_at timestamptz, ends_at timestamptz,
  audience text, status text, status_changed_at timestamptz,
  redemption_count bigint, total_discount_minor bigint
)
language sql stable security definer set search_path = public as $$
  select o.id, o.type, o.title, o.params, o.budget_minor, o.spent_minor,
         o.starts_at, o.ends_at, o.audience, o.status, o.status_changed_at,
         count(r.id)::bigint,
         coalesce(sum(r.discount_minor), 0)::bigint
    from offers o
    left join offer_redemptions r on r.offer_id = o.id
   where o.business_id = p_business_id
     and has_role(p_business_id,
           array['merchant_owner','agent_owner','manager']::member_role[])
     and (p_status is null or o.status = p_status)
   group by o.id
   order by o.created_at desc;
$$;

-- ------------------------------------------------------------------ _compute_offer_results (DiD)
create or replace function _compute_offer_results(
  p_business_id uuid,
  p_offer_id    uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_offer       offers;
  v_pre_sales   bigint;
  v_post_sales  bigint;
  v_redemptions int;
  v_discount    bigint;
begin
  select * into v_offer from offers where id = p_offer_id and business_id = p_business_id;
  if v_offer.id is null then return; end if;

  select coalesce(sum(t.amount_minor), 0) into v_pre_sales
    from transactions t
   where t.business_id = p_business_id
     and t.kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE')
     and t.occurred_at >= v_offer.starts_at - interval '14 days'
     and t.occurred_at <  v_offer.starts_at;

  select coalesce(sum(t.amount_minor), 0) into v_post_sales
    from transactions t
   where t.business_id = p_business_id
     and t.kind in ('QR_PAYMENT','CASH_SALE','BAKI_SALE')
     and t.occurred_at >= v_offer.ends_at
     and t.occurred_at <  v_offer.ends_at + interval '14 days';

  select count(*)::int, coalesce(sum(discount_minor), 0)::bigint
    into v_redemptions, v_discount
    from offer_redemptions
   where offer_id = p_offer_id;

  insert into offer_results (
    offer_id, business_id, pre_sales_minor, post_sales_minor,
    redemption_count, total_discount_minor, computed_at
  ) values (
    p_offer_id, p_business_id, v_pre_sales, v_post_sales,
    v_redemptions, v_discount, now()
  )
  on conflict (offer_id) do update
     set pre_sales_minor      = excluded.pre_sales_minor,
         post_sales_minor     = excluded.post_sales_minor,
         redemption_count     = excluded.redemption_count,
         total_discount_minor = excluded.total_discount_minor,
         computed_at          = excluded.computed_at;
end $$;

-- ------------------------------------------------------------------ auto_expire_offers
create or replace function auto_expire_offers() returns void
language plpgsql security definer set search_path = public as $$
begin
  update offers
     set status = 'ENDED', status_changed_at = now()
   where status in ('ACTIVE','PAUSED')
     and ends_at < now();

  perform _compute_offer_results(o.business_id, o.id)
    from offers o
   where o.status = 'ENDED'
     and not exists (select 1 from offer_results r where r.offer_id = o.id);
end $$;

-- ------------------------------------------------------------------ Grants
revoke execute on function _assert_offer_manager(uuid) from public;
revoke execute on function create_offer(uuid, offer_type, text, jsonb, bigint, timestamptz, timestamptz, text) from public;
revoke execute on function publish_offer(uuid, uuid) from public;
revoke execute on function pause_offer(uuid, uuid, text) from public;
revoke execute on function resume_offer(uuid, uuid) from public;
revoke execute on function end_offer(uuid, uuid) from public;
revoke execute on function redeem_offer(uuid, uuid, uuid, bigint, text) from public;
revoke execute on function stamp_progress(uuid, uuid, text, uuid) from public;
revoke execute on function list_offers(uuid, text) from public;
revoke execute on function _compute_offer_results(uuid, uuid) from public;
revoke execute on function auto_expire_offers() from public;

grant execute on function create_offer(uuid, offer_type, text, jsonb, bigint, timestamptz, timestamptz, text) to authenticated;
grant execute on function publish_offer(uuid, uuid) to authenticated;
grant execute on function pause_offer(uuid, uuid, text) to authenticated;
grant execute on function resume_offer(uuid, uuid) to authenticated;
grant execute on function end_offer(uuid, uuid) to authenticated;
grant execute on function redeem_offer(uuid, uuid, uuid, bigint, text) to authenticated;
grant execute on function stamp_progress(uuid, uuid, text, uuid) to authenticated;
grant execute on function list_offers(uuid, text) to authenticated;
