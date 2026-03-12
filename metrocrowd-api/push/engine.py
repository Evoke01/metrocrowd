# ══════════════════════════════════════════════════════════════
#  push/engine.py — Smart Engagement Notification Engine
#
#  6 notification types:
#  1. morning_brief   — 7:30am: home station crowd + leave-by time
#  2. beat_the_rush   — 30min before user's peak: crowd forecast warning
#  3. crowd_drop      — real-time: station cleared below threshold
#  4. weekly_digest   — Sunday 6pm: trip stats + streak
#  5. streak_reminder — 9pm: streak at risk if no trip today
#  6. network_alert   — spike: line packed based on community reports
#
#  All sends are deduped via notification_log table.
#  Respects per-user quiet hours (default 10pm–7am IST).
# ══════════════════════════════════════════════════════════════
import os, logging, asyncio
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from supabase import create_client
from pywebpush import webpush, WebPushException
import json

logger  = logging.getLogger(__name__)
IST     = ZoneInfo("Asia/Kolkata")
SB_URL  = os.environ["SUPABASE_URL"]
SB_KEY  = os.environ["SUPABASE_KEY"]
VAPID_PRIVATE = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC  = os.environ.get("VAPID_PUBLIC_KEY",  "")
VAPID_EMAIL   = "mailto:metrocrowd@example.com"

CROWD_LABELS = {
    (0,  30):  ("😌", "Empty",    "#4ade80"),
    (30, 50):  ("🙂", "Low",      "#a3e635"),
    (50, 70):  ("😐", "Moderate", "#facc15"),
    (70, 85):  ("😰", "Crowded",  "#fb923c"),
    (85, 101): ("😱", "Packed",   "#f87171"),
}

def _crowd_info(pct):
    for (lo, hi), (emoji, label, color) in CROWD_LABELS.items():
        if lo <= pct < hi:
            return emoji, label, color
    return "😐", "Unknown", "#888"

def _db():
    return create_client(SB_URL, SB_KEY)

def _ist_now():
    return datetime.now(IST)

def _dedup_key(user_id, notif_type, suffix=""):
    today = _ist_now().strftime("%Y-%m-%d")
    return f"{user_id}:{notif_type}:{today}{(':'+suffix) if suffix else ''}"

def _already_sent(db, key):
    try:
        r = db.table("notification_log").select("id").eq("dedup_key", key).execute()
        return bool(r.data)
    except:
        return False

def _log_sent(db, user_id, notif_type, key, payload):
    try:
        db.table("notification_log").insert({
            "user_id":    user_id,
            "notif_type": notif_type,
            "dedup_key":  key,
            "payload":    payload,
        }).execute()
    except Exception as e:
        logger.warning(f"[NotifLog] {e}")

def _in_quiet_hours(prefs):
    h = _ist_now().hour
    qs, qe = prefs.get("quiet_start", 22), prefs.get("quiet_end", 7)
    if qs > qe:   # crosses midnight e.g. 22→7
        return h >= qs or h < qe
    return qs <= h < qe

def _send_push(subscription_info, title, body, icon="🚇", url="/", tag="mc-notif", badge_count=1):
    """Send a single web push notification."""
    if not VAPID_PRIVATE or not subscription_info:
        return False
    payload = json.dumps({
        "title": title,
        "body":  body,
        "icon":  "/icons/icon-192.png",
        "badge": "/icons/badge-72.png",
        "tag":   tag,
        "url":   url,
        "vibrate": [100, 50, 100],
    })
    try:
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=VAPID_PRIVATE,
            vapid_claims={"sub": VAPID_EMAIL},
        )
        return True
    except WebPushException as e:
        logger.warning(f"[Push] WebPushException: {e}")
        return False
    except Exception as e:
        logger.warning(f"[Push] Error: {e}")
        return False

def _get_subscriptions(db, user_id):
    r = db.table("push_subscriptions").select("subscription").eq("user_id", user_id).execute()
    return [row["subscription"] for row in (r.data or [])]

def _get_crowd(station_id):
    """Fetch crowd % for a station from Supabase recent reports."""
    try:
        db = _db()
        since = (datetime.now(timezone.utc) - timedelta(minutes=90)).isoformat()
        r = db.table("crowd_reports") \
              .select("crowd_value") \
              .eq("station_id", station_id) \
              .gte("created_at", since) \
              .order("created_at", desc=True) \
              .limit(10).execute()
        if not r.data:
            return None
        vals = [row["crowd_value"] for row in r.data]
        return round(sum(vals) / len(vals))
    except:
        return None


