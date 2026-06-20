-- Finance SSOT integration.
-- Additive/idempotent extension of the existing finance layer.

create or replace function public.finance_period_start(
  input_date date,
  period public.finance_budget_period
)
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
    when 'custom' then input_date
  end
$$;

create or replace function public.finance_period_end(
  input_date date,
  period public.finance_budget_period,
  custom_end date default null
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case period
    when 'weekly' then input_date + 6
    when 'monthly' then (date_trunc('month', input_date)::date + interval '1 month - 1 day')::date
    when 'quarterly' then (date_trunc('quarter', input_date)::date + interval '3 months - 1 day')::date
    when 'yearly' then (date_trunc('year', input_date)::date + interval '1 year - 1 day')::date
    when 'custom' then coalesce(custom_end, input_date)
  end
$$;

alter table public.finance_budgets
  add column if not exists period_end date;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'finance_budgets_period_start_aligned'
      and conrelid = 'public.finance_budgets'::regclass
  ) then
    alter table public.finance_budgets
      drop constraint finance_budgets_period_start_aligned;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_budgets_period_start_aligned'
      and conrelid = 'public.finance_budgets'::regclass
  ) then
    alter table public.finance_budgets
      add constraint finance_budgets_period_start_aligned
      check (
        period = 'custom'::public.finance_budget_period
        or period_start = public.finance_period_start(period_start, period)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_budgets_period_end_valid'
      and conrelid = 'public.finance_budgets'::regclass
  ) then
    alter table public.finance_budgets
      add constraint finance_budgets_period_end_valid
      check (
        period_end is null
        or period_end >= period_start
      );
  end if;
end;
$$;

alter table public.finance_transactions
  add column if not exists base_amount numeric(14, 2),
  add column if not exists base_currency char(3) not null default 'KZT',
  add column if not exists exchange_rate numeric(18, 8),
  add column if not exists exchange_rate_date date;

update public.finance_transactions
set
  base_currency = coalesce(base_currency, 'KZT'),
  base_amount = coalesce(base_amount, amount),
  exchange_rate = coalesce(exchange_rate, 1),
  exchange_rate_date = coalesce(exchange_rate_date, occurred_on)
where currency = 'KZT'
  and (base_amount is null or exchange_rate is null or exchange_rate_date is null);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_transactions_base_currency_uppercase'
      and conrelid = 'public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_base_currency_uppercase
      check (base_currency = upper(base_currency));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_transactions_exchange_rate_positive'
      and conrelid = 'public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_exchange_rate_positive
      check (exchange_rate is null or exchange_rate > 0);
  end if;
end;
$$;

create table if not exists public.finance_budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  budget_id uuid not null references public.finance_budgets(id) on delete cascade,
  category_id uuid not null references public.finance_categories(id) on delete cascade,
  limit_amount numeric(14, 2) not null,
  currency char(3) not null default 'KZT',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_budget_categories_limit_nonnegative check (limit_amount >= 0),
  constraint finance_budget_categories_currency_uppercase check (currency = upper(currency)),
  constraint finance_budget_categories_budget_category_unique unique (budget_id, category_id)
);

create index if not exists finance_budget_categories_user_budget_idx
  on public.finance_budget_categories (user_id, budget_id);

create index if not exists finance_budget_categories_user_category_idx
  on public.finance_budget_categories (user_id, category_id);

alter table public.finance_budget_categories enable row level security;
alter table public.finance_budget_categories force row level security;

drop trigger if exists set_finance_budget_categories_updated_at
  on public.finance_budget_categories;
create trigger set_finance_budget_categories_updated_at
before update on public.finance_budget_categories
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_budget_categories'
      and policyname = 'finance_budget_categories_owner_access'
  ) then
    create policy finance_budget_categories_owner_access
      on public.finance_budget_categories
      for all
      to authenticated
      using (
        public.lifeos_is_owner(user_id)
        and exists (
          select 1
          from public.finance_budgets b
          where b.id = budget_id
            and b.user_id = finance_budget_categories.user_id
        )
        and exists (
          select 1
          from public.finance_categories c
          where c.id = category_id
            and c.user_id = finance_budget_categories.user_id
        )
      )
      with check (
        public.lifeos_is_owner(user_id)
        and exists (
          select 1
          from public.finance_budgets b
          where b.id = budget_id
            and b.user_id = finance_budget_categories.user_id
        )
        and exists (
          select 1
          from public.finance_categories c
          where c.id = category_id
            and c.user_id = finance_budget_categories.user_id
        )
      );
  end if;
end;
$$;

insert into public.finance_budget_categories (
  user_id,
  budget_id,
  category_id,
  limit_amount,
  currency,
  metadata
)
select
  budget.user_id,
  budget.id,
  budget.category_id,
  budget.amount,
  budget.currency,
  jsonb_build_object('backfilled_from_budget_category_id', true)
from public.finance_budgets budget
where budget.category_id is not null
  and not exists (
    select 1
    from public.finance_budget_categories category
    where category.budget_id = budget.id
      and category.category_id = budget.category_id
  );

create table if not exists public.finance_receipt_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_id uuid not null references public.finance_receipts(id) on delete cascade,
  name text not null,
  quantity numeric(12, 3) not null default 1,
  unit_price numeric(14, 2),
  total_amount numeric(14, 2),
  currency char(3) not null default 'KZT',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint finance_receipt_items_name_not_blank check (length(btrim(name)) > 0),
  constraint finance_receipt_items_quantity_positive check (quantity > 0),
  constraint finance_receipt_items_currency_uppercase check (currency = upper(currency))
);

create index if not exists finance_receipt_items_user_receipt_idx
  on public.finance_receipt_items (user_id, receipt_id);

