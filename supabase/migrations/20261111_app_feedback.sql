-- App ratings and bug reports from users (signed in or guests).
-- Written and read only by the API with the server-side key. Safe to re-run.

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('rating', 'bug', 'idea')),
  rating smallint check (rating between 1 and 5),
  message text check (length(message) <= 2000),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  page text,
  device text,
  app_version text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'dismissed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'rating' or rating is not null),
  check (kind = 'rating' or length(coalesce(message, '')) >= 3)
);

create index if not exists app_feedback_created_idx on public.app_feedback (created_at desc);
create index if not exists app_feedback_kind_status_idx on public.app_feedback (kind, status);

-- No policies: browsers cannot read or write this table directly.
alter table public.app_feedback enable row level security;
