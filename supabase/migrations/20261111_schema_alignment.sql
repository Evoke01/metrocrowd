-- Align the live schema with what the web client reads/writes.
-- Found during an end-to-end check (2026-11-11): these columns/views were
-- missing, so news caching and the latest-reports view returned 400/404.
-- The client no longer depends on them, but adding them restores the
-- news cache and keeps the schema self-describing. Safe to re-run.

alter table public.crowd_reports
  add column if not exists session_id text,
  add column if not exists anon_id text;

create index if not exists crowd_reports_station_created_idx
  on public.crowd_reports (station_id, created_at desc);

alter table public.news_events
  add column if not exists name text,
  add column if not exists icon text,
  add column if not exists boost numeric,
  add column if not exists sev text,
  add column if not exists active boolean default false,
  add column if not exists affected jsonb default '[]'::jsonb,
  add column if not exists detail text,
  add column if not exists published_at timestamptz,
  add column if not exists fetched_at timestamptz default now(),
  add column if not exists expires_at timestamptz;

create or replace view public.station_latest_reports as
select distinct on (station_id)
  station_id, level, crowd_value, created_at
from public.crowd_reports
where created_at > now() - interval '2 hours'
order by station_id, created_at desc;

grant select on public.station_latest_reports to anon, authenticated;
