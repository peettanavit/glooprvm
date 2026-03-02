# Gloop Edge Service

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
