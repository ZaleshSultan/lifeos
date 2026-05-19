do $$
begin
  create type public.finance_account_type as enum (
    'cash',
    'checking',
    'savings',
    'credit',
    'investment',
    'loan',
    'other'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.finance_transaction_type as enum (
    'income',
    'expense',
    'transfer',
    'adjustment'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.finance_budget_period as enum (
    'weekly',
    'monthly',
    'quarterly',
    'yearly'
  );
exception
  when duplicate_object then null;
end;
$$;

create or replace function public.finance_period_start(input_date date, period public.finance_budget_period)
returns date
language sql
immutable
set search_path = ''
as $$
  select case period
    when 'weekly' then date_trunc('week', input_date)::date
    when 'monthly' then date_trunc('month', input_date)::date
    when 'quarterly' then date_trunc('quarter', input_date)::date
    when 'yearly' then date_trunc('year', input_date)::date
  end
$$;

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_type public.finance_account_type not null default 'checking',
  currency char(3) not null default 'USD',
  opening_balance numeric(14, 2) not null default 0,
  institution_name text,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_accounts_name_not_blank check (length(btrim(name)) > 0),
  constraint finance_accounts_currency_uppercase check (currency = upper(currency))
);

create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  transaction_type public.finance_transaction_type not null,
  parent_category_id uuid references public.finance_categories(id) on delete set null,
  color text,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_categories_name_not_blank check (length(btrim(name)) > 0),
  constraint finance_categories_not_own_parent check (
    parent_category_id is null
    or parent_category_id <> id
  )
);

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.finance_accounts(id) on delete cascade,
  transfer_account_id uuid references public.finance_accounts(id) on delete set null,
  category_id uuid references public.finance_categories(id) on delete set null,
  transaction_type public.finance_transaction_type not null,
  occurred_on date not null,
  posted_at timestamptz,
  amount numeric(14, 2) not null,
  currency char(3) not null default 'USD',
  merchant text,
  description text,
  external_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_transactions_amount_nonzero check (amount <> 0),
  constraint finance_transactions_currency_uppercase check (currency = upper(currency)),
  constraint finance_transactions_transfer_target check (
    transaction_type <> 'transfer'
    or transfer_account_id is not null
  ),
  constraint finance_transactions_not_same_transfer_account check (
    transfer_account_id is null
    or transfer_account_id <> account_id
  )
);

create table if not exists public.finance_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.finance_categories(id) on delete cascade,
  period public.finance_budget_period not null default 'monthly',
  period_start date not null,
  amount numeric(14, 2) not null,
  currency char(3) not null default 'USD',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_budgets_amount_nonnegative check (amount >= 0),
  constraint finance_budgets_currency_uppercase check (currency = upper(currency)),
  constraint finance_budgets_period_start_aligned check (
    period_start = public.finance_period_start(period_start, period)
  ),
  constraint finance_budgets_user_category_period_unique unique (
    user_id,
    category_id,
    period,
    period_start
  )
);

create table if not exists public.finance_recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.finance_accounts(id) on delete cascade,
  category_id uuid references public.finance_categories(id) on delete set null,
  transaction_type public.finance_transaction_type not null,
  amount numeric(14, 2) not null,
  currency char(3) not null default 'USD',
  cadence text not null,
  starts_on date not null,
  ends_on date,
  next_due_on date,
  merchant text,
  description text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_recurring_rules_amount_nonzero check (amount <> 0),
  constraint finance_recurring_rules_currency_uppercase check (currency = upper(currency)),
  constraint finance_recurring_rules_cadence_not_blank check (length(btrim(cadence)) > 0),
  constraint finance_recurring_rules_ends_after_starts check (
    ends_on is null
    or ends_on >= starts_on
  )
);

create index if not exists finance_accounts_user_id_type_idx
  on public.finance_accounts (user_id, account_type);

create index if not exists finance_accounts_user_id_archived_at_idx
  on public.finance_accounts (user_id, archived_at);

create index if not exists finance_categories_user_id_type_idx
  on public.finance_categories (user_id, transaction_type, name);

create index if not exists finance_categories_user_id_parent_idx
  on public.finance_categories (user_id, parent_category_id);

create index if not exists finance_transactions_user_id_occurred_on_idx
  on public.finance_transactions (user_id, occurred_on desc);

create index if not exists finance_transactions_user_id_account_occurred_on_idx
  on public.finance_transactions (user_id, account_id, occurred_on desc);

create index if not exists finance_transactions_user_id_category_occurred_on_idx
  on public.finance_transactions (user_id, category_id, occurred_on desc);

create index if not exists finance_transactions_user_id_external_ref_idx
  on public.finance_transactions (user_id, external_ref)
  where external_ref is not null;

create index if not exists finance_budgets_user_id_period_idx
  on public.finance_budgets (user_id, period, period_start desc);

create index if not exists finance_recurring_rules_user_id_active_next_due_idx
  on public.finance_recurring_rules (user_id, active, next_due_on);

alter table public.finance_accounts enable row level security;
alter table public.finance_accounts force row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_categories force row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_transactions force row level security;
alter table public.finance_budgets enable row level security;
alter table public.finance_budgets force row level security;
alter table public.finance_recurring_rules enable row level security;
alter table public.finance_recurring_rules force row level security;

drop trigger if exists set_finance_accounts_updated_at on public.finance_accounts;
create trigger set_finance_accounts_updated_at
before update on public.finance_accounts
for each row execute function public.set_updated_at();

drop trigger if exists set_finance_categories_updated_at on public.finance_categories;
create trigger set_finance_categories_updated_at
before update on public.finance_categories
for each row execute function public.set_updated_at();

drop trigger if exists set_finance_transactions_updated_at on public.finance_transactions;
create trigger set_finance_transactions_updated_at
before update on public.finance_transactions
for each row execute function public.set_updated_at();

drop trigger if exists set_finance_budgets_updated_at on public.finance_budgets;
create trigger set_finance_budgets_updated_at
before update on public.finance_budgets
for each row execute function public.set_updated_at();

drop trigger if exists set_finance_recurring_rules_updated_at on public.finance_recurring_rules;
create trigger set_finance_recurring_rules_updated_at
before update on public.finance_recurring_rules
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_accounts'
      and policyname = 'finance_accounts_owner_access'
  ) then
    create policy finance_accounts_owner_access
      on public.finance_accounts
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_categories'
      and policyname = 'finance_categories_owner_access'
  ) then
    create policy finance_categories_owner_access
      on public.finance_categories
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_transactions'
      and policyname = 'finance_transactions_owner_access'
  ) then
    create policy finance_transactions_owner_access
      on public.finance_transactions
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_budgets'
      and policyname = 'finance_budgets_owner_access'
  ) then
    create policy finance_budgets_owner_access
      on public.finance_budgets
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_recurring_rules'
      and policyname = 'finance_recurring_rules_owner_access'
  ) then
    create policy finance_recurring_rules_owner_access
      on public.finance_recurring_rules
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
