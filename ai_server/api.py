"""
Gloop RVM — FastAPI AI Service
-------------------------------
Wraps listener.py logic behind HTTP endpoints so the web dashboard can monitor
the AI service without querying Firestore directly.

Endpoints:
  GET /health   — liveness probe (load balancer / uptime monitor friendly)
  GET /status   — detailed service state: uptime, last detection, active config

Run:
  python api.py
  uvicorn api:app --host 0.0.0.0 --port 8000
"""

import time
import threading
import logging

from fastapi import FastAPI
import uvicorn

from listener import service_state, _state_lock, _config, start_listener

log = logging.getLogger(__name__)

app = FastAPI(
    title="Gloop RVM AI Service",
    description="AI inference service for the Gloop RVM bottle-sorting machine.",
    version="1.0.0",
)

# ── Start the Firestore listener in a daemon thread on first import ───────────
_listener_watch = None
_start_lock = threading.Lock()


def _ensure_listener_started():
    global _listener_watch
    with _start_lock:
        if _listener_watch is None:
            _listener_watch = start_listener()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health", summary="Liveness probe")
def health():
    """
    Returns 200 as long as the process is alive and the Firestore listener
    is running. Use this for uptime monitors and load-balancer health checks.
    """
    with _state_lock:
        alive = service_state["listener_alive"]
    return {
        "ok":             True,
        "listener_alive": alive,
        "uptime_s":       round(time.time() - service_state["started_at"], 1),
    }


@app.get("/status", summary="Detailed service status")
def status():
    """
    Returns full service telemetry:
    - uptime and processing counts
    - last detection result with inference latency
    - active operational config snapshot (thresholds, wait times)
    """
    with _state_lock:
        state = dict(service_state)

    last = state.get("last_detection")
    last_processed_at = state.get("last_processed_at")

    return {
        "ok": True,
        "service": {
            "listener_alive":    state["listener_alive"],
            "uptime_s":          round(time.time() - state["started_at"], 1),
            "total_processed":   state["total_processed"],
            "last_processed_at": last_processed_at,
            "idle_s":            round(time.time() - last_processed_at, 1)
                                 if last_processed_at else None,
        },
        "last_detection": last,
        "config":         _config.snapshot(),
    }


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    _ensure_listener_started()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
