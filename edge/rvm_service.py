import asyncio
import logging
import os
import random
import signal
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1 import Increment
from dotenv import load_dotenv

try:
    import RPi.GPIO as GPIO  # type: ignore
except Exception:  # pragma: no cover - allows local dev on non-Pi systems
    GPIO = None


load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)

MachineStatus = Literal["IDLE", "READY", "PROCESSING", "REJECTED", "COMPLETED"]
BottleSize = Literal["SMALL", "MEDIUM", "LARGE"]
SCORE_BY_SIZE = {"SMALL": 1, "MEDIUM": 2, "LARGE": 3}


@dataclass
class Config:
    machine_id: str = os.getenv("GLOOP_MACHINE_ID", "Gloop_01")
    solenoid_pin: int = int(os.getenv("GLOOP_SOLENOID_PIN", "18"))
    sensor_pin: int = int(os.getenv("GLOOP_BOTTLE_SENSOR_PIN", "23"))
    sensor_active_high: bool = os.getenv("GLOOP_SENSOR_ACTIVE_HIGH", "1") == "1"
    dev_simulation: bool = os.getenv("GLOOP_DEV_SIMULATION", "0") == "1"
    sim_bottle_probability: float = float(os.getenv("GLOOP_SIM_BOTTLE_PROBABILITY", "0.25"))


class GPIOController:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.enabled = GPIO is not None and not cfg.dev_simulation
        self._last_sensor_state = False

        if self.enabled:
            GPIO.setmode(GPIO.BCM)
            GPIO.setup(cfg.solenoid_pin, GPIO.OUT, initial=GPIO.LOW)
            GPIO.setup(cfg.sensor_pin, GPIO.IN)
            logging.info("GPIO initialized (solenoid=%s sensor=%s)", cfg.solenoid_pin, cfg.sensor_pin)
        else:
            logging.warning("GPIO disabled (simulation mode or GPIO module unavailable).")

    def cleanup(self) -> None:
        if self.enabled:
            GPIO.output(self.cfg.solenoid_pin, GPIO.LOW)
            GPIO.cleanup()

    async def pulse_solenoid(self, duration_sec: float = 0.5) -> None:
        if self.enabled:
            GPIO.output(self.cfg.solenoid_pin, GPIO.HIGH)
            await asyncio.sleep(duration_sec)
            GPIO.output(self.cfg.solenoid_pin, GPIO.LOW)
        else:
            logging.info("[SIM] Solenoid pulse %.2fs", duration_sec)
            await asyncio.sleep(duration_sec)

    def read_bottle_edge(self) -> bool:
        if self.enabled:
            raw_state = GPIO.input(self.cfg.sensor_pin)
            is_active = bool(raw_state) if self.cfg.sensor_active_high else not bool(raw_state)
            rising_edge = is_active and not self._last_sensor_state
            self._last_sensor_state = is_active
            return rising_edge

        # Simulation-only: configurable chance of bottle insert per polling cycle.
        return random.random() < self.cfg.sim_bottle_probability


class GloopRVMService:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.gpio = GPIOController(cfg)

        if not firebase_admin._apps:
            cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred)

        self.db = firestore.client()
        self.machine_ref = self.db.collection("machines").document(cfg.machine_id)

        self._stop_event = asyncio.Event()
        self._machine_state_lock = threading.Lock()
        self._status: MachineStatus = "IDLE"
        self._current_user: str = ""
        self._watch = None

    def start_listener(self) -> None:
        def on_snapshot(doc_snapshot, _changes, _read_time) -> None:
            if not doc_snapshot:
                return

            data = doc_snapshot[0].to_dict() or {}
            status = data.get("status", "IDLE")
            current_user = data.get("current_user", "")

            with self._machine_state_lock:
                self._status = status
                self._current_user = current_user

        self._watch = self.machine_ref.on_snapshot(on_snapshot)
        logging.info("Listening to machines/%s", self.cfg.machine_id)

    def stop_listener(self) -> None:
        if self._watch:
            self._watch.unsubscribe()

    def _get_machine_state(self) -> tuple[MachineStatus, str]:
        with self._machine_state_lock:
            return self._status, self._current_user

    async def set_status(self, status: MachineStatus) -> None:
        await asyncio.to_thread(self.machine_ref.update, {"status": status})

    async def reject_bottle(self) -> None:
        await self.set_status("REJECTED")
        await asyncio.sleep(1.2)
        status, _ = self._get_machine_state()
        if status == "REJECTED":
            await self.set_status("READY")

    async def accept_bottle(self, size: BottleSize) -> None:
        score = SCORE_BY_SIZE[size]
        await self.gpio.pulse_solenoid(0.6)
        await asyncio.to_thread(
            self.machine_ref.update,
            {
                "status": "PROCESSING",
                "session_score": Increment(score),
            },
        )
        logging.info("Accepted %s bottle (+%s)", size, score)

    async def verify_bottle_with_ai_camera(self) -> tuple[bool, Optional[BottleSize]]:
        # Placeholder for IMX500 inference pipeline.
        # Replace with actual model inference and rule checks.
        await asyncio.sleep(0.15)
        valid = random.random() < 0.78
        if not valid:
            return False, None

        size = random.choices(
            population=["SMALL", "MEDIUM", "LARGE"],
            weights=[0.4, 0.4, 0.2],
            k=1,
        )[0]
        return True, size

    async def wait_for_bottle_event(self, timeout_sec: Optional[float]) -> bool:
        loop = asyncio.get_running_loop()
        deadline = None if timeout_sec is None else loop.time() + timeout_sec

        while not self._stop_event.is_set():
            status, current_user = self._get_machine_state()
            if status not in {"READY", "PROCESSING"} or not current_user:
                return False

            if self.gpio.read_bottle_edge():
                return True

            if deadline is not None and loop.time() >= deadline:
                return False

            await asyncio.sleep(0.08)

        return False

    async def run_active_session(self) -> None:
        while not self._stop_event.is_set():
            status, current_user = self._get_machine_state()
            if status not in {"READY", "PROCESSING"} or not current_user:
                return

            # Keep accepting bottles until user/web changes machine status.
            has_bottle = await self.wait_for_bottle_event(timeout_sec=None)

            if not has_bottle:
                return

            is_valid, size = await self.verify_bottle_with_ai_camera()
            if not is_valid or size is None:
                logging.info("Bottle rejected")
                await self.reject_bottle()
                continue

            await self.accept_bottle(size)

    async def run(self) -> None:
        self.start_listener()
        logging.info("RVM service started")

        while not self._stop_event.is_set():
            status, current_user = self._get_machine_state()
            if status in {"READY", "PROCESSING"} and current_user:
                await self.run_active_session()
            else:
                await asyncio.sleep(0.25)

    async def shutdown(self) -> None:
        self._stop_event.set()
        self.stop_listener()
        self.gpio.cleanup()


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    cfg = Config()
    service = GloopRVMService(cfg)

    loop = asyncio.get_running_loop()

    def handle_signal() -> None:
        logging.info("Shutdown signal received")
        asyncio.create_task(service.shutdown())

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_signal)
        except NotImplementedError:
            # Some environments (notably Windows) do not support this in asyncio.
            signal.signal(sig, lambda *_: asyncio.create_task(service.shutdown()))

    try:
        await service.run()
    finally:
        await service.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
