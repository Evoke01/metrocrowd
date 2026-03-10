# ══════════════════════════════════════════════════════════════
#  MetroCrowd API — main.py
#  FastAPI entry point. Pure API server — no scheduler here.
#  Scheduler lives in worker.py (separate Railway process).
#
#  Procfile:
#    web:    uvicorn main:app --host 0.0.0.0 --port $PORT
#    worker: python worker.py
#
#  Run locally: uvicorn main:app --reload
# ══════════════════════════════════════════════════════════════
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.predict  import router as predict_router
from routers.stations import router as stations_router
from routers.push     import router as push_router
from routers.reports  import router as reports_router

app = FastAPI(title="MetroCrowd API", version="1.0.0")

app.add_middleware(CORSMiddleware,
    allow_origins=[
        "https://metrocrowd.vercel.app",
        "http://localhost:3000",
        "http://localhost:8080",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(predict_router,  prefix="/predict",  tags=["ML"])
app.include_router(stations_router, prefix="/stations", tags=["Stations"])
app.include_router(push_router,     prefix="/push",     tags=["Push"])
app.include_router(reports_router,  prefix="/reports",  tags=["Reports"])

@app.get("/health")
def health():
    return {"status": "ok"}
