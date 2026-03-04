# Gloop Edge Service (Legacy Raspberry Pi Path)

For new setup, use `../esp32` to run the machine loop directly on ESP32.

`rvm_service.py` runs on Raspberry Pi and controls the machine loop:
- listens to `machines/Gloop_01`
- waits for `READY`
- validates bottles (placeholder AI camera function)
- rejects invalid bottles (`REJECTED` -> `READY`)
- accepts valid bottles, actuates solenoid, increments score
- keeps running until user/web ends the session (`COMPLETED`)

Run:
```bash
cp .env.example .env
pip install -r requirements.txt
python rvm_service.py
```
