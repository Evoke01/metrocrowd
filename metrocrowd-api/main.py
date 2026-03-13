# ══════════════════════════════════════════════════════════════
#  MetroCrowd API — main.py
#  FastAPI entry point. Pure API server — no scheduler here.
#  Scheduler lives in worker.py (separate Railway process).
# ══════════════════════════════════════════════════════════════
import logging, uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from routers.predict  import router as predict_router
from routers.stations import router as stations_router
from routers.push     import router as push_router
from routers.reports  import router as reports_router
from routers.realtime import router as realtime_router
from routers.trips    import router as trips_router
from routers.groups   import router as groups_router
from routers.stats          import router as stats_router
from routers.notifications  import router as notif_router
from routers.guide         import router as guide_router

logger = logging.getLogger(__name__)

app = FastAPI(title="MetroCrowd API", version="1.0.0")

app.add_middleware(CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ── Request ID middleware ──────────────────────────────────────
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request.state.id = str(uuid.uuid4())[:8]
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.id
    return response

# ── Global error handler — always includes CORS headers ───────
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    req_id = getattr(request.state, "id", "unknown")
    logger.error(f"Unhandled exception [req:{req_id}]: {type(exc).__name__}: {exc}", exc_info=True)
    origin = request.headers.get("origin", "*")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "request_id": req_id},
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    )

# ── Routers ───────────────────────────────────────────────────
app.include_router(predict_router,  prefix="/predict",  tags=["ML"])
app.include_router(stations_router, prefix="/stations", tags=["Stations"])
app.include_router(push_router,     prefix="/push",     tags=["Push"])
app.include_router(reports_router,  prefix="/reports",  tags=["Reports"])
app.include_router(realtime_router, prefix="/realtime", tags=["Realtime"])
app.include_router(trips_router,    prefix="/trips",    tags=["Trips"])
app.include_router(groups_router,   prefix="/groups",   tags=["Groups"])
app.include_router(stats_router,    prefix="/stats",       tags=["Stats"])
app.include_router(notif_router,    prefix="/notifications", tags=["Notifications"])
app.include_router(guide_router,    prefix="/guide",          tags=["Guide"])

@app.get("/health")
def health():
    return {"status": "ok"}
