#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════
#  worker.py — Background job runner
#  Runs as a SEPARATE process from main.py (FastAPI).
#  Deployed on Railway as a second service using Procfile.
#
#  Procfile:
#    web:    uvicorn main:app --host 0.0.0.0 --port $PORT
#    worker: python worker.py
#
#  Why separate?
#  If Railway restarts the web container, jobs don't lose state.
#  The worker can be scaled and restarted independently.
# ══════════════════════════════════════════════════════════════
import time, logging, os
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(message)s')
log = logging.getLogger(__name__)

scheduler = BlockingScheduler(timezone="Asia/Kolkata")

# ── Job: fetch GTFS-RT vehicle positions ──────────────────────
def job_realtime():
    try:
        from pipeline.realtime import fetch_and_store
        count = fetch_and_store()
        log.info(f"Realtime: {count} vehicle positions stored")
    except Exception as e:
        log.warning(f"Realtime job failed: {e}")

# ── Job: refresh static GTFS stops ────────────────────────────
def job_gtfs():
    try:
        from pipeline.gtfs import run
        run()
        log.info("GTFS static feed refreshed")
    except Exception as e:
        log.warning(f"GTFS job failed: {e}")

# ── Job: retrain ML model ──────────────────────────────────────
def job_train():
    try:
        from ml.train import train
        train()
        log.info("ML model retrained")
    except Exception as e:
        log.warning(f"Train job failed: {e}")

# ── Job: write ML predictions to Supabase ─────────────────────
# Runs after training, or independently every hour
def job_predict_all():
    try:
        from ml.predict_all import run
        count = run()
        log.info(f"Predictions written: {count} rows")
    except Exception as e:
        log.warning(f"Predict-all job failed: {e}")

# ── Job: send push alerts for high-crowd stations ─────────────
def job_push_alerts():
    try:
        from push.alerter import run_alerts
        run_alerts()
    except Exception as e:
        log.warning(f"Push alert job failed: {e}")

# ── Schedule ───────────────────────────────────────────────────
scheduler.add_job(job_realtime,    IntervalTrigger(seconds=30),  id="realtime",    max_instances=1)
scheduler.add_job(job_push_alerts, IntervalTrigger(minutes=5),   id="push_alerts", max_instances=1)
scheduler.add_job(job_predict_all, IntervalTrigger(hours=1),     id="predict_all", max_instances=1)
scheduler.add_job(job_train,       IntervalTrigger(hours=24),    id="train",       max_instances=1)
scheduler.add_job(job_gtfs,        CronTrigger(hour=3,minute=0), id="gtfs",        max_instances=1)

if __name__ == "__main__":
    log.info("Worker starting. Jobs: realtime(30s) · alerts(5m) · predictions(1h) · train(24h) · gtfs(3am)")
    # Run each job once immediately on startup
    job_realtime()
    job_predict_all()
    scheduler.start()
