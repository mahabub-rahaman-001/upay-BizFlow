-- Demo seed. Runs on `supabase db reset`. Synthetic data only - no real person, shop,
-- phone number or payment is represented here.
--
-- Two demo logins, both using the test OTP numbers in supabase/config.toml (code 123456):
--
--   01700000001  Karim Rahman   - owner of Karim Store (merchant, grocery)
--   01700000002  Rahim Uddin    - owner of Rahim Agent Point (agent)
--   01700000003  Shahana Akter  - staff at Karim Store, entry permission on
--
-- Everything below the businesses is posted through the real RPCs rather than inserted
-- into the ledger directly, so the demo data obeys the same role checks, idempotency keys
-- and double-entry rules as a live shop. If a posting rule is wrong, this seed fails.

-- ------------------------------------------------------------------ Demo users
-- Created with the phone numbers the test OTP answers, so signing in as them needs no
-- SMS provider. Passwords are not set: these accounts can only be reached by local OTP.
-- The token columns are set to '' rather than left NULL. Supabase Auth reads them as Go
-- strings and a NULL there makes every request for that user fail with "converting NULL to
-- string is unsupported" - a 500 that looks like a broken login rather than a bad fixture.
insert into auth.users (
  id, instance_id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
  email_change, phone_change, phone_change_token, reauthentication_token
) values
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','8801700000001', now(),
   '{"provider":"phone","providers":["phone"]}', '{"name":"Karim Rahman"}', now(), now(),
   '', '', '', '', '', '', '', ''),
  ('a0000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','8801700000002', now(),
   '{"provider":"phone","providers":["phone"]}', '{"name":"Rahim Uddin"}', now(), now(),
   '', '', '', '', '', '', '', ''),
  -- A staff member at the shop, to show the restricted view.
  ('a0000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','8801700000003', now(),
   '{"provider":"phone","providers":["phone"]}', '{"name":"Shahana Akter"}', now(), now(),
   '', '', '', '', '', '', '', '')
on conflict (id) do nothing;

-- ------------------------------------------------------------------ Businesses
insert into businesses (id, type, name, category, location_type, upay_account_ref, verified, settings)
values
  ('b0000000-0000-4000-8000-000000000001','MERCHANT','Karim Store','grocery','neighbourhood',
   'M-000123', true,
   -- Tk 100 tolerance on the drawer, Tk 2,000 before a pending payment blocks the closing.
   '{"closing_tolerance_minor": 10000, "closing_blocker_minor": 200000, "demo": "true"}'),
  ('b0000000-0000-4000-8000-000000000002','AGENT','Rahim Agent Point','agent','market',
   'A-000987', true,
   '{"closing_tolerance_minor": 10000, "closing_blocker_minor": 200000, "demo": "true"}')
on conflict (id) do nothing;

select seed_accounts('b0000000-0000-4000-8000-000000000001','MERCHANT');
select seed_accounts('b0000000-0000-4000-8000-000000000002','AGENT');

insert into memberships (user_id, business_id, role, permissions) values
  ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
   'merchant_owner','{}'),
  ('a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002',
   'agent_owner','{}'),
  -- Staff may add entries but, per docs/02, cannot reverse or close the day.
  ('a0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001',
   'staff','{"can_add_entries": true}')
on conflict do nothing;

-- ------------------------------------------------------------------ Opening balances
-- Posted as owner deposits against owner equity, the same entry create_business() writes.
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
  v_agent uuid := 'b0000000-0000-4000-8000-000000000002';
  v_txn uuid;