class NotificationEngine:

    # ── 1. Morning Brief ──────────────────────────────────────
    async def run_morning_brief(self):
        """7:30am IST daily — home station crowd + smart leave time."""
        now = _ist_now()
        if not (7 <= now.hour < 9):
            return
        db = _db()
        prefs_rows = db.table("notification_prefs") \
                       .select("*") \
                       .eq("morning_brief", True) \
                       .not_.is_("home_station", "null") \
                       .execute()

        sent = 0
        for prefs in (prefs_rows.data or []):
            uid  = prefs["user_id"]
            key  = _dedup_key(uid, "morning_brief")
            if _already_sent(db, key) or _in_quiet_hours(prefs):
                continue

            station = prefs["home_station"]
            crowd   = _get_crowd(station) or 55
            emoji, label, _ = _crowd_info(crowd)

            # Leave-by time: suggest 30min window before predicted peak
            peak_h  = prefs.get("morning_peak_hour", 8)
            leave_h = peak_h - 1 if crowd > 60 else peak_h
            leave   = f"{leave_h}:00" if crowd > 60 else "anytime soon"

            if crowd < 50:
                tip = f"Great time to board · Leave by {leave}"
            elif crowd < 70:
                tip = f"Getting busy · Consider leaving by {leave}"
            else:
                tip = f"Peak rush ahead · Leave NOW to beat it"

            title = f"🌅 Morning Brief"
            body  = f"{station} · {crowd}% {emoji} {label}\n{tip}"

            subs = _get_subscriptions(db, uid)
            for sub in subs:
                if _send_push(sub, title, body, tag="morning-brief", url="/?tab=home"):
                    _log_sent(db, uid, "morning_brief", key,
                              {"station": station, "crowd": crowd})
                    sent += 1
                    break

        logger.info(f"[MorningBrief] Sent to {sent} users")

    # ── 2. Beat the Rush ──────────────────────────────────────
    async def run_beat_the_rush(self):
        """30min before user's peak hour — crowd forecast warning."""
        now     = _ist_now()
        cur_h   = now.hour
        cur_min = now.minute
        if not (25 <= cur_min <= 35):   # only fire in the :30 window
            return

        db = _db()
        # Find users whose peak is in 30min
        prefs_rows = db.table("notification_prefs") \
                       .select("*") \
                       .eq("beat_the_rush", True) \
                       .execute()

        sent = 0
        for prefs in (prefs_rows.data or []):
            uid    = prefs["user_id"]
            m_peak = prefs.get("morning_peak_hour", 8)
            e_peak = prefs.get("evening_peak_hour", 18)
            if cur_h not in (m_peak - 1, e_peak - 1):
                continue

            period = "morning" if cur_h == m_peak - 1 else "evening"
            key    = _dedup_key(uid, "beat_the_rush", period)
            if _already_sent(db, key) or _in_quiet_hours(prefs):
                continue

            station = prefs.get("home_station", "your station")
            crowd   = _get_crowd(station) or 65
            emoji, label, _ = _crowd_info(crowd)

            peak_time = f"{m_peak}:00" if period == "morning" else f"{e_peak}:00"

            if crowd > 70:
                title = "⚡ Beat the Rush"
                body  = f"Rush hits {station} at {peak_time}\nLeave NOW · Currently {crowd}% {emoji}"
            else:
                title = "🚇 Commute Window"
                body  = f"Peak hour in 30min · {station} at {crowd}% {emoji}\nGood time to leave"

            subs = _get_subscriptions(db, uid)
            for sub in subs:
                if _send_push(sub, title, body, tag="beat-rush", url="/?tab=route"):
                    _log_sent(db, uid, "beat_the_rush", key,
                              {"station": station, "crowd": crowd, "period": period})
                    sent += 1
                    break

        logger.info(f"[BeatRush] Sent to {sent} users")

    # ── 3. Crowd Drop Alert ───────────────────────────────────
    async def run_crowd_drop(self):
        """Triggered when crowd drops below user's threshold."""
        db = _db()
        prefs_rows = db.table("notification_prefs") \
                       .select("*") \
                       .eq("crowd_drop", True) \
                       .not_.is_("home_station", "null") \
                       .execute()

        sent = 0
        for prefs in (prefs_rows.data or []):
            uid       = prefs["user_id"]
            threshold = prefs.get("drop_threshold", 45)
            station   = prefs["home_station"]
            crowd     = _get_crowd(station)
            if crowd is None or crowd >= threshold:
                continue
            if _in_quiet_hours(prefs):
                continue

            # Only alert once per 2 hours max (use hour suffix)
            hour_bucket = _ist_now().strftime("%H")
            key = _dedup_key(uid, "crowd_drop", hour_bucket)
            if _already_sent(db, key):
                continue

            emoji, label, _ = _crowd_info(crowd)
            title = "✅ Station Cleared Up"
            body  = f"{station} just dropped to {crowd}% {emoji}\nGood window to travel now"

            subs = _get_subscriptions(db, uid)
            for sub in subs:
                if _send_push(sub, title, body, tag="crowd-drop", url="/?tab=station"):
                    _log_sent(db, uid, "crowd_drop", key,
                              {"station": station, "crowd": crowd, "threshold": threshold})
                    sent += 1
                    break

        logger.info(f"[CrowdDrop] Sent to {sent} users")

    # ── 4. Weekly Digest ──────────────────────────────────────
    async def run_weekly_digest(self):
        """Sunday 6pm — trip stats recap."""
        now = _ist_now()
        if not (now.weekday() == 6 and 17 <= now.hour < 19):
            return

        db = _db()
        prefs_rows = db.table("notification_prefs") \
                       .select("user_id, weekly_digest") \
                       .eq("weekly_digest", True).execute()

        sent = 0
        for prefs in (prefs_rows.data or []):
            uid = prefs["user_id"]
            key = _dedup_key(uid, "weekly_digest")
            if _already_sent(db, key):
                continue

            # Pull this week's trips
            week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            r = db.table("trip_sessions") \
                  .select("actual_duration_sec,est_duration_sec,completed") \
                  .eq("user_id", uid) \
                  .gte("created_at", week_ago) \
                  .execute()
            trips = r.data or []
            if not trips:
                continue

            total       = len(trips)
            completed   = sum(1 for t in trips if t.get("completed"))
            act_mins    = [t["actual_duration_sec"]/60 for t in trips if t.get("actual_duration_sec")]
            est_mins    = [t["est_duration_sec"]/60    for t in trips if t.get("est_duration_sec")]
            avg_min     = round(sum(act_mins)/len(act_mins)) if act_mins else 0
            saved_min   = sum(max(0, e-a) for e,a in zip(est_mins, act_mins))
            saved_str   = f"{round(saved_min/60,1)}h" if saved_min>=60 else f"{round(saved_min)}m"

            # Streak from report count
            r2 = db.table("crowd_reports").select("created_at") \
                   .eq("user_id", uid) \
                   .order("created_at", desc=True).limit(50).execute()
            days = set(datetime.fromisoformat(row["created_at"]).strftime("%Y-%m-%d")
                       for row in (r2.data or []))
            streak = 0
            for i in range(7):
                d = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
                if d in days: streak += 1
                else: break

            streak_str = f"🔥 {streak}d streak" if streak > 1 else ""
            title = "📊 Your Week on MetroCrowd"
            body  = (f"{total} trips · avg {avg_min}min · saved {saved_str}"
                     + (f"\n{streak_str}" if streak_str else ""))

            subs = _get_subscriptions(db, uid)
            for sub in subs:
                if _send_push(sub, title, body, tag="weekly-digest", url="/?tab=home"):
                    _log_sent(db, uid, "weekly_digest", key,
                              {"trips": total, "avg_min": avg_min, "saved": saved_str})
                    sent += 1
                    break

        logger.info(f"[WeeklyDigest] Sent to {sent} users")

    # ── 5. Streak Reminder ────────────────────────────────────
    async def run_streak_reminder(self):
        """9pm if user hasn't logged a trip or report today."""
        now = _ist_now()
        if not (20 <= now.hour < 22):
            return

        db = _db()
        prefs_rows = db.table("notification_prefs") \
                       .select("user_id,streak_reminder") \
                       .eq("streak_reminder", True).execute()

        sent = 0
        today_start = datetime.now(timezone.utc).replace(hour=0,minute=0,second=0).isoformat()
        for prefs in (prefs_rows.data or []):
            uid = prefs["user_id"]
            key = _dedup_key(uid, "streak_reminder")
            if _already_sent(db, key):
                continue

            # Check if they've done anything today
            r = db.table("crowd_reports").select("id") \
                  .eq("user_id", uid).gte("created_at", today_start).limit(1).execute()
            r2 = db.table("trip_sessions").select("id") \
                   .eq("user_id", uid).gte("created_at", today_start).limit(1).execute()
            if (r.data or r2.data):
                continue  # already active today

            # Check they had a streak worth protecting
            yesterday = (datetime.now(timezone.utc)-timedelta(days=1)).isoformat()
            r3 = db.table("crowd_reports").select("id") \
                   .eq("user_id", uid).gte("created_at", yesterday).limit(1).execute()
            if not r3.data:
                continue  # no streak to protect

            title = "🔥 Streak at Risk"
            body  = "You haven't logged a trip today\nReport crowd or navigate a route to keep your streak"

            subs = _get_subscriptions(db, uid)
            for sub in subs:
                if _send_push(sub, title, body, tag="streak", url="/?tab=report"):
                    _log_sent(db, uid, "streak_reminder", key, {})
                    sent += 1
                    break

        logger.info(f"[StreakReminder] Sent to {sent} users")

    # ── 6. Network Alert ─────────────────────────────────────
    async def run_network_alert(self):
        """When 5+ reports of packed on same line within 10 minutes."""
        db  = _db()
        now = datetime.now(timezone.utc)
        ten_min_ago = (now - timedelta(minutes=10)).isoformat()

        # Count packed reports per line in last 10 min
        r = db.table("crowd_reports") \
              .select("line_codes,crowd_value") \
              .gte("created_at", ten_min_ago) \
              .gte("crowd_value", 80) \
              .execute()

        from collections import Counter
        line_counts = Counter()
        for row in (r.data or []):
            for line in (row.get("line_codes") or []):
                line_counts[line] += 1

        hot_lines = [line for line, count in line_counts.items() if count >= 5]
        if not hot_lines:
            return

        prefs_rows = db.table("notification_prefs") \
                       .select("user_id,network_alert") \
                       .eq("network_alert", True).execute()

        sent = 0
        hour_bucket = now.strftime("%H")
        for line in hot_lines:
            for prefs in (prefs_rows.data or []):
                uid = prefs["user_id"]
                key = _dedup_key(uid, "network_alert", f"{line}:{hour_bucket}")
                if _already_sent(db, key):
                    continue

                title = f"🚨 {line} Line Alert"
                body  = (f"Multiple packed reports in last 10 min\n"
                         f"Consider alternate route or wait 15–20 min")

                subs = _get_subscriptions(db, uid)
                for sub in subs:
                    if _send_push(sub, title, body, tag=f"network-{line}", url="/?tab=route"):
                        _log_sent(db, uid, "network_alert", key, {"line": line})
                        sent += 1
                        break

        logger.info(f"[NetworkAlert] Hot lines: {hot_lines} · Sent: {sent}")

    # ── Test send ─────────────────────────────────────────────
    async def send_test(self, user_id: str, notif_type: str):
        db   = _db()
        subs = _get_subscriptions(db, user_id)
        if not subs:
            return

        demos = {
            "morning_brief":  ("🌅 Morning Brief",   "Rajiv Chowk · 34% 🙂 Low\nGreat time to board · Leave by 8:00"),
            "beat_the_rush":  ("⚡ Beat the Rush",    "Rush hits Rajiv Chowk at 9:00\nLeave NOW · Currently 72% 😰"),
            "crowd_drop":     ("✅ Station Cleared",  "Rajiv Chowk dropped to 31% 😌\nGood window to travel now"),
            "weekly_digest":  ("📊 Your Week",        "8 trips · avg 34min · saved 2.1h\n🔥 5d streak"),
            "streak_reminder":("🔥 Streak at Risk",   "You haven't logged a trip today\nReport crowd to keep your streak"),
            "network_alert":  ("🚨 Yellow Line Alert","Multiple packed reports in last 10 min\nConsider alternate route"),
        }
        title, body = demos.get(notif_type, ("📣 MetroCrowd", "Test notification"))
        for sub in subs:
            _send_push(sub, title, body, tag="test")
