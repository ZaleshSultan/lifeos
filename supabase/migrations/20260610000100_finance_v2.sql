-- Finance v2 migration
-- Extends finance layer with budgets, tags, currencies, reimbursements, receipts
-- All changes are additive and idempotent

-- ---------------------------------------------------------------------------
-- 1. Extend finance_budget_period enum with 'custom'
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'custom'
      and enumtypid = 'public.finance_budget_period'::regtype
  ) then
    alter type public.finance_budget_period add value 'custom';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Extend finance_budgets table
-- ---------------------------------------------------------------------------

alter table public.finance_budgets
  add column if not exists name text,
  add column if not exists archived_at timestamptz,
  add column if not exists is_active boolean not null default true;

-- ---------------------------------------------------------------------------
-- 3. Extend finance_transactions table
-- ---------------------------------------------------------------------------

alter table public.finance_transactions
  add column if not exists tags text[] not null default '{}',
  add column if not exists receipt_id uuid;

-- ---------------------------------------------------------------------------
-- 4. Extend finance_accounts with is_default
-- ---------------------------------------------------------------------------

alter table public.finance_accounts
  add column if not exists is_default boolean not null default false;

-- Mark existing "Основной" accounts as default
update public.finance_accounts
set is_default = true
where (metadata->>'is_default')::boolean = true
  and is_default = false;

-- ---------------------------------------------------------------------------
-- 5. Finance Tags
-- ---------------------------------------------------------------------------

create table if not exists public.finance_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_tags_name_not_blank check (length(btrim(name)) > 0),
  constraint finance_tags_user_name_unique unique (user_id, name)
);

create index if not exists finance_tags_user_id_idx
  on public.finance_tags (user_id);

alter table public.finance_tags enable row level security;
alter table public.finance_tags force row level security;

drop trigger if exists set_finance_tags_updated_at on public.finance_tags;
create trigger set_finance_tags_updated_at
before update on public.finance_tags
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_tags'
      and policyname = 'finance_tags_owner_access'
  ) then
    create policy finance_tags_owner_access
      on public.finance_tags
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Finance Transaction Tags junction
-- ---------------------------------------------------------------------------

create table if not exists public.finance_transaction_tags (
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  tag_id uuid not null references public.finance_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (transaction_id, tag_id)
);

create index if not exists finance_transaction_tags_tag_id_idx
  on public.finance_transaction_tags (tag_id);

alter table public.finance_transaction_tags enable row level security;
alter table public.finance_transaction_tags force row level security;

-- RLS via join to transaction owner
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_transaction_tags'
      and policyname = 'finance_transaction_tags_owner_access'
  ) then
    create policy finance_transaction_tags_owner_access
      on public.finance_transaction_tags
      for all
      to authenticated
      using (
        exists (
          select 1 from public.finance_transactions t
          where t.id = transaction_id
            and public.lifeos_is_owner(t.user_id)
        )
      )
      with check (
        exists (
          select 1 from public.finance_transactions t
          where t.id = transaction_id
            and public.lifeos_is_owner(t.user_id)
        )
      );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Currencies reference table
-- ---------------------------------------------------------------------------

create table if not exists public.finance_currencies (
  code char(3) primary key,
  name text not null,
  symbol text not null,
  decimal_places smallint not null default 2,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed currencies
insert into public.finance_currencies (code, name, symbol, decimal_places)
values
  ('KZT', 'Казахстанский тенге', '₸', 2),
  ('USD', 'Доллар США', '$', 2),
  ('EUR', 'Евро', '€', 2),
  ('RUB', 'Российский рубль', '₽', 2)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Exchange rates
-- ---------------------------------------------------------------------------

create table if not exists public.finance_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency char(3) not null references public.finance_currencies(code),
  to_currency char(3) not null references public.finance_currencies(code),
  rate numeric(18, 8) not null,
  rate_date date not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint finance_exchange_rates_positive check (rate > 0),
  constraint finance_exchange_rates_different check (from_currency <> to_currency),
  constraint finance_exchange_rates_unique unique (from_currency, to_currency, rate_date)
);