begin
  -- Shop opens with Tk 4,000 in the drawer and Tk 12,000 in the upay wallet.
  insert into transactions (business_id, kind, source, amount_minor, note,
                            actor_user_id, client_uuid, occurred_at)
  values (v_shop, 'OWNER_DEPOSIT', 'manual', 1600000, 'Opening balance',
          'a0000000-0000-4000-8000-000000000001', gen_random_uuid(),
          now() - interval '2 days')
  returning id into v_txn;

  perform _post_journal(v_shop, v_txn, jsonb_build_array(
    jsonb_build_object('code','1000','debit', 400000),
    jsonb_build_object('code','1010','debit', 1200000),
    jsonb_build_object('code','3000','credit', 1600000)
  ), 'Opening balance');

  -- Agent opens with Tk 25,000 cash and Tk 40,000 e-float.
  insert into transactions (business_id, kind, source, amount_minor, note,
                            actor_user_id, client_uuid, occurred_at)
  values (v_agent, 'OWNER_DEPOSIT', 'manual', 6500000, 'Opening balance',
          'a0000000-0000-4000-8000-000000000002', gen_random_uuid(),
          now() - interval '2 days')
  returning id into v_txn;

  perform _post_journal(v_agent, v_txn, jsonb_build_array(
    jsonb_build_object('code','1000','debit', 2500000),
    jsonb_build_object('code','1010','debit', 4000000),
    jsonb_build_object('code','3000','credit', 6500000)
  ), 'Opening balance');
end $$;

-- ------------------------------------------------------------------ Customers (baki book)
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  -- Act as the shop owner so the RPCs below run their real role checks.
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  perform create_customer(p_business_id => v_shop, p_name => 'Shefali Begum',
                          p_phone => '01811223344', p_consent_to_contact => true);
  perform create_customer(p_business_id => v_shop, p_name => 'Jashim Mia',
                          p_phone => '01922334455', p_consent_to_contact => true);
  perform create_customer(p_business_id => v_shop, p_name => 'Nasrin Sultana',
                          p_phone => '01733445566', p_consent_to_contact => false);
end $$;

-- ------------------------------------------------------------------ 90 days of history
-- The forecast model needs weeks of daily sales before it will say anything; with only
-- today's trades it abstains, and the home AI card stays empty. This block lays down a
-- realistic three months for the shop so the nightly job has something to learn from.
--
-- The shape is deliberate, not random: a weekly rhythm (Friday is the big day, the
-- weekend is quiet), a gentle upward trend, and a payday bump around the start of each
-- month. These are posted straight to the ledger as cash sales rather than through the
-- RPC, because 270 idempotency rows and role checks would make a reset slow for no gain;
-- the day-of-trading block below still exercises the real RPCs.
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
  v_owner uuid := 'a0000000-0000-4000-8000-000000000001';
  v_day date;
  v_dow int;
  v_base numeric;
  v_amount bigint;
  v_txn uuid;
  v_seed int;
begin
  -- 90 days ending the day before yesterday, so it sits behind the live trades below.
  for i in 2..91 loop
    v_day := ((now() at time zone 'Asia/Dhaka')::date) - i;
    v_dow := extract(dow from v_day);  -- 0 = Sunday ... 5 = Friday, 6 = Saturday

    -- Base daily sales in poisha, trending up a little over the three months.
    v_base := 450000 + (91 - i) * 1500;

    -- Weekly rhythm: Friday busiest, Saturday strong, Sunday slow.
    v_base := v_base * case v_dow
      when 5 then 1.6   -- Friday
      when 6 then 1.3   -- Saturday
      when 4 then 1.15  -- Thursday
      when 0 then 0.75  -- Sunday
      else 1.0 end;

    -- Payday bump in the first five days of the month.
    if extract(day from v_day) <= 5 then
      v_base := v_base * 1.25;
    end if;

    -- A little day-to-day noise, deterministic so a reset reproduces the same history.
    v_seed := (extract(doy from v_day)::int * 37) % 100;
    v_amount := round(v_base * (0.9 + v_seed / 500.0))::bigint;

    insert into transactions (business_id, kind, source, amount_minor, category,
                              actor_user_id, client_uuid, occurred_at)
    values (v_shop, 'CASH_SALE', 'manual', v_amount, 'grocery', v_owner,
            gen_random_uuid(), (v_day + time '13:00') at time zone 'Asia/Dhaka')
    returning id into v_txn;

    perform _post_journal(v_shop, v_txn, jsonb_build_array(
      jsonb_build_object('code','1000','debit', v_amount),
      jsonb_build_object('code','4000','credit', v_amount)
    ), 'historical sale');
  end loop;
