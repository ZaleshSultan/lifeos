alter table public.finance_accounts
  alter column currency set default 'KZT';

alter table public.finance_transactions
  alter column currency set default 'KZT';

alter table public.finance_budgets
  alter column currency set default 'KZT';

alter table public.finance_recurring_rules
  alter column currency set default 'KZT';

create table if not exists public.finance_ai_parse_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input_text text not null,
  parsed_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finance_transactions
  add column if not exists status text not null default 'confirmed',
  add column if not exists raw_text text,
  add column if not exists confidence numeric(4, 3),
  add column if not exists source text not null default 'manual',
  add column if not exists parse_run_id uuid references public.finance_ai_parse_runs(id) on delete set null,
  add column if not exists confirmed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

alter table public.finance_ai_parse_runs
  add column if not exists parser text not null default 'rules',
  add column if not exists confidence numeric(4, 3),
  add column if not exists transaction_id uuid references public.finance_transactions(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_transactions_status_valid'
      and conrelid = 'public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_status_valid
      check (status in ('draft', 'confirmed', 'cancelled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_transactions_confidence_valid'
      and conrelid = 'public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_confidence_valid
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_ai_parse_runs_confidence_valid'
      and conrelid = 'public.finance_ai_parse_runs'::regclass
  ) then
    alter table public.finance_ai_parse_runs
      add constraint finance_ai_parse_runs_confidence_valid
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;
end;
$$;

create index if not exists finance_transactions_user_status_occurred_idx
  on public.finance_transactions (user_id, status, occurred_on desc);

create index if not exists finance_ai_parse_runs_user_created_idx
  on public.finance_ai_parse_runs (user_id, created_at desc);

alter table public.finance_ai_parse_runs enable row level security;
alter table public.finance_ai_parse_runs force row level security;

drop trigger if exists set_finance_ai_parse_runs_updated_at on public.finance_ai_parse_runs;
create trigger set_finance_ai_parse_runs_updated_at
before update on public.finance_ai_parse_runs
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_ai_parse_runs'
      and policyname = 'finance_ai_parse_runs_owner_access'
  ) then
    create policy finance_ai_parse_runs_owner_access
      on public.finance_ai_parse_runs
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

insert into public.finance_accounts (
  user_id,
  name,
  account_type,
  currency,
  metadata
)
select
  users.id,
  'Основной',
  'cash'::public.finance_account_type,
  'KZT',
  '{"is_default": true}'::jsonb
from auth.users as users
where not exists (
  select 1
  from public.finance_accounts as accounts
  where accounts.user_id = users.id
    and accounts.archived_at is null
);

with default_categories(name, transaction_type, sort_order) as (
  values
    ('Еда', 'expense'::public.finance_transaction_type, 10),
    ('Транспорт', 'expense'::public.finance_transaction_type, 20),
    ('Учёба', 'expense'::public.finance_transaction_type, 30),
    ('Связь', 'expense'::public.finance_transaction_type, 40),
    ('Подписки', 'expense'::public.finance_transaction_type, 50),
    ('Здоровье', 'expense'::public.finance_transaction_type, 60),
    ('Одежда', 'expense'::public.finance_transaction_type, 70),
    ('Техника', 'expense'::public.finance_transaction_type, 80),
    ('Развлечения', 'expense'::public.finance_transaction_type, 90),
    ('Долги', 'expense'::public.finance_transaction_type, 100),
    ('Доход', 'income'::public.finance_transaction_type, 110),
    ('Другое', 'expense'::public.finance_transaction_type, 120)
)
insert into public.finance_categories (
  user_id,
  name,
  transaction_type,
  metadata
)
select
  users.id,
  categories.name,
  categories.transaction_type,
  jsonb_build_object('is_default', true, 'sort_order', categories.sort_order)
from auth.users as users
cross join default_categories as categories
where not exists (
  select 1
  from public.finance_categories as existing
  where existing.user_id = users.id
    and existing.name = categories.name
    and existing.transaction_type = categories.transaction_type
);
