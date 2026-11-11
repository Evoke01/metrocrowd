-- Referral and task rewards. Run once in the Supabase SQL editor.
-- Payouts are requests only; funds are sent manually outside MetroCrowd.

alter table public.trip_sessions
  add column if not exists path_station_ids jsonb not null default '[]'::jsonb;

create table if not exists public.reward_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  commute_points integer not null default 10 check (commute_points >= 0),
  referral_points integer not null default 50 check (referral_points >= 0),
  min_withdrawal_points integer not null default 1000 check (min_withdrawal_points > 0),
  rupees_per_1000_points numeric(10,2) not null default 100.00 check (rupees_per_1000_points > 0),
  updated_at timestamptz not null default now()
);

insert into public.reward_settings (singleton) values (true)
on conflict (singleton) do nothing;

create table if not exists public.reward_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  referral_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  balance_points bigint not null default 0 check (balance_points >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.reward_referrals (
  invitee_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referral_code text not null,
  claimed_at timestamptz not null default now(),
  qualified_at timestamptz,
  check (invitee_user_id <> referrer_user_id)
);

create table if not exists public.reward_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  points_delta bigint not null check (points_delta <> 0),
  reason text not null check (reason in ('commute', 'referral', 'payout', 'payout_refund', 'admin_adjustment')),
  reference_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reason, reference_id)
);

create index if not exists reward_ledger_user_created_idx
  on public.reward_ledger (user_id, created_at desc);

create table if not exists public.reward_payout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  points bigint not null check (points > 0),
  amount_paise bigint not null check (amount_paise > 0),
  upi_id text not null check (length(upi_id) between 3 and 100),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  admin_note text,
  payout_reference text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz
);

create index if not exists reward_payout_requests_status_created_idx
  on public.reward_payout_requests (status, created_at);

-- All reward writes go through the API using the server-side Supabase key.
alter table public.reward_settings enable row level security;
alter table public.reward_accounts enable row level security;
alter table public.reward_referrals enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.reward_payout_requests enable row level security;
revoke all on public.reward_settings, public.reward_accounts, public.reward_referrals,
  public.reward_ledger, public.reward_payout_requests from anon, authenticated;
grant all on public.reward_settings, public.reward_accounts, public.reward_referrals,
  public.reward_ledger, public.reward_payout_requests to service_role;
grant usage, select on sequence public.reward_ledger_id_seq to service_role;

create or replace function public.rewards_claim_referral(p_invitee uuid, p_code text)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare v_referrer uuid;
begin
  select user_id into v_referrer from public.reward_accounts
    where referral_code = upper(trim(p_code));
  if v_referrer is null or v_referrer = p_invitee then return false; end if;
  if exists (
    select 1 from auth.users referrer_user, auth.users invitee_user
    where referrer_user.id = v_referrer and invitee_user.id = p_invitee
      and referrer_user.email is not null and invitee_user.email is not null
      and lower(referrer_user.email) = lower(invitee_user.email)
  ) then return false; end if;
  insert into public.reward_referrals(invitee_user_id, referrer_user_id, referral_code)
    values (p_invitee, v_referrer, upper(trim(p_code)))
    on conflict (invitee_user_id) do nothing;
  return found;
end; $$;

create or replace function public.rewards_award_completed_commute(p_user uuid, p_session uuid)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare
  v_settings public.reward_settings%rowtype;
  v_stops integer;
  v_path jsonb;
  v_referrer uuid;
begin
  select * into v_settings from public.reward_settings where singleton = true;
  if not found or not v_settings.enabled then return false; end if;

  select total_stops, path_station_ids into v_stops, v_path
    from public.trip_sessions
    where id = p_session and user_id = p_user and completed = true and ended_at is not null;
  if not found or jsonb_array_length(coalesce(v_path, '[]'::jsonb)) <> v_stops + 1 then return false; end if;
  if not exists (
    select 1 from public.trip_events
    where session_id = p_session and user_id = p_user
      and station_index = v_stops and station_id = (v_path ->> v_stops)
  ) then return false; end if;

  if v_settings.commute_points > 0 then
    insert into public.reward_accounts(user_id) values (p_user) on conflict do nothing;
    insert into public.reward_ledger(user_id, points_delta, reason, reference_id)
      values (p_user, v_settings.commute_points, 'commute', p_session::text)
      on conflict (user_id, reason, reference_id) do nothing;
    if not found then return false; end if;
    update public.reward_accounts set balance_points = balance_points + v_settings.commute_points
      where user_id = p_user;
  end if;

  update public.reward_referrals set qualified_at = now()
    where invitee_user_id = p_user and qualified_at is null
    returning referrer_user_id into v_referrer;
  if found and v_settings.referral_points > 0 then
    insert into public.reward_accounts(user_id) values (v_referrer) on conflict do nothing;
    insert into public.reward_ledger(user_id, points_delta, reason, reference_id)
      values (v_referrer, v_settings.referral_points, 'referral', p_user::text)
      on conflict (user_id, reason, reference_id) do nothing;
    if found then
      update public.reward_accounts set balance_points = balance_points + v_settings.referral_points
        where user_id = v_referrer;
    end if;
  end if;
  return true;