end $$;

-- ------------------------------------------------------------------ A day of trading
-- Cash sales, expenses and baki, posted the way the app posts them.
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
  v_shefali uuid;
  v_jashim uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  select id into v_shefali from customers where business_id = v_shop and name = 'Shefali Begum';
  select id into v_jashim from customers where business_id = v_shop and name = 'Jashim Mia';

  -- Named arguments throughout: these RPCs take optional parameters in an order that is
  -- easy to get wrong positionally, and a seed that posts to the wrong account is worse
  -- than one that fails.

  -- Yesterday: a steady day over the counter.
  perform post_cash_sale(p_business_id => v_shop, p_amount_minor => 32000,
                         p_client_uuid => gen_random_uuid(), p_category => 'grocery',
                         p_note => 'chal, dal', p_occurred_at => now() - interval '1 day');
  perform post_cash_sale(p_business_id => v_shop, p_amount_minor => 12500,
                         p_client_uuid => gen_random_uuid(), p_category => 'drinks',
                         p_occurred_at => now() - interval '1 day');
  perform post_cash_sale(p_business_id => v_shop, p_amount_minor => 85000,
                         p_client_uuid => gen_random_uuid(), p_category => 'grocery',
                         p_note => 'tel, chini, atta',
                         p_occurred_at => now() - interval '1 day');
  perform post_expense(p_business_id => v_shop, p_amount_minor => 150000,
                       p_client_uuid => gen_random_uuid(), p_paid_from => 'wallet',
                       p_expense_type => 'supplier_purchase',
                       p_note => 'Rahman Traders - stock',
                       p_occurred_at => now() - interval '1 day');

  -- Shefali took rice and oil on credit; Jashim too, and paid part of it back.
  perform post_baki_sale(p_business_id => v_shop, p_amount_minor => 45000,
                         p_client_uuid => gen_random_uuid(), p_customer_id => v_shefali,
                         p_note => 'chal, tel',
                         p_occurred_at => now() - interval '1 day');
  perform post_baki_sale(p_business_id => v_shop, p_amount_minor => 28000,
                         p_client_uuid => gen_random_uuid(), p_customer_id => v_jashim,
                         p_note => 'shabji, dim',
                         p_occurred_at => now() - interval '1 day');
  perform post_baki_collection(p_business_id => v_shop, p_amount_minor => 15000,
                               p_client_uuid => gen_random_uuid(), p_customer_id => v_jashim,
                               p_received_in => 'cash', p_note => 'part payment',
                               p_occurred_at => now() - interval '12 hours');

  -- Today, so far.
  perform post_cash_sale(p_business_id => v_shop, p_amount_minor => 24000,
                         p_client_uuid => gen_random_uuid(), p_category => 'snacks',
                         p_occurred_at => now() - interval '4 hours');
  perform post_cash_sale(p_business_id => v_shop, p_amount_minor => 56000,
                         p_client_uuid => gen_random_uuid(), p_category => 'grocery',
                         p_occurred_at => now() - interval '2 hours');
  perform post_expense(p_business_id => v_shop, p_amount_minor => 30000,
                       p_client_uuid => gen_random_uuid(), p_paid_from => 'cash',
                       p_expense_type => 'transport', p_note => 'van bhara',
                       p_occurred_at => now() - interval '3 hours');
end $$;

