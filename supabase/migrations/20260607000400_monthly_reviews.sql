create table if not exists public.monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month text not null,
  status text not null default 'draft',
  report_title text,
  report_markdown text not null,
  ai_model text,
  ai_input_json jsonb not null default '{}'::jsonb,
  ai_output_json jsonb not null default '{}'::jsonb,
  stats_json jsonb not null default '{}'::jsonb,
  obsidian_path text,
  generated_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_reviews_period_month_format check (
    period_month ~ '^\d{4}-\d{2}$'
  ),
  constraint monthly_reviews_status_valid check (
    status in ('draft', 'generated', 'failed')
  ),
  constraint monthly_reviews_user_period_unique unique (user_id, period_month)
);

create index if not exists monthly_reviews_user_period_idx
  on public.monthly_reviews (user_id, period_month desc);

create index if not exists monthly_reviews_status_idx
  on public.monthly_reviews (status);

alter table public.monthly_reviews enable row level security;
alter table public.monthly_reviews force row level security;

drop trigger if exists set_monthly_reviews_updated_at on public.monthly_reviews;
create trigger set_monthly_reviews_updated_at
before update on public.monthly_reviews
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'monthly_reviews'
      and policyname = 'monthly_reviews_owner_access'
  ) then
    create policy monthly_reviews_owner_access
      on public.monthly_reviews
      for all
      to authenticated
      using (public.lifeos_is_owner(user_id))
      with check (public.lifeos_is_owner(user_id));
  end if;
end;
$$;