end; $$;

create or replace function public.rewards_request_payout(p_user uuid, p_points bigint, p_upi text)
returns public.reward_payout_requests language plpgsql security definer set search_path = public, auth as $$
declare
  v_settings public.reward_settings%rowtype;
  v_balance bigint;
  v_amount_paise bigint;
  v_request public.reward_payout_requests%rowtype;
begin
  select * into v_settings from public.reward_settings where singleton = true for share;
  if not found or not v_settings.enabled then raise exception 'Rewards are not enabled'; end if;
  if p_points < v_settings.min_withdrawal_points then raise exception 'Minimum withdrawal not reached'; end if;
  if p_upi !~* '^[a-z0-9._-]{2,256}@[a-z0-9.-]{2,64}$' then raise exception 'Enter a valid UPI ID'; end if;

  select balance_points into v_balance from public.reward_accounts where user_id = p_user for update;
  if not found or p_points > v_balance then raise exception 'Insufficient points'; end if;
  v_amount_paise := round((p_points::numeric / 1000) * v_settings.rupees_per_1000_points * 100)::bigint;
  if v_amount_paise <= 0 then raise exception 'Payout amount is too small'; end if;

  insert into public.reward_payout_requests(user_id, points, amount_paise, upi_id)
    values (p_user, p_points, v_amount_paise, trim(p_upi)) returning * into v_request;
  update public.reward_accounts set balance_points = balance_points - p_points where user_id = p_user;
  insert into public.reward_ledger(user_id, points_delta, reason, reference_id)
    values (p_user, -p_points, 'payout', v_request.id::text);
  return v_request;
end; $$;

create or replace function public.rewards_resolve_payout(
  p_request uuid, p_action text, p_note text default null, p_reference text default null
) returns public.reward_payout_requests language plpgsql security definer
set search_path = public, auth as $$
declare v_request public.reward_payout_requests%rowtype;
begin
  select * into v_request from public.reward_payout_requests where id = p_request for update;
  if not found then raise exception 'Payout request not found'; end if;
  if p_action = 'approve' and v_request.status = 'pending' then
    update public.reward_payout_requests set status = 'approved', admin_note = p_note,
      reviewed_at = now() where id = p_request returning * into v_request;
  elsif p_action = 'paid' and v_request.status = 'approved' then
    update public.reward_payout_requests set status = 'paid', admin_note = p_note,
      payout_reference = p_reference, paid_at = now() where id = p_request returning * into v_request;
  elsif p_action = 'reject' and v_request.status in ('pending', 'approved') then
    update public.reward_payout_requests set status = 'rejected', admin_note = p_note,
      reviewed_at = now() where id = p_request returning * into v_request;
    insert into public.reward_accounts(user_id) values (v_request.user_id) on conflict do nothing;
    insert into public.reward_ledger(user_id, points_delta, reason, reference_id)
      values (v_request.user_id, v_request.points, 'payout_refund', v_request.id::text)
      on conflict (user_id, reason, reference_id) do nothing;
    if found then
      update public.reward_accounts set balance_points = balance_points + v_request.points
        where user_id = v_request.user_id;
    end if;
  else
    raise exception 'Invalid payout status transition';
  end if;
  return v_request;
end; $$;

revoke all on function public.rewards_claim_referral(uuid, text) from public, anon, authenticated;
revoke all on function public.rewards_award_completed_commute(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rewards_request_payout(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.rewards_resolve_payout(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.rewards_claim_referral(uuid, text) to service_role;
grant execute on function public.rewards_award_completed_commute(uuid, uuid) to service_role;
grant execute on function public.rewards_request_payout(uuid, bigint, text) to service_role;
grant execute on function public.rewards_resolve_payout(uuid, text, text, text) to service_role;