-- ------------------------------------------------------------------ Staff's own entries
-- Posted as Shahana so the staff login has rows of its own. The RLS policy from 0001 lets
-- a staff member read only what they entered, so without this the staff demo is an empty
-- screen that looks like a bug rather than a permission boundary.
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

  perform post_cash_sale(p_business_id => v_shop, p_amount_minor => 18000,
                         p_client_uuid => gen_random_uuid(), p_category => 'snacks',
                         p_occurred_at => now() - interval '6 hours');
  perform post_cash_sale(p_business_id => v_shop, p_amount_minor => 9500,
                         p_client_uuid => gen_random_uuid(), p_category => 'drinks',
                         p_occurred_at => now() - interval '5 hours');
  -- This one has the wrong amount. The owner corrects it further down.
  perform post_cash_sale(p_business_id => v_shop, p_amount_minor => 75000,
                         p_client_uuid => gen_random_uuid(), p_category => 'grocery',
                         p_note => 'bhul taka likhechi',
                         p_occurred_at => now() - interval '90 minutes');
end $$;

-- ------------------------------------------------------------------ A correction
-- The product promise is that a mistake is never edited away: the wrong entry is reversed
-- and the right one posted beside it, and both stay visible (docs/06 section 5). Only an
-- owner may do this, which is why it is not in the staff block above.
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
  v_wrong uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  select id into v_wrong from transactions
   where business_id = v_shop and note = 'bhul taka likhechi';

  -- A reversal is a sensitive action: open a reauth window first (Phase D), as the app
  -- does after the owner confirms on the device.
  perform request_reauth();
  perform reverse_transaction(p_business_id => v_shop, p_transaction_id => v_wrong,
                              p_client_uuid => gen_random_uuid(),
                              p_reason => 'wrong amount entered by staff');

  -- The replacement, with the amount that was actually taken.
  perform post_cash_sale(p_business_id => v_shop, p_amount_minor => 57000,
                         p_client_uuid => gen_random_uuid(), p_category => 'grocery',
                         p_note => 'sothik taka',
                         p_occurred_at => now() - interval '85 minutes');
end $$;

-- ------------------------------------------------------------------ Owner takes money out
-- A record only: BizFlow never moves funds (docs/02 section 3).
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  perform post_owner_withdrawal(
    p_business_id => 'b0000000-0000-4000-8000-000000000001',
    p_amount_minor => 200000, p_client_uuid => gen_random_uuid(),
    p_paid_from => 'cash', p_note => 'barir kharach',
    p_occurred_at => now() - interval '7 hours');
end $$;

-- ------------------------------------------------------------------ Agent's other wallets
-- An agent serves customers on wallets other than upay; those have no feed, so the agent
-- records them by hand and they are marked manual rather than verified (docs/03 M7).
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

  perform post_manual_wallet(
    p_business_id => 'b0000000-0000-4000-8000-000000000002',
    p_amount_minor => 150000, p_client_uuid => gen_random_uuid(),
    p_wallet => 'bKash', p_note => 'cash out - onno wallet',
    p_occurred_at => now() - interval '5 hours');

  perform post_manual_wallet(
    p_business_id => 'b0000000-0000-4000-8000-000000000002',
    p_amount_minor => 80000, p_client_uuid => gen_random_uuid(),
    p_wallet => 'Nagad', p_note => 'cash out - onno wallet',
    p_occurred_at => now() - interval '2 hours');
end $$;

