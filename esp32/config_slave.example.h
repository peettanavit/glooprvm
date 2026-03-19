#pragma once

// Wi-Fi credentials (same network as Master)
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Firebase Web API config (same project as Master)
#define FIREBASE_API_KEY "YOUR_FIREBASE_WEB_API_KEY"
#define FIREBASE_PROJECT_ID "glooprvm"

// Dedicated Slave machine account in Firebase Authentication
// Create a separate account in Firebase Auth Console and add credentials here.
// Example: machine-slave-gloop01@yourdomain.com
#define SLAVE_MACHINE_EMAIL "machine-slave-gloop01@example.com"
#define SLAVE_MACHINE_PASSWORD "YOUR_SLAVE_MACHINE_PASSWORD"

// Firebase Storage bucket (used for direct cap image uploads)
#define FIREBASE_STORAGE_BUCKET "glooprvm.firebasestorage.app"

// Firestore machine document id: /machines/{MACHINE_ID}
// Must match the Master's MACHINE_ID — both cameras serve the same machine.
#define MACHINE_ID "Gloop_01"

// Reset button pin — press to ESP.restart()
#define RESET_BUTTON_PIN 47

// Camera pin map (Freenove ESP32-S3 WROOM with OV5640)
// These must match the physical wiring on the Slave board.
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
