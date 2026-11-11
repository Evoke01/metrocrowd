-- Points for crowd reports. Run once in the Supabase SQL editor after
-- 20261110_referral_rewards.sql. Safe to re-run.

alter table public.reward_settings
  add column if not exists report_points integer not null default 2 check (report_points >= 0),
  add column if not exists daily_report_cap integer not null default 5 check (daily_report_cap >= 0);

-- Allow the new 'report' ledger reason.
alter table public.reward_ledger drop constraint if exists reward_ledger_reason_check;
alter table public.reward_ledger add constraint reward_ledger_reason_check
  check (reason in ('commute', 'referral', 'report', 'payout', 'payout_refund', 'admin_adjustment'));

-- Award points for the caller's most recent crowd report.
-- Anti-abuse rules:
--   * the report must belong to the user and be less than 15 minutes old
--   * each report is rewarded at most once (ledger unique key)
--   * at most one rewarded report per station per hour
--   * at most daily_report_cap rewarded reports per IST calendar day
create or replace function public.rewards_award_report(p_user uuid)
returns integer language plpgsql security definer set search_path = public, auth as $$
declare
  v_settings public.reward_settings%rowtype;
  v_report record;
  v_today_count integer;
  v_day_start timestamptz;
begin
  select * into v_settings from public.reward_settings where singleton = true;
  if not found or not v_settings.enabled or v_settings.report_points <= 0 then return 0; end if;

  select id::text as rid, station_id, created_at into v_report
    from public.crowd_reports
    where user_id = p_user and created_at > now() - interval '15 minutes'
    order by created_at desc limit 1;
  if not found then return 0; end if;

  v_day_start := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  select count(*) into v_today_count from public.reward_ledger
    where user_id = p_user and reason = 'report' and created_at >= v_day_start;
  if v_today_count >= v_settings.daily_report_cap then return 0; end if;

  if exists (
    select 1 from public.reward_ledger l
    join public.crowd_reports r on r.id::text = l.reference_id
    where l.user_id = p_user and l.reason = 'report'
      and r.station_id = v_report.station_id
      and l.created_at > now() - interval '1 hour'
  ) then return 0; end if;

  insert into public.reward_accounts(user_id) values (p_user) on conflict do nothing;
  insert into public.reward_ledger(user_id, points_delta, reason, reference_id)
    values (p_user, v_settings.report_points, 'report', v_report.rid)
    on conflict (user_id, reason, reference_id) do nothing;
  if not found then return 0; end if;
  update public.reward_accounts set balance_points = balance_points + v_settings.report_points
    where user_id = p_user;
  return v_settings.report_points;
end; $$;

revoke all on function public.rewards_award_report(uuid) from public, anon, authenticated;
grant execute on function public.rewards_award_report(uuid) to service_role;