-- ------------------------------------------------------------------ QR payments
-- Through the same ingress the provider webhook uses, so these arrive as verified rows
-- with receipts, exactly like a real payment from any Bangla QR app.
do $$
begin
  -- Settled instantly: the money is already in the upay wallet.
  perform ingest_payment_event('upay', jsonb_build_object(
    'event_id','evt_seed_1', 'event_type','payment.succeeded',
    'provider_txn_id','UPY-SEED-0001', 'account_ref','M-000123',
    'amount_minor', 85000, 'currency','BDT', 'payer_app','bKash',
    'payer_token','seed-token-1', 'reference','INV-1048',
    'occurred_at', (now() - interval '5 hours')::text,
    'settlement', jsonb_build_object('status','settled')));

  perform ingest_payment_event('upay', jsonb_build_object(
    'event_id','evt_seed_2', 'event_type','payment.succeeded',
    'provider_txn_id','UPY-SEED-0002', 'account_ref','M-000123',
    'amount_minor', 42000, 'currency','BDT', 'payer_app','Nagad',
    'payer_token','seed-token-2',
    'occurred_at', (now() - interval '3 hours')::text,
    'settlement', jsonb_build_object('status','settled')));

  -- Still pending settlement, and above the blocker threshold: this is what makes the
  -- closing screen ask for a reason before the day can be closed.
  perform ingest_payment_event('upay', jsonb_build_object(
    'event_id','evt_seed_3', 'event_type','payment.succeeded',
    'provider_txn_id','UPY-SEED-0003', 'account_ref','M-000123',
    'amount_minor', 250000, 'currency','BDT', 'payer_app','Rocket',
    'payer_token','seed-token-3', 'reference','INV-1052',
    'occurred_at', (now() - interval '1 hour')::text,
    'settlement', jsonb_build_object('status','pending')));

  -- A small one that arrived pending and then settled: this is the pair that shows money
  -- moving out of 1020 Pending settlement into 1010 the wallet.
  perform ingest_payment_event('upay', jsonb_build_object(
    'event_id','evt_seed_7', 'event_type','payment.succeeded',
    'provider_txn_id','UPY-SEED-0004', 'account_ref','M-000123',
    'amount_minor', 60000, 'currency','BDT', 'payer_app','upay',
    'payer_token','seed-token-4',
    'occurred_at', (now() - interval '8 hours')::text,
    'settlement', jsonb_build_object('status','pending')));

  perform ingest_payment_event('upay', jsonb_build_object(
    'event_id','evt_seed_8', 'event_type','settlement.completed',
    'provider_txn_id','UPY-SEED-0004', 'account_ref','M-000123',
    'amount_minor', 60000, 'currency','BDT',
    'occurred_at', (now() - interval '7 hours')::text));

  -- Agent point: cash in, cash out and the commission on them.
  perform ingest_payment_event('upay', jsonb_build_object(
    'event_id','evt_seed_4', 'event_type','agent.cash_in',
    'provider_txn_id','UPY-SEED-1001', 'account_ref','A-000987',
    'amount_minor', 500000, 'currency','BDT', 'payer_token','agent-customer-1',
    'occurred_at', (now() - interval '6 hours')::text));

  perform ingest_payment_event('upay', jsonb_build_object(
    'event_id','evt_seed_5', 'event_type','agent.cash_out',
    'provider_txn_id','UPY-SEED-1002', 'account_ref','A-000987',
    'amount_minor', 300000, 'currency','BDT', 'payer_token','agent-customer-2',
    'occurred_at', (now() - interval '4 hours')::text));

  perform ingest_payment_event('upay', jsonb_build_object(
    'event_id','evt_seed_6', 'event_type','agent.commission',
    'provider_txn_id','UPY-SEED-1003', 'account_ref','A-000987',
    'amount_minor', 4500, 'currency','BDT',
    'occurred_at', (now() - interval '4 hours')::text));
end $$;

-- ------------------------------------------------------------------ Yesterday closed
-- One closed day in the history, so the books have something to compare against. The
-- drawer was Tk 3 short, which is the ordinary wrong-change case rather than a problem.
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
  v_yesterday date := ((now() - interval '1 day') at time zone 'Asia/Dhaka')::date;
  v_expected bigint;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  v_expected := (closing_preview(v_shop, v_yesterday) ->> 'expected_cash_minor')::bigint;

  -- An exception reason is always supplied so the seed closes cleanly on any run date: as
  -- the demo clock rolls past midnight a pending payment can fall inside yesterday's window
  -- and become a blocker, and a seed must never fail on the day it happens to run.
  perform post_closing(p_business_id => v_shop,
                       p_counted_cash_minor => v_expected - 300,
                       p_client_uuid => gen_random_uuid(),
                       p_period_date => v_yesterday,
                       p_note => 'bhul khuchra deowa hoyeche',
                       p_exception_reason => 'demo seed closing (pending items acknowledged)');
