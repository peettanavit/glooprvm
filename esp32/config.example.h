#pragma once

// Wi-Fi credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Firebase Web API config (same project — ขอจากเจ้าของโปรเจกต์)
#define FIREBASE_API_KEY "YOUR_FIREBASE_WEB_API_KEY"
#define FIREBASE_PROJECT_ID "glooprvm"

// Dedicated machine account in Firebase Authentication
// สร้าง account ใหม่ใน Firebase Auth แล้วใส่ที่นี่
#define MACHINE_EMAIL "machine-gloop02@example.com"
#define MACHINE_PASSWORD "YOUR_MACHINE_PASSWORD"

// Firestore machine document id: /machines/{MACHINE_ID}
#define MACHINE_ID "Gloop_01"

// GPIO wiring — ตามวงจรที่ต่อจริง
#define SOLENOID_PIN    38
#define READY_BUTTON_PIN 47
#define SLOT_PIN_SMALL  14
#define SLOT_PIN_MEDIUM  2
#define SLOT_PIN_LARGE   3

// Camera mode
// WEBCAM_MODE true  = ใช้ USB webcam บน PC (listener_webcam.py) — ESP32 ไม่ต้องถ่ายรูป
// WEBCAM_MODE false = ใช้กล้อง OV5640 บน ESP32 (listener.py) — mode เดิม
// Production policy (temporary): keep WEBCAM_MODE=false (listener.py only)
#define WEBCAM_MODE false

// ใช้เฉพาะตอน WEBCAM_MODE false
#define CAMERA_ENABLED true
#define CF_UPLOAD_URL "https://us-central1-glooprvm.cloudfunctions.net/uploadBottleImage"
#define CF_UPLOAD_API_KEY "YOUR_UPLOAD_API_KEY"

// Simulation mode (ปิดไว้สำหรับการใช้งานจริง)
#define DEV_SIMULATION false
#define SIM_BOTTLE_PROBABILITY 0.25f

// Camera pin map (Freenove ESP32-S3 WROOM with OV5640)
#define CAM_PIN_PWDN    -1
#define CAM_PIN_RESET   -1
#define CAM_PIN_XCLK    15
#define CAM_PIN_SIOD     4
#define CAM_PIN_SIOC     5
#define CAM_PIN_Y9      16
#define CAM_PIN_Y8      17
#define CAM_PIN_Y7      18
#define CAM_PIN_Y6      12
#define CAM_PIN_Y5      10
#define CAM_PIN_Y4       8
#define CAM_PIN_Y3       9
#define CAM_PIN_Y2      11
#define CAM_PIN_Y1      -1
#define CAM_PIN_Y0      -1
#define CAM_PIN_VSYNC    6
#define CAM_PIN_HREF     7
#define CAM_PIN_PCLK    13
