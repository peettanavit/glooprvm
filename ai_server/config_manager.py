"""
Gloop RVM — Dynamic Configuration Manager
------------------------------------------
Fetches operational parameters from Firestore `system_configs` collection
instead of static .env variables.  Results are cached for `ttl_s` seconds
so each bottle does not incur a Firestore read.

Merge order (later wins):
  1. Built-in code defaults
  2. system_configs/global
  3. system_configs/{machine_id}   ← machine-specific overrides

Firestore document structure (all fields optional):
  system_configs/global
    AI_CONFIDENCE_THRESHOLD  : 0.5
    AI_SAFETY_LOCK_THRESHOLD : 0.35
    CAP_WAIT_SECONDS         : 1.5

  system_configs/Gloop_01        ← machine-specific overrides
    AI_CONFIDENCE_THRESHOLD  : 0.55
"""

import time
import logging

log = logging.getLogger(__name__)

_DEFAULTS: dict = {
    "AI_CONFIDENCE_THRESHOLD":  0.5,
    "AI_SAFETY_LOCK_THRESHOLD": 0.35,
    "CAP_WAIT_SECONDS":         1.5,
}


class ConfigManager:
    def __init__(self, db, machine_id: str, ttl_s: float = 60.0):
        self._db         = db
        self._machine_id = machine_id
        self._ttl_s      = ttl_s
        self._cache: dict      = {}
        self._fetched_at: float = 0.0   # 0 → never fetched

    # ── Public API ────────────────────────────────────────────────────────────

    def get(self, key: str, default=None):
        """Return config value (float/int/str), refreshing cache if stale."""
        self._maybe_refresh()
        fallback = default if default is not None else _DEFAULTS.get(key)
        return self._cache.get(key, fallback)

    def get_float(self, key: str) -> float:
        return float(self.get(key))

    def snapshot(self) -> dict:
        """Return a copy of the current cached config (for telemetry/API)."""
        self._maybe_refresh()
        return dict(self._cache)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _maybe_refresh(self):
        if time.monotonic() - self._fetched_at >= self._ttl_s:
            self._refresh()

    def _refresh(self):
        try:
            merged = dict(_DEFAULTS)

            global_snap = self._db.collection("system_configs").document("global").get()
            if global_snap.exists:
                merged.update({k: v for k, v in (global_snap.to_dict() or {}).items()
                               if not k.startswith("_")})

            machine_snap = self._db.collection("system_configs").document(self._machine_id).get()
            if machine_snap.exists:
                merged.update({k: v for k, v in (machine_snap.to_dict() or {}).items()
                               if not k.startswith("_")})

            self._cache      = merged
            self._fetched_at = time.monotonic()
            log.info(
                "[Config] refreshed — threshold=%.2f  safety_lock=%.2f  cap_wait=%.1fs",
                merged["AI_CONFIDENCE_THRESHOLD"],
                merged["AI_SAFETY_LOCK_THRESHOLD"],
                merged["CAP_WAIT_SECONDS"],
            )
        except Exception as exc:
            log.error("[Config] refresh failed: %s — keeping previous values", exc)
            # First-time failure: fall back to defaults so the service can start
            if not self._cache:
                self._cache = dict(_DEFAULTS)
            self._fetched_at = time.monotonic()  # back-off; don't hammer Firestore