end $$;

-- ------------------------------------------------------------------ Demo forecast
-- A ready-made sales forecast so the home AI card is populated the moment the demo opens,
-- without waiting for the nightly ai-job or a running AI service. When the real pipeline
-- runs (POST /functions/v1/ai-job), its row for the same cutoff replaces this one via the
-- (business_id, capability, cutoff_date) unique key, so this is a seed, not a fixture that
-- fights the live model.
--
-- The figures follow the same weekly rhythm as the 90-day history above: a Friday peak and
-- a quiet weekend, with a p10/p50/p90 band that widens for days further out. They are
-- written straight to forecast_runs because that table is service-role only and has no
-- posting RPC - it holds model output, not money.
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
  v_cutoff date := (now() at time zone 'Asia/Dhaka')::date;
  v_days jsonb := '[]'::jsonb;
  v_day date;
  v_dow int;
  v_p50 bigint;
begin
  for i in 1..7 loop
    v_day := v_cutoff + i;
    v_dow := extract(dow from v_day);
    v_p50 := round(560000 * case v_dow
      when 5 then 1.6 when 6 then 1.3 when 4 then 1.15 when 0 then 0.75 else 1.0 end)::bigint;

    v_days := v_days || jsonb_build_object(
      'day', v_day,
      -- The band widens with the horizon: nearer days are tighter than the last.
      'p10_minor', round(v_p50 * (0.80 - i * 0.01))::bigint,
      'p50_minor', v_p50,
      'p90_minor', round(v_p50 * (1.18 + i * 0.015))::bigint
    );
  end loop;

  insert into forecast_runs (
    business_id, capability, cutoff_date, model_version, feature_version,
    confidence, abstained, days, advice_bn, advice_en, latency_ms
  ) values (
    v_shop, 'sales7d', v_cutoff, 'baseline-seasonal-0.1', 'v1',
    'medium', false, v_days,
    'আগামী ৭ দিনে বিক্রি ভালো থাকার কথা। শুক্রবার সবচেয়ে ব্যস্ত, সেদিন বেশি মাল রাখুন।',
    'Sales look steady for the next 7 days. Friday is busiest, so stock up for it.',
    0
  )
  on conflict (business_id, capability, cutoff_date) do nothing;
end $$;

-- ------------------------------------------------------------------ Suppliers & payables
-- Through the real RPCs, so the purchase postings (5000/2000) and the part payment land on
-- the books exactly as the app would make them.
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
  v_rahman uuid;
  v_payable uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  perform create_supplier(v_shop, 'Rahman Traders', '01911112222', 'grocery', 'weekly');
  perform create_supplier(v_shop, 'Dhaka Wholesale', '01822223333', 'grocery', 'monthly');

  select id into v_rahman from suppliers where business_id = v_shop and name = 'Rahman Traders';

  -- A confirmed bill due in two days, partly paid - the common mid-week state.
  select (create_payable(v_shop, v_rahman, 1500000,
            ((now() at time zone 'Asia/Dhaka')::date + 2), 'INV-9001') ->> 'payable_id')::uuid
    into v_payable;
  perform pay_payable(v_shop, v_payable, 500000, gen_random_uuid(), 'wallet');

  -- A second bill from the other supplier, due later, untouched.
  perform create_payable(v_shop,
    (select id from suppliers where business_id = v_shop and name = 'Dhaka Wholesale'),
    800000, ((now() at time zone 'Asia/Dhaka')::date + 6), 'INV-7742');
end $$;