alter table public.finance_receipt_items enable row level security;
alter table public.finance_receipt_items force row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_receipt_items'
      and policyname = 'finance_receipt_items_owner_access'
  ) then
    create policy finance_receipt_items_owner_access
      on public.finance_receipt_items
      for all
      to authenticated
      using (
        public.lifeos_is_owner(user_id)
        and exists (
          select 1
          from public.finance_receipts receipt
          where receipt.id = receipt_id
            and receipt.user_id = finance_receipt_items.user_id
        )
      )
      with check (
        public.lifeos_is_owner(user_id)
        and exists (
          select 1
          from public.finance_receipts receipt
          where receipt.id = receipt_id
            and receipt.user_id = finance_receipt_items.user_id
        )
      );
  end if;
end;
$$;

alter table public.finance_receipts
  add column if not exists ocr_text text,
  add column if not exists openrouter_model text,
  add column if not exists processed_at timestamptz;

create table if not exists public.finance_ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null,
  prompt text not null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  model text,
  status text not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_ai_analysis_runs_request_type_valid check (
    request_type in (
      'categorization',
      'budget_analysis',
      'anomaly_detection',
      'forecast',
      'recommendation',
      'habit_analysis',
      'assistant_query',
      'receipt_parse'
    )
  ),
  constraint finance_ai_analysis_runs_status_valid check (
    status in ('pending', 'completed', 'failed')
  )
);

create index if not exists finance_ai_analysis_runs_user_created_idx
  on public.finance_ai_analysis_runs (user_id, created_at desc);

alter table public.finance_ai_analysis_runs enable row level security;
alter table public.finance_ai_analysis_runs force row level security;

drop trigger if exists set_finance_ai_analysis_runs_updated_at
  on public.finance_ai_analysis_runs;
create trigger set_finance_ai_analysis_runs_updated_at
before update on public.finance_ai_analysis_runs
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_ai_analysis_runs'
      and policyname = 'finance_ai_analysis_runs_owner_access'
  ) then
    create policy finance_ai_analysis_runs_owner_access
      on public.finance_ai_analysis_runs
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

insert into public.finance_currencies (code, name, symbol, decimal_places)
values
  ('KZT', 'Kazakhstani tenge', 'KZT', 2),
  ('USD', 'US dollar', '$', 2),
  ('EUR', 'Euro', 'EUR', 2),
  ('RUB', 'Russian ruble', 'RUB', 2)
on conflict (code) do update
set
  name = excluded.name,
  symbol = excluded.symbol,
  decimal_places = excluded.decimal_places,
  is_active = true;

with standard_categories(name, transaction_type, sort_order, color) as (
  values
    ('Food', 'expense'::public.finance_transaction_type, 10, '#22c55e'),
    ('Transport', 'expense'::public.finance_transaction_type, 20, '#38bdf8'),
    ('Housing', 'expense'::public.finance_transaction_type, 30, '#f59e0b'),
    ('Education', 'expense'::public.finance_transaction_type, 40, '#8b5cf6'),
    ('Entertainment', 'expense'::public.finance_transaction_type, 50, '#ec4899'),
    ('Health', 'expense'::public.finance_transaction_type, 60, '#ef4444'),
    ('Shopping', 'expense'::public.finance_transaction_type, 70, '#06b6d4'),
    ('Other', 'expense'::public.finance_transaction_type, 80, '#a1a1aa'),
    ('Income', 'income'::public.finance_transaction_type, 90, '#10b981')
)
insert into public.finance_categories (
  user_id,
  name,
  transaction_type,
  color,
  metadata
)
select
  users.id,
  categories.name,
  categories.transaction_type,
  categories.color,
  jsonb_build_object(
    'is_default',
    true,
    'default_key',
    lower(categories.name),
    'sort_order',
    categories.sort_order
  )
from auth.users users
cross join standard_categories categories
where not exists (
  select 1
  from public.finance_categories existing
  where existing.user_id = users.id
    and lower(existing.name) = lower(categories.name)
    and existing.transaction_type = categories.transaction_type
    and existing.archived_at is null
);

create or replace view public.finance_budget_category_status
with (security_invoker = true)
as
select
  category.id,
  category.user_id,
  category.budget_id,
  category.category_id,
  finance_category.name as category_name,
  budget.name as budget_name,
  budget.period,
  budget.period_start,
  public.finance_period_end(
    budget.period_start,
    budget.period,
    budget.period_end
  ) as period_end,
  category.limit_amount,
  coalesce(sum(transaction.base_amount), 0)::numeric(14, 2) as spent_amount,
  (category.limit_amount - coalesce(sum(transaction.base_amount), 0))::numeric(14, 2) as remaining_amount,
  case
    when category.limit_amount > 0 then
      round((coalesce(sum(transaction.base_amount), 0) / category.limit_amount) * 100, 2)
    when coalesce(sum(transaction.base_amount), 0) > 0 then 100
    else 0
  end as percent_used,
  coalesce(sum(transaction.base_amount), 0) > category.limit_amount as overspent,
  category.currency
from public.finance_budget_categories category
join public.finance_budgets budget
  on budget.id = category.budget_id
join public.finance_categories finance_category
  on finance_category.id = category.category_id
left join public.finance_transactions transaction
  on transaction.user_id = category.user_id
  and transaction.category_id = category.category_id
  and transaction.transaction_type = 'expense'::public.finance_transaction_type
  and transaction.status = 'confirmed'
  and transaction.occurred_on >= budget.period_start
  and transaction.occurred_on <= public.finance_period_end(
    budget.period_start,
    budget.period,
    budget.period_end
  )
where budget.archived_at is null
group by
  category.id,
  finance_category.name,
  budget.name,
  budget.period,
  budget.period_start,
  budget.period_end;
