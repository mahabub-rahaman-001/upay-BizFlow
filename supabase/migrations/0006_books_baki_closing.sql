-- BizFlow P4: merchant books - customers, baki and the daily closing.
--
-- Baki gets no ledger of its own. A credit sale is 1100 Baki receivable against 4000
-- Sales, and a collection moves 1100 into cash or wallet, so a customer's balance is
-- derived from the journal like every other number (docs/06 section 5). There is nothing
-- to keep in sync and nothing that can disagree with the books.
--
-- The daily closing is versioned and append-only: reopening a day writes a new version
-- and keeps the old one (docs/06 section 7).

-- ------------------------------------------------------------------ Customers
-- Phone is optional and consent is explicit, because a reminder may only be sent to
-- someone who agreed to it (docs/03 M5, docs/09). The last four digits are stored
-- separately so a list can show "01****1234" without reading the full number.
create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text,
  phone_last4 text generated always as (right(phone, 4)) stored,
  consent_to_contact boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create index customers_business_idx on customers (business_id, name);

alter table customers enable row level security;

create policy customer_read on customers for select using (is_member(business_id));

-- Now that customers exist, the column transactions already carries can be constrained.
alter table transactions
  add constraint transactions_customer_fk
  foreign key (customer_id) references customers(id);

-- ------------------------------------------------------------------ Daily closing
-- One row per closing attempt. A reopen never edits the earlier row; it writes a new
-- version that points back at the one it supersedes.
create table daily_closings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  scope text not null default 'business' check (scope in ('business','shift')),
  period_date date not null,
  version int not null default 1,
  status text not null check (status in ('CLOSED','REOPENED')),
  expected_cash_minor bigint not null,
  counted_cash_minor bigint not null,
  variance_minor bigint not null,
  note text,
  exception_reason text,
  supersedes_id uuid references daily_closings(id),
  variance_transaction_id uuid references transactions(id),
  closed_by uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, scope, period_date, version)
);

create index daily_closings_business_idx
  on daily_closings (business_id, period_date desc, version desc);

alter table daily_closings enable row level security;

create policy closing_read on daily_closings for select using (is_member(business_id));

create trigger trg_closing_append_only
  before update or delete on daily_closings
  for each row execute function block_mutation();

-- ------------------------------------------------------------------ Customers API
create or replace function create_customer(
  p_business_id uuid,
  p_name text,
  p_phone text default null,
  p_consent_to_contact boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform _assert_can_post(p_business_id, 'can_add_entries');

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED: customer name is required'
      using errcode = '22023';
  end if;

  insert into customers (business_id, name, phone, consent_to_contact)
  values (p_business_id, btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''),
          coalesce(p_consent_to_contact, false))
  on conflict (business_id, name) do update set name = excluded.name
  returning id into v_id;

  return jsonb_build_object('customer_id', v_id);
end $$;

-- A customer's baki balance is what account 1100 holds for their rows: credit sales add
-- to it, collections take it away.
create or replace function customer_balances(p_business_id uuid)
returns table (customer_id uuid, name text, phone_last4 text, balance_minor bigint)
language sql stable security definer set search_path = public as $$
  select c.id,
         c.name,
         c.phone_last4,
         coalesce(sum(
           case when t.kind = 'BAKI_SALE' then t.amount_minor
                when t.kind = 'BAKI_COLLECTION' then -t.amount_minor
                else 0 end
         ), 0)::bigint
    from customers c
    left join transactions t
           on t.customer_id = c.id
          and t.business_id = c.business_id
          -- A reversed entry and its mirror cancel out, so neither is counted.
          and not exists (select 1 from transactions r where r.reverses_txn_id = t.id)
          and t.kind <> 'REVERSAL'
   where c.business_id = p_business_id
     and is_member(p_business_id)
   group by c.id, c.name, c.phone_last4
   order by 4 desc, c.name;
$$;