-- ------------------------------------------------------------------ Demo refund + anomaly
-- One refund against a QR payment, and one AI anomaly flag, so the review queue shows both
-- kinds it can hold and the refund timeline has an entry.
do $$
declare
  v_shop uuid := 'b0000000-0000-4000-8000-000000000001';
  v_payment uuid;
  v_flagged uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  -- Refund Tk 100 on the first settled QR payment (INV-1048, Tk 850).
  select id into v_payment from transactions where reference = 'INV-1048';
  if v_payment is not null then
    perform post_refund(v_shop, v_payment, 10000, 'customer returned one item',
                        gen_random_uuid());
  end if;

  -- Flag the largest cash sale as unusual, as the nightly anomaly model would.
  select id into v_flagged from transactions
   where business_id = v_shop and kind = 'CASH_SALE'
   order by amount_minor desc limit 1;

  insert into ai_anomaly_flags (business_id, transaction_id, score, reason_codes, reason_bn,
                                model_version)
  values (v_shop, v_flagged, 0.82, array['amount_outlier'],
          array['স্বাভাবিকের চেয়ে অনেক বড় বিক্রি'], 'iforest-0.1.0');
end $$;

-- ------------------------------------------------------------------ Admin console demo
-- Three privileged logins for the web admin console (apps/mobile/app/admin). All are
-- demo_access = true, which lets them skip the MFA (aal2) gate locally - a real deployment
-- provisions these by hand with MFA enforced (docs/02 section 6, docs/09).
--
--   01700000004  upay_admin   (full portfolio, proposes flag changes)
--   01700000005  upay_admin   (second admin, approves flag changes - dual control)
--   01700000006  upay_support (case worker, grants case-scoped access)
insert into auth.users (
  id, instance_id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
  email_change, phone_change, phone_change_token, reauthentication_token
) values
  ('a0000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','8801700000004', now(),
   '{"provider":"phone","providers":["phone"]}', '{"name":"upay Admin"}', now(), now(),
   '', '', '', '', '', '', '', ''),
  ('a0000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','8801700000005', now(),
   '{"provider":"phone","providers":["phone"]}', '{"name":"upay Checker"}', now(), now(),
   '', '', '', '', '', '', '', ''),
  ('a0000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','8801700000006', now(),
   '{"provider":"phone","providers":["phone"]}', '{"name":"upay Support"}', now(), now(),
   '', '', '', '', '', '', '', '')
on conflict (id) do nothing;

insert into admin_accounts (user_id, role, demo_access) values
  ('a0000000-0000-4000-8000-000000000004','upay_admin', true),
  ('a0000000-0000-4000-8000-000000000005','upay_admin', true),
  ('a0000000-0000-4000-8000-000000000006','upay_support', true)
on conflict (user_id) do nothing;

-- One open support case against the demo shop, assigned to support, so the console has
-- something to grant access to and resolve.
insert into support_cases (business_id, assigned_to, subject, sla_key, due_at)
values ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000006',
        'Chargeback raised on INV-1048','chargeback', now() + interval '7 days')
on conflict do nothing;

-- ------------------------------------------------------------------ Demo agent forecast
-- A float24h forecast for the agent, so the agent's Today's Insights has a cash-demand card
-- from the first open. Same note as the merchant forecast: the nightly ai-job replaces it.
do $$
declare
  v_agent uuid := 'b0000000-0000-4000-8000-000000000002';
  v_cutoff date := (now() at time zone 'Asia/Dhaka')::date;
begin
  insert into forecast_runs (
    business_id, capability, cutoff_date, model_version, feature_version,
    confidence, abstained, days, advice_bn, advice_en, latency_ms
  ) values (
    v_agent, 'float24h', v_cutoff, 'baseline-seasonal-0.1', 'v1', 'medium', false,
    jsonb_build_array(
      jsonb_build_object('day', v_cutoff, 'p10_minor', 3000000, 'p50_minor', 4500000, 'p90_minor', 6000000)),
    'আজ বিকেল ৫টা-৮টায় cash-out চাহিদা বেশি হতে পারে। পর্যাপ্ত ফ্লোট রাখুন।',
    'Cash-out demand may peak between 5pm and 8pm today. Keep enough float.',
    0
  )
  on conflict (business_id, capability, cutoff_date) do nothing;
end $$;
