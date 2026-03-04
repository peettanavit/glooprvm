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
#define SOLENOID_PIN 18
#define SENSOR_PIN 23
#define SENSOR_ACTIVE_HIGH true

// Set true to run without real sensor (random insert simulation)
#define DEV_SIMULATION false
#define SIM_BOTTLE_PROBABILITY 0.25f
