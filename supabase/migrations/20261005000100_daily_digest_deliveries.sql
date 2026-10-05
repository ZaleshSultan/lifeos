create table if not exists public.daily_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  telegram_chat_id bigint not null,
  status text not null default 'sending',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_digest_deliveries_status_allowed check (status in ('sending', 'sent')),
  constraint daily_digest_deliveries_user_date_unique unique (user_id, local_date)
);

create index if not exists daily_digest_deliveries_local_date_idx
  on public.daily_digest_deliveries (local_date desc);

alter table public.daily_digest_deliveries enable row level security;
alter table public.daily_digest_deliveries force row level security;

drop trigger if exists set_daily_digest_deliveries_updated_at on public.daily_digest_deliveries;
create trigger set_daily_digest_deliveries_updated_at
before update on public.daily_digest_deliveries
for each row execute function public.set_updated_at();

-- No authenticated-client policy is intentional. The worker uses the Supabase
-- service role and the table is not exposed to the Telegram Mini App.
