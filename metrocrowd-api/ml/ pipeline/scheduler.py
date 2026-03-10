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

def start_scheduler():
    # GTFS static feed — once a day at 3am IST
    scheduler.add_job(_run_gtfs,     CronTrigger(hour=3, minute=0),   id="gtfs")
    # Real-time vehicle positions — every 30 seconds
    scheduler.add_job(_run_realtime, IntervalTrigger(seconds=30),     id="realtime")
    # Retrain ML model — every 24 hours
    scheduler.add_job(_run_train,    IntervalTrigger(hours=24),        id="train")
    scheduler.start()
    print("[Scheduler] Started. Jobs: gtfs(daily) · realtime(30s) · train(24h)")

def stop_scheduler():
    scheduler.shutdown(wait=False)
