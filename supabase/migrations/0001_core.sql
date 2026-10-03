-- BizFlow core schema: tenancy, accounts, append-only double-entry ledger, RLS.
-- Money is integer poisha (bigint). Financial tables are append-only.
-- See docs/06-data-model-and-ledger.md for the full design.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ Tenancy
create type business_type as enum ('MERCHANT', 'AGENT');
create type member_role as enum ('merchant_owner','agent_owner','staff','manager','auditor');

create table businesses (
  id uuid primary key default gen_random_uuid(),
  type business_type not null,
  name text not null,
  category text not null,
  location_type text,
  upay_account_ref text unique,
  verified boolean not null default false,
  status text not null default 'active' check (status in ('active','restricted','closed')),
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  role member_role not null,
  permissions jsonb not null default '{}',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

-- ------------------------------------------------------------------ Accounts (chart of accounts)
create table accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  unique (business_id, code)
);

-- ------------------------------------------------------------------ Payment events (idempotent ingress)
create table payment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  provider text not null,
  provider_txn_id text not null,
  event_type text not null,
  amount_minor bigint not null check (amount_minor > 0),
  payer_app text,
  payer_hash text,
  reference text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload_hash text not null,
  unique (provider, provider_txn_id, event_type)
);

-- ------------------------------------------------------------------ Transactions
create type txn_kind as enum (
  'QR_PAYMENT','CASH_SALE','BAKI_SALE','BAKI_COLLECTION','EXPENSE',
  'SUPPLIER_PAYMENT','REFUND','OWNER_WITHDRAWAL','OWNER_DEPOSIT',
  'AGENT_CASH_IN','AGENT_CASH_OUT','AGENT_SEND_MONEY','AGENT_COMMISSION',
  'MANUAL_WALLET','CLOSING_VARIANCE','REVERSAL');

create table transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  kind txn_kind not null,
  source text not null check (source in ('verified','manual')),
  wallet text,
  amount_minor bigint not null check (amount_minor > 0),
  payment_event_id uuid references payment_events(id),
  category text,
  note text,
  reference text,
  customer_id uuid,
  actor_user_id uuid not null,
  client_uuid uuid,
  reverses_txn_id uuid references transactions(id),
  occurred_at timestamptz not null,
  device_time timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, client_uuid)
);

-- ------------------------------------------------------------------ Double-entry journal
create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  transaction_id uuid not null references transactions(id),
  posted_at timestamptz not null default now(),
  memo text
);

create table journal_lines (
  id bigserial primary key,
  entry_id uuid not null references journal_entries(id),
  business_id uuid not null,
  account_id uuid not null references accounts(id),
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  check ((debit_minor = 0) <> (credit_minor = 0))  -- exactly one side non-zero
);

-- Deferred constraint trigger: each journal entry must balance (sum debit = sum credit).
create or replace function assert_entry_balanced() returns trigger
language plpgsql as $$
declare
  d bigint;
  c bigint;
begin
  select coalesce(sum(debit_minor),0), coalesce(sum(credit_minor),0)
    into d, c
  from journal_lines where entry_id = new.entry_id;
  if d <> c then
    raise exception 'Journal entry % is not balanced: debit=% credit=%', new.entry_id, d, c;
  end if;
  return null;
end $$;

create constraint trigger trg_entry_balanced
  after insert on journal_lines
  deferrable initially deferred
  for each row execute function assert_entry_balanced();

-- Append-only guard: block UPDATE/DELETE on financial tables.
create or replace function block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Financial rows are append-only. Use a reversal, not UPDATE/DELETE.';
end $$;

create trigger trg_txn_append_only
  before update or delete on transactions
  for each row execute function block_mutation();
create trigger trg_journal_append_only
  before update or delete on journal_lines
  for each row execute function block_mutation();
create trigger trg_jentry_append_only
  before update or delete on journal_entries
  for each row execute function block_mutation();
create trigger trg_event_append_only
  before update or delete on payment_events
  for each row execute function block_mutation();

-- ------------------------------------------------------------------ Helpers for RLS
create or replace function is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                 where user_id = auth.uid() and business_id = b and status = 'active');
$$;

create or replace function has_role(b uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                 where user_id = auth.uid() and business_id = b
                   and status = 'active' and role = any(roles));
$$;

-- ------------------------------------------------------------------ RLS
alter table businesses enable row level security;
alter table memberships enable row level security;
alter table accounts enable row level security;
alter table transactions enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
alter table payment_events enable row level security;

create policy biz_read on businesses for select using (is_member(id));
create policy mem_self on memberships for select using (user_id = auth.uid());
create policy acct_read on accounts for select using (is_member(business_id));

-- Owners/managers see all business rows; staff see only their own.
create policy txn_owner_read on transactions for select
  using (has_role(business_id, array['merchant_owner','agent_owner','manager']::member_role[]));
create policy txn_staff_read on transactions for select
  using (has_role(business_id, array['staff']::member_role[]) and actor_user_id = auth.uid());

create policy je_read on journal_entries for select using (is_member(business_id));
create policy jl_read on journal_lines for select using (is_member(business_id));
create policy pe_read on payment_events for select using (is_member(business_id));

-- No direct writes from clients: all posting happens through SECURITY DEFINER RPCs (P1 next).
revoke insert, update, delete on transactions from authenticated;
revoke insert, update, delete on journal_entries from authenticated;
revoke insert, update, delete on journal_lines from authenticated;
revoke insert, update, delete on payment_events from authenticated;

-- ------------------------------------------------------------------ Chart of accounts seeding
create or replace function seed_accounts(b uuid, btype business_type) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into accounts (business_id, code, name, type) values
    (b,'1000','Cash drawer','asset'),
    (b,'1010', case when btype='AGENT' then 'upay e-float' else 'upay wallet' end,'asset'),
    (b,'1020','Pending settlement','asset'),
    (b,'1030','Other wallets (manual)','asset'),
    (b,'1100','Baki receivable','asset'),
    (b,'2000','Supplier payable','liability'),
    (b,'2100','Refund/dispute hold','liability'),
    (b,'3000','Owner equity / drawings','equity'),
    (b,'4000','Sales','income'),
    (b,'4010','Sales returns and discounts','income'),
    (b,'4200','Commission income','income'),
    (b,'5000','Supplier purchases','expense'),
    (b,'5100','Operating expenses','expense'),
    (b,'9000','Cash over/short','expense');
end $$;

-- ------------------------------------------------------------------ Balance view (derived, never stored as truth)
create view v_account_balances as
  select l.business_id, a.code, a.name, a.type,
         sum(l.debit_minor) - sum(l.credit_minor) as balance_minor
  from journal_lines l join accounts a on a.id = l.account_id
  group by 1,2,3,4;
