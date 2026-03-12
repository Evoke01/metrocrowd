# ══════════════════════════════════════════════════════════════
#  pipeline/scheduler.py
#  Background jobs using APScheduler.
#  Runs alongside FastAPI via lifespan context.
# ══════════════════════════════════════════════════════════════
import asyncio
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

scheduler = BackgroundScheduler(timezone="Asia/Kolkata")

def _run_gtfs():
    try:
        from pipeline.gtfs import run
        run()
    except Exception as e:
        print(f"[Scheduler] GTFS job failed: {e}")

def _run_realtime():
    try:
        from pipeline.realtime import fetch_vehicle_positions
        positions = fetch_vehicle_positions()
        print(f"[Scheduler] Realtime: {len(positions)} vehicles")
    except Exception as e:
        print(f"[Scheduler] Realtime job failed: {e}")

def _run_train():
    try:
        from ml.train import train
        train()
    except Exception as e:
        print(f"[Scheduler] Train job failed: {e}")

def _run_notif(method_name):
    try:
        from push.engine import NotificationEngine
        engine = NotificationEngine()
        asyncio.run(getattr(engine, method_name)())
    except Exception as e:
        print(f"[Scheduler] Notif job {method_name} failed: {e}")

# ── BUG 1+2 FIX: all jobs registered inside start_scheduler, one definition only ──
def start_scheduler():
    # Core jobs
    scheduler.add_job(_run_gtfs,     CronTrigger(hour=3, minute=0),  id="gtfs",     replace_existing=True)
    scheduler.add_job(_run_realtime, IntervalTrigger(seconds=30),    id="realtime", replace_existing=True)
    scheduler.add_job(_run_train,    IntervalTrigger(hours=6),        id="train",    replace_existing=True)

    # Notification jobs — registered here, after scheduler.start()
    scheduler.add_job(lambda: _run_notif("run_morning_brief"),
        CronTrigger(hour="7-9",       minute="*/15", timezone="Asia/Kolkata"),
        id="morning_brief", replace_existing=True)

    scheduler.add_job(lambda: _run_notif("run_beat_the_rush"),
        CronTrigger(hour="6-10,16-20", minute="*/5", timezone="Asia/Kolkata"),
        id="beat_rush", replace_existing=True)

    scheduler.add_job(lambda: _run_notif("run_crowd_drop"),
        CronTrigger(hour="6-23",      minute="*/10", timezone="Asia/Kolkata"),
        id="crowd_drop", replace_existing=True)

    scheduler.add_job(lambda: _run_notif("run_weekly_digest"),
        CronTrigger(day_of_week="sun", hour="17-19", minute="*/15", timezone="Asia/Kolkata"),
        id="weekly_digest", replace_existing=True)

    scheduler.add_job(lambda: _run_notif("run_streak_reminder"),
        CronTrigger(hour="20-22",     minute="*/15", timezone="Asia/Kolkata"),
        id="streak_reminder", replace_existing=True)

    scheduler.add_job(lambda: _run_notif("run_network_alert"),
        CronTrigger(hour="6-23",      minute="*/5",  timezone="Asia/Kolkata"),
        id="network_alert", replace_existing=True)

    scheduler.start()
    print("[Scheduler] Started. Jobs: gtfs · realtime · train · 6×notif")

def stop_scheduler():
    scheduler.shutdown(wait=False)