create index if not exists finance_exchange_rates_date_idx
  on public.finance_exchange_rates (from_currency, to_currency, rate_date desc);

-- No RLS on currencies/rates — they are global reference data

-- ---------------------------------------------------------------------------
-- 9. Reimbursements
-- ---------------------------------------------------------------------------

create table if not exists public.finance_reimbursements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  original_amount numeric(14, 2) not null,
  reimbursed_amount numeric(14, 2) not null default 0,
  remaining numeric(14, 2) generated always as (original_amount - reimbursed_amount) stored,
  currency char(3) not null default 'KZT',
  status text not null default 'pending',
  reimbursed_by text,
  notes text,
  reimbursed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_reimbursements_original_positive check (original_amount > 0),
  constraint finance_reimbursements_reimbursed_nonnegative check (reimbursed_amount >= 0),
  constraint finance_reimbursements_not_over check (reimbursed_amount <= original_amount),
  constraint finance_reimbursements_status_valid check (
    status in ('pending', 'partial', 'completed', 'cancelled')
  ),
  constraint finance_reimbursements_currency_uppercase check (currency = upper(currency))
);

create index if not exists finance_reimbursements_user_id_idx
  on public.finance_reimbursements (user_id, status);

create index if not exists finance_reimbursements_transaction_id_idx
  on public.finance_reimbursements (transaction_id);

alter table public.finance_reimbursements enable row level security;
alter table public.finance_reimbursements force row level security;

drop trigger if exists set_finance_reimbursements_updated_at on public.finance_reimbursements;
create trigger set_finance_reimbursements_updated_at
before update on public.finance_reimbursements
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_reimbursements'
      and policyname = 'finance_reimbursements_owner_access'
  ) then
    create policy finance_reimbursements_owner_access
      on public.finance_reimbursements
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Receipts
-- ---------------------------------------------------------------------------

create table if not exists public.finance_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  file_name text,
  mime_type text,
  ocr_json jsonb not null default '{}'::jsonb,
  parsed_json jsonb not null default '{}'::jsonb,
  status text not null default 'uploaded',
  transaction_id uuid references public.finance_transactions(id) on delete set null,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_receipts_status_valid check (
    status in ('uploaded', 'processing', 'parsed', 'linked', 'failed')
  ),
  constraint finance_receipts_storage_path_not_blank check (length(btrim(storage_path)) > 0)
);

create index if not exists finance_receipts_user_id_idx
  on public.finance_receipts (user_id, status);

create index if not exists finance_receipts_transaction_id_idx
  on public.finance_receipts (transaction_id)
  where transaction_id is not null;

alter table public.finance_receipts enable row level security;
alter table public.finance_receipts force row level security;

drop trigger if exists set_finance_receipts_updated_at on public.finance_receipts;
create trigger set_finance_receipts_updated_at
before update on public.finance_receipts
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'finance_receipts'
      and policyname = 'finance_receipts_owner_access'
  ) then
    create policy finance_receipts_owner_access
      on public.finance_receipts
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. FK from transactions.receipt_id → receipts
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'finance_transactions_receipt_id_fkey'
      and conrelid = 'public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_receipt_id_fkey
      foreign key (receipt_id) references public.finance_receipts(id) on delete set null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Default tags seed for existing users
-- ---------------------------------------------------------------------------

with default_tags(name, color) as (
  values
    ('work', '#3B82F6'),
    ('family', '#EC4899'),
    ('study', '#8B5CF6'),
    ('travel', '#F59E0B')
)
insert into public.finance_tags (user_id, name, color)
select users.id, tags.name, tags.color
from auth.users as users
cross join default_tags as tags
where not exists (
  select 1
  from public.finance_tags as existing
  where existing.user_id = users.id
    and existing.name = tags.name
);