-- ------------------------------------------------------------------ Baki posting
-- "Gave baki": goods left the shop, money did not (1100 debit / 4000 credit).
create or replace function post_baki_sale(
  p_business_id uuid,
  p_amount_minor bigint,
  p_client_uuid uuid,
  p_customer_id uuid,
  p_note text default null,
  p_occurred_at timestamptz default null,
  p_device_time timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_hash text;
  v_existing uuid;
begin
  v_actor := _assert_can_post(p_business_id, 'can_add_entries');
  perform _assert_amount(p_amount_minor);

  if not exists (select 1 from customers
                  where id = p_customer_id and business_id = p_business_id) then
    raise exception 'CUSTOMER_NOT_FOUND: no such customer in this business'
      using errcode = 'P0002';
  end if;

  v_hash := md5(concat_ws('|', 'BAKI_SALE', p_business_id, p_amount_minor,
                          p_customer_id, p_note));
  v_existing := _idempotent_lookup(p_business_id, p_client_uuid, v_hash);
  if v_existing is not null then
    return _replay(v_existing);
  end if;

  return _post_transaction(
    p_business_id, 'BAKI_SALE', 'manual', p_amount_minor,
    jsonb_build_array(
      jsonb_build_object('code', '1100', 'debit', p_amount_minor),
      jsonb_build_object('code', '4000', 'credit', p_amount_minor)
    ),
    p_client_uuid, v_hash, v_actor, p_occurred_at, p_device_time,
    null, null, p_note, p_customer_id
  );
end $$;

-- "Received": the customer paid some of it back, in cash or into the wallet.
create or replace function post_baki_collection(
  p_business_id uuid,
  p_amount_minor bigint,
  p_client_uuid uuid,
  p_customer_id uuid,
  p_received_in text default 'cash',
  p_note text default null,
  p_occurred_at timestamptz default null,
  p_device_time timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_hash text;
  v_existing uuid;
  v_debit_code text;
  v_outstanding bigint;
begin
  v_actor := _assert_can_post(p_business_id, 'can_add_entries');
  perform _assert_amount(p_amount_minor);

  v_debit_code := case p_received_in
    when 'cash' then '1000'
    when 'wallet' then '1010'
    else null
  end;
  if v_debit_code is null then
    raise exception 'PAID_FROM_INVALID: received_in must be cash or wallet'
      using errcode = '22023';
  end if;

  select balance_minor into v_outstanding
    from customer_balances(p_business_id)
   where customer_id = p_customer_id;

  if v_outstanding is null then
    raise exception 'CUSTOMER_NOT_FOUND: no such customer in this business'
      using errcode = 'P0002';
  end if;

  -- Collecting more than is owed would push account 1100 negative, which is not a thing
  -- a shop can mean. The owner should record the extra as a sale instead.
  if p_amount_minor > v_outstanding then
    raise exception 'COLLECTION_EXCEEDS_BAKI: outstanding is % poisha', v_outstanding
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', 'BAKI_COLLECTION', p_business_id, p_amount_minor,
                          p_customer_id, p_received_in, p_note));
  v_existing := _idempotent_lookup(p_business_id, p_client_uuid, v_hash);
  if v_existing is not null then
    return _replay(v_existing);
  end if;

  return _post_transaction(
    p_business_id, 'BAKI_COLLECTION', 'manual', p_amount_minor,
    jsonb_build_array(
      jsonb_build_object('code', v_debit_code, 'debit', p_amount_minor),
      jsonb_build_object('code', '1100', 'credit', p_amount_minor)
    ),
    p_client_uuid, v_hash, v_actor, p_occurred_at, p_device_time,
    p_received_in, null, p_note, p_customer_id
  );
end $$;

