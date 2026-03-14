#pragma once

// Wi-Fi credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Firebase Web API config (same project used by web app)
#define FIREBASE_API_KEY "YOUR_FIREBASE_WEB_API_KEY"
#define FIREBASE_PROJECT_ID "YOUR_FIREBASE_PROJECT_ID"

// Dedicated machine account in Firebase Authentication
#define MACHINE_EMAIL "machine-gloop01@example.com"
#define MACHINE_PASSWORD "CHANGE_ME_MACHINE_PASSWORD"

// Firestore machine document id: /machines/{MACHINE_ID}
#define MACHINE_ID "Gloop_01"

// GPIO wiring
#define SOLENOID_PIN    YOUR_SOLENOID_PIN
#define SENSOR_PIN      YOUR_SENSOR_PIN
#define READY_BUTTON_PIN YOUR_READY_BUTTON_PIN
#define SLOT_PIN_SMALL  YOUR_SLOT_PIN_SMALL
#define SENSOR_ACTIVE_HIGH true

// Cloud Function URL
#define CF_UPLOAD_URL "https://us-central1-glooprvm.cloudfunctions.net/uploadBottleImage"

// Camera (Freenove ESP32-S3 WROOM with OV5640)
#define CAMERA_ENABLED true
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
#define CAM_PIN_VSYNC    6
#define CAM_PIN_HREF     7
#define CAM_PIN_PCLK    13
