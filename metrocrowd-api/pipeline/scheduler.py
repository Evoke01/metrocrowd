# ══════════════════════════════════════════════════════════════
#  pipeline/scheduler.py
#  Background jobs using APScheduler.
#  Runs alongside FastAPI via lifespan context.
# ══════════════════════════════════════════════════════════════
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


import asyncio

def _run_notif(method_name):
    try:
        from push.engine import NotificationEngine
        engine = NotificationEngine()
        asyncio.run(getattr(engine, method_name)())
    except Exception as e:
        print(f"[Scheduler] Notif job {method_name} failed: {e}")

def start_scheduler():
    # GTFS static feed — once a day at 3am IST
    scheduler.add_job(_run_gtfs,     CronTrigger(hour=3, minute=0),   id="gtfs")
    # Real-time vehicle positions — every 30 seconds
    scheduler.add_job(_run_realtime, IntervalTrigger(seconds=30),     id="realtime")
    # Retrain ML model — every 24 hours
    scheduler.add_job(_run_train,    IntervalTrigger(hours=6),         id="train")
    
# ── Notification jobs ─────────────────────────────────────────
# Morning Brief — runs every 15min between 7–9am to catch the right users
scheduler.add_job(lambda: _run_notif("run_morning_brief"),
    CronTrigger(hour="7-9", minute="*/15", timezone="Asia/Kolkata"),
    id="morning_brief", replace_existing=True)

# Beat the Rush — runs every 5min between 7–10am and 5–8pm
scheduler.add_job(lambda: _run_notif("run_beat_the_rush"),
    CronTrigger(hour="7-10,17-20", minute="*/5", timezone="Asia/Kolkata"),
    id="beat_rush", replace_existing=True)

# Crowd Drop — runs every 10min during service hours
scheduler.add_job(lambda: _run_notif("run_crowd_drop"),
    CronTrigger(hour="6-23", minute="*/10", timezone="Asia/Kolkata"),
    id="crowd_drop", replace_existing=True)

# Weekly Digest — runs every 15min on Sunday evening 
scheduler.add_job(lambda: _run_notif("run_weekly_digest"),
    CronTrigger(day_of_week="sun", hour="17-19", minute="*/15", timezone="Asia/Kolkata"),
    id="weekly_digest", replace_existing=True)

# Streak Reminder — runs every 15min between 8–10pm
scheduler.add_job(lambda: _run_notif("run_streak_reminder"),
    CronTrigger(hour="20-22", minute="*/15", timezone="Asia/Kolkata"),
    id="streak_reminder", replace_existing=True)

# Network Alert — runs every 5min during peak hours
scheduler.add_job(lambda: _run_notif("run_network_alert"),
    CronTrigger(hour="6-23", minute="*/5", timezone="Asia/Kolkata"),
    id="network_alert", replace_existing=True)

def start_scheduler():
    scheduler.start()
    print("[Scheduler] Started.")

def stop_scheduler():
    scheduler.shutdown(wait=False)