-- ------------------------------------------------------------------ Closing
-- What the closing screen shows before the owner counts the drawer (docs/04 section 13.6).
-- Expected drawer cash is the running balance of account 1000 up to the end of the day,
-- which is the definition in docs/06 section 6 - opening cash plus cash in, minus cash out.
create or replace function closing_preview(
  p_business_id uuid,
  p_period_date date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := coalesce(p_period_date, (now() at time zone 'Asia/Dhaka')::date);
  v_day_start timestamptz := (v_date::timestamp at time zone 'Asia/Dhaka');
  v_day_end timestamptz := ((v_date + 1)::timestamp at time zone 'Asia/Dhaka');
  v_expected bigint;
  v_tolerance bigint;
  v_blocker_threshold bigint;
  v_already_closed boolean;
begin
  if not is_member(p_business_id) then
    raise exception 'NOT_A_MEMBER: no active membership for this business'
      using errcode = '42501';
  end if;

  select coalesce((settings ->> 'closing_tolerance_minor')::bigint, 10000),
         coalesce((settings ->> 'closing_blocker_minor')::bigint, 200000)
    into v_tolerance, v_blocker_threshold
    from businesses where id = p_business_id;

  -- Everything that has touched the drawer up to the end of this day.
  select coalesce(sum(l.debit_minor) - sum(l.credit_minor), 0)::bigint
    into v_expected
    from journal_lines l
    join accounts a on a.id = l.account_id
    join journal_entries je on je.id = l.entry_id
    join transactions t on t.id = je.transaction_id
   where a.business_id = p_business_id
     and a.code = '1000'
     and t.occurred_at < v_day_end;

  select exists (
    select 1 from daily_closings
     where business_id = p_business_id and period_date = v_date and status = 'CLOSED'
       and not exists (select 1 from daily_closings later
                        where later.supersedes_id = daily_closings.id)
  ) into v_already_closed;

  return jsonb_build_object(
    'period_date', v_date,
    'expected_cash_minor', v_expected,
    'tolerance_minor', v_tolerance,
    'already_closed', v_already_closed,
    'lines', (
      -- The breakdown the screen lists above the expected figure.
      select coalesce(jsonb_object_agg(kind, total), '{}'::jsonb)
        from (
          select t.kind::text as kind, sum(t.amount_minor)::bigint as total
            from transactions t
           where t.business_id = p_business_id
             and t.occurred_at >= v_day_start and t.occurred_at < v_day_end
           group by t.kind
        ) k
    ),
    'blockers', (
      -- Payments still awaiting settlement above the material threshold must be looked at
      -- before the day is closed, or closed with a stated exception (docs/03 M8 step 5).
      select coalesce(jsonb_agg(jsonb_build_object(
               'transaction_id', t.id,
               'amount_minor', t.amount_minor,
               'reason', 'PENDING_SETTLEMENT')), '[]'::jsonb)
        from transactions t
       where t.business_id = p_business_id
         and t.wallet = 'pending'
         and t.kind = 'QR_PAYMENT'
         and t.amount_minor >= v_blocker_threshold
         and t.occurred_at < v_day_end
         and not exists (
           select 1 from transactions s
            join payment_events se on se.id = s.payment_event_id
            join payment_events oe on oe.id = t.payment_event_id
            where s.kind = 'SETTLEMENT'
              and se.provider_txn_id = oe.provider_txn_id)
    )
  );
end $$;

-- Closes the day. The variance between counted and expected is posted to 9000 Cash
-- over/short, so after closing the drawer account equals what was actually counted and
-- the difference is on the books rather than hidden (docs/06 section 5).
create or replace function post_closing(
  p_business_id uuid,
  p_counted_cash_minor bigint,
  p_client_uuid uuid,
  p_period_date date default null,
  p_note text default null,
  p_exception_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_date date := coalesce(p_period_date, (now() at time zone 'Asia/Dhaka')::date);
  v_preview jsonb;
  v_expected bigint;
  v_variance bigint;
  v_blockers jsonb;
  v_version int;
  v_supersedes uuid;
  v_latest_status text;
  v_txn jsonb;
  v_txn_id uuid;
  v_closing_id uuid;
begin
  -- Closing the business day is an owner action (docs/02 section 4).
  v_actor := _assert_is_owner(p_business_id);

  if p_counted_cash_minor is null or p_counted_cash_minor < 0 then
    raise exception 'AMOUNT_INVALID: counted cash cannot be negative'
      using errcode = '22023';
  end if;

  v_preview := closing_preview(p_business_id, v_date);
  v_expected := (v_preview ->> 'expected_cash_minor')::bigint;
  v_blockers := v_preview -> 'blockers';
  v_variance := p_counted_cash_minor - v_expected;

  -- A blocker does not stop the day being closed, but it has to be acknowledged in
  -- writing, which is what makes the closing receipt trustworthy later.
  if jsonb_array_length(v_blockers) > 0
     and (p_exception_reason is null or length(btrim(p_exception_reason)) = 0) then
    raise exception 'BLOCKERS_UNRESOLVED: % item(s) need review or an exception reason',
      jsonb_array_length(v_blockers)
      using errcode = '22023';
  end if;

  -- A reopened day closes again as the next version; the earlier row stays untouched.
  select id, version, status into v_supersedes, v_version, v_latest_status
    from daily_closings
   where business_id = p_business_id and scope = 'business' and period_date = v_date
   order by version desc limit 1;

  if v_latest_status = 'CLOSED' then
    raise exception 'ALREADY_CLOSED: reopen this day before closing it again'
      using errcode = '23505';
  end if;

  v_version := coalesce(v_version, 0) + 1;

  -- Only a real difference reaches the ledger.
  if v_variance <> 0 then
    v_txn := _post_transaction(
      p_business_id, 'CLOSING_VARIANCE', 'manual', abs(v_variance),
      case when v_variance < 0
           -- Short: the drawer holds less than the books say.
           then jsonb_build_array(
                  jsonb_build_object('code', '9000', 'debit', abs(v_variance)),
                  jsonb_build_object('code', '1000', 'credit', abs(v_variance)))
           -- Over: more cash than expected.
           else jsonb_build_array(
                  jsonb_build_object('code', '1000', 'debit', v_variance),
                  jsonb_build_object('code', '9000', 'credit', v_variance))
      end,
      p_client_uuid,
      md5(concat_ws('|', 'CLOSING', p_business_id, v_date, v_version, p_counted_cash_minor)),
      v_actor, now(), null, 'cash', null,
      coalesce(p_note, 'Daily closing variance')
    );
    v_txn_id := (v_txn ->> 'transaction_id')::uuid;
  end if;

  insert into daily_closings (
    business_id, scope, period_date, version, status,
    expected_cash_minor, counted_cash_minor, variance_minor,
    note, exception_reason, supersedes_id, variance_transaction_id, closed_by
  ) values (
    p_business_id, 'business', v_date, v_version, 'CLOSED',
    v_expected, p_counted_cash_minor, v_variance,
    p_note, nullif(btrim(coalesce(p_exception_reason, '')), ''), v_supersedes, v_txn_id,
    v_actor
  )
  returning id into v_closing_id;

  insert into audit_events (business_id, actor_user_id, action, transaction_id, reason, detail)
  values (p_business_id, v_actor, 'day.closed', v_txn_id, p_exception_reason,
          jsonb_build_object('closing_id', v_closing_id, 'version', v_version,
                             'variance_minor', v_variance));

  return jsonb_build_object(
    'closing_id', v_closing_id,
    'period_date', v_date,
    'version', v_version,
    'expected_cash_minor', v_expected,
    'counted_cash_minor', p_counted_cash_minor,
    'variance_minor', v_variance,
    'variance_transaction_id', v_txn_id
  );
end $$;

-- Reopening keeps the closed version and adds a REOPENED marker above it, so the history
-- of a day reads as a list of versions rather than a value that changed (docs/06 section 7).
create or replace function reopen_closing(
  p_business_id uuid,
  p_closing_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  v_closing daily_closings;
  v_new_id uuid;
begin
  v_actor := _assert_is_owner(p_business_id);

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: reopening a day needs a reason'
      using errcode = '22023';
  end if;

  select * into v_closing from daily_closings
   where id = p_closing_id and business_id = p_business_id;

  if v_closing is null then
    raise exception 'CLOSING_NOT_FOUND: no such closing in this business'
      using errcode = 'P0002';
  end if;

  if v_closing.status <> 'CLOSED' then
    raise exception 'NOT_CLOSED: this version is not a closed day'
      using errcode = '22023';
  end if;

  if exists (select 1 from daily_closings where supersedes_id = p_closing_id) then
    raise exception 'ALREADY_SUPERSEDED: a later version of this day already exists'
      using errcode = '23505';
  end if;

  insert into daily_closings (
    business_id, scope, period_date, version, status,
    expected_cash_minor, counted_cash_minor, variance_minor,
    note, supersedes_id, closed_by
  ) values (
    p_business_id, v_closing.scope, v_closing.period_date, v_closing.version + 1, 'REOPENED',
    v_closing.expected_cash_minor, v_closing.counted_cash_minor, v_closing.variance_minor,
    p_reason, p_closing_id, v_actor
  )
  returning id into v_new_id;

  insert into audit_events (business_id, actor_user_id, action, reason, detail)
  values (p_business_id, v_actor, 'day.reopened', p_reason,
          jsonb_build_object('closing_id', p_closing_id, 'reopened_as', v_new_id));

  return jsonb_build_object('reopened_id', v_new_id, 'version', v_closing.version + 1);
end $$;

-- ------------------------------------------------------------------ Grants
revoke execute on function create_customer(uuid, text, text, boolean) from public;
revoke execute on function customer_balances(uuid) from public;
revoke execute on function post_baki_sale(uuid, bigint, uuid, uuid, text, timestamptz, timestamptz) from public;
revoke execute on function post_baki_collection(uuid, bigint, uuid, uuid, text, text, timestamptz, timestamptz) from public;
revoke execute on function closing_preview(uuid, date) from public;
revoke execute on function post_closing(uuid, bigint, uuid, date, text, text) from public;
revoke execute on function reopen_closing(uuid, uuid, text) from public;

grant execute on function create_customer(uuid, text, text, boolean) to authenticated;
grant execute on function customer_balances(uuid) to authenticated;
grant execute on function post_baki_sale(uuid, bigint, uuid, uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function post_baki_collection(uuid, bigint, uuid, uuid, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function closing_preview(uuid, date) to authenticated;
grant execute on function post_closing(uuid, bigint, uuid, date, text, text) to authenticated;
grant execute on function reopen_closing(uuid, uuid, text) to authenticated;
