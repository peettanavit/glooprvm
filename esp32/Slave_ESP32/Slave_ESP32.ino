// ============================================================
// Gloop RVM — Slave ESP32-S3
// Role: Cap camera (top view) ONLY — capture and upload
//
// Flow:
//   Poll Firestore every 500 ms for status == "ready"
//   On "ready" edge → capture cap JPEG → upload to Firebase
//   Storage → write last_capture.cap_storage_path to Firestore
//
// The Slave NEVER reads status for solenoid control, NEVER
// increments session_score, and NEVER touches any GPIO outputs.
// It is upload-only.
//
// Config: ../config_slave.h  (gitignored — copy from config_slave.example.h)
// Cert:   ../firebase_cert.h
// ============================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp_camera.h"
#include "ESP32_OV5640_AF.h"

#include "../config_slave.h"
#include "../firebase_cert.h"

namespace {

OV5640 ov5640;

const unsigned long WIFI_RETRY_MS          = 4000;
const unsigned long TOKEN_REFRESH_MARGIN_MS = 60000;
const unsigned long CAP_POLL_INTERVAL_MS   = 150;  // poll Firestore every 150 ms
const unsigned long CAP_COOLDOWN_MS        = 3000; // minimum gap between captures (safety)

WiFiClientSecure secureClient;
unsigned long lastWiFiRetryAt  = 0;
unsigned long lastPollAt       = 0;
unsigned long lastCaptureAt    = 0;
unsigned long tokenExpiresAt   = 0;

bool wifiBeginInProgress = false;
bool timeInitialized     = false;
bool cameraReady         = false;
bool lastStatusWasReady  = false; // edge-detect: trigger only once per "ready" event

String idToken;
String storedRefreshToken;

// ── Camera init (same pin map as Master — same hardware) ──────────────────────

bool initCamera() {
  if (cameraReady) return true;

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = CAM_PIN_Y2;
  config.pin_d1       = CAM_PIN_Y3;
  config.pin_d2       = CAM_PIN_Y4;
  config.pin_d3       = CAM_PIN_Y5;
  config.pin_d4       = CAM_PIN_Y6;
  config.pin_d5       = CAM_PIN_Y7;
  config.pin_d6       = CAM_PIN_Y8;
  config.pin_d7       = CAM_PIN_Y9;
  config.pin_xclk     = CAM_PIN_XCLK;
  config.pin_pclk     = CAM_PIN_PCLK;
  config.pin_vsync    = CAM_PIN_VSYNC;
  config.pin_href     = CAM_PIN_HREF;
  config.pin_sccb_sda = CAM_PIN_SIOD;
  config.pin_sccb_scl = CAM_PIN_SIOC;
  config.pin_pwdn     = CAM_PIN_PWDN;
  config.pin_reset    = CAM_PIN_RESET;
  config.xclk_freq_hz = 20000000;
  config.frame_size   = FRAMESIZE_SVGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count     = 2;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] init failed: 0x%x\n", err);
    return false;
  }
  neopixelWrite(48, 0, 0, 0); // LEDC from camera init disturbs GPIO48

  sensor_t* s = esp_camera_sensor_get();
  if (!s) {
    Serial.println("[CAM] sensor_get returned null — check wiring/pins");
    esp_camera_deinit();
    return false;
  }
  s->set_special_effect(s, 0);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_wb_mode(s, 0); // 0=auto
  s->set_exposure_ctrl(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_brightness(s, 0);
  s->set_saturation(s, 0);
  s->set_sharpness(s, 2);

  ov5640.start(s);
  if (ov5640.focusInit() == 0) {
    Serial.println("[CAM] AF firmware loaded");
    if (ov5640.autoFocusMode() == 0) {
      Serial.println("[CAM] AF continuous mode enabled");
    } else {
      Serial.println("[CAM] AF mode set failed");
    }
  } else {
    Serial.println("[CAM] AF init failed (not OV5640?)");
  }

  Serial.println("[CAM] ready");
  cameraReady = true;
  return true;
}

// ── URL-encode storage path (/ → %2F) for Firebase Storage REST API ──────────

String urlEncodePath(const String& path) {
  String encoded;
  encoded.reserve(path.length() + 32);
  for (size_t i = 0; i < path.length(); i++) {
    if (path[i] == '/') {
      encoded += "%2F";
    } else if (path[i] == ' ') {
      encoded += "%20";
    } else {
      encoded += path[i];
    }
  }
  return encoded;
}

// ── WiFi ──────────────────────────────────────────────────────────────────────

bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiBeginInProgress = false;
    return true;
  }
  const unsigned long now = millis();
  if (wifiBeginInProgress && now - lastWiFiRetryAt < WIFI_RETRY_MS) return false;
  lastWiFiRetryAt = now;
  wifiBeginInProgress = true;
  Serial.println("[WiFi] connecting...");
  WiFi.disconnect(true);
  delay(50);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  return false;
}

// ── NTP time sync (required for SSL certificate validation) ──────────────────

bool ensureTime() {
  if (timeInitialized) return true;
  if (WiFi.status() != WL_CONNECTED) return false;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  struct tm timeinfo;
  for (int i = 0; i < 20; i++) {
    if (getLocalTime(&timeinfo)) {
      timeInitialized = true;
      Serial.printf("[NTP] synced: %04d-%02d-%02d\n",
                    timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday);
      return true;
    }
    delay(500);
  }
  Serial.println("[NTP] sync failed — SSL may fail");
  return false;
}

// ── Firebase Auth ─────────────────────────────────────────────────────────────

bool parseAuthResponse(const String& body, bool refreshFlow) {
  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, body)) return false;

  if (refreshFlow) {
    if (!doc["id_token"].is<const char*>()) return false;
    idToken = doc["id_token"].as<const char*>();
    if (doc["refresh_token"].is<const char*>()) {
      storedRefreshToken = doc["refresh_token"].as<const char*>();
    }
    tokenExpiresAt = millis() + (unsigned long)atoi(doc["expires_in"] | "3600") * 1000UL;
    return true;
  }

  if (!doc["idToken"].is<const char*>() || !doc["refreshToken"].is<const char*>()) return false;
  idToken = doc["idToken"].as<const char*>();
  storedRefreshToken = doc["refreshToken"].as<const char*>();
  tokenExpiresAt = millis() + (unsigned long)atoi(doc["expiresIn"] | "3600") * 1000UL;
  return true;
}

bool signIn() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  const String url = String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + FIREBASE_API_KEY;

  DynamicJsonDocument payload(512);
  payload["email"] = SLAVE_MACHINE_EMAIL;
  payload["password"] = SLAVE_MACHINE_PASSWORD;
  payload["returnSecureToken"] = true;
  String body;
  serializeJson(payload, body);

  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("[Auth] signIn failed (%d): %s\n", code, resp.c_str());
    return false;
  }
  if (!parseAuthResponse(resp, false)) {
    Serial.println("[Auth] invalid signIn response");
    return false;
  }
  Serial.println("[Auth] slave signed in");
  return true;
}

bool doRefreshToken() {
  if (storedRefreshToken.isEmpty()) return false;
  HTTPClient http;
  const String url = String("https://securetoken.googleapis.com/v1/token?key=") + FIREBASE_API_KEY;
  const String form = String("grant_type=refresh_token&refresh_token=") + storedRefreshToken;

  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  int code = http.POST(form);
  String resp = http.getString();
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("[Auth] token refresh failed (%d)\n", code);
    return false;
  }
  return parseAuthResponse(resp, true);
}

bool ensureAuth() {
  if (idToken.isEmpty()) return signIn();
  if (tokenExpiresAt > millis() + TOKEN_REFRESH_MARGIN_MS) return true;
  if (doRefreshToken()) return true;
  idToken = "";
  return signIn();
}

// ── Firestore GET: read status + session_id ───────────────────────────────────

struct SlaveState {
  String status;
  String sessionId;
  bool slaveRestart = false;
  bool valid = false;
};

SlaveState firestoreGetState() {
  SlaveState out;
  const String url = String("https://firestore.googleapis.com/v1/projects/") +
                     FIREBASE_PROJECT_ID +
                     "/databases/(default)/documents/machines/" + MACHINE_ID;

  HTTPClient http;
  http.setTimeout(8000);
  http.begin(secureClient, url);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  int code = http.GET();
  String body = http.getString();
  http.end();

  if (code == 401) {
    idToken = "";
    return out;
  }
  if (code < 200 || code >= 300) {
    Serial.printf("[Firestore] GET failed (%d)\n", code);
    return out;
  }

  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, body)) return out;

  JsonObjectConst fields = doc["fields"].as<JsonObjectConst>();
  if (fields.isNull()) return out;

  if (fields["status"]["stringValue"].is<const char*>()) {
    out.status = fields["status"]["stringValue"].as<const char*>();
  }
  if (fields["session_id"]["stringValue"].is<const char*>()) {
    out.sessionId = fields["session_id"]["stringValue"].as<const char*>();
  }
  if (fields["slave_restart"]["booleanValue"].is<bool>()) {
    out.slaveRestart = fields["slave_restart"]["booleanValue"].as<bool>();
  }
  out.valid = true;
  return out;
}

bool firestoreClearSlaveRestart() {
  const String commitUrl = String("https://firestore.googleapis.com/v1/projects/") +
                           FIREBASE_PROJECT_ID +
                           "/databases/(default)/documents:commit";
  const String docPath = String("projects/") + FIREBASE_PROJECT_ID +
                         "/databases/(default)/documents/machines/" + MACHINE_ID;

  DynamicJsonDocument payload(512);
  JsonObject update = payload["writes"][0]["update"].to<JsonObject>();
  update["name"] = docPath;
  update["fields"]["slave_restart"]["booleanValue"] = false;
  payload["writes"][0]["updateMask"]["fieldPaths"][0] = "slave_restart";

  String payloadText;
  serializeJson(payload, payloadText);

  HTTPClient http;
  http.setTimeout(8000);
  http.begin(secureClient, commitUrl);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payloadText);
  http.end();
  return (code >= 200 && code < 300);
}

// ── Upload cap JPEG to Firebase Storage via REST API ─────────────────────────
//
// POST https://firebasestorage.googleapis.com/v0/b/{bucket}/o
//      ?uploadType=media&name={encoded_path}
// Body: raw JPEG bytes

bool uploadCapToStorage(camera_fb_t* fb, const String& storagePath) {
  const String encodedPath = urlEncodePath(storagePath);
  const String url = String("https://firebasestorage.googleapis.com/v0/b/") +
                     FIREBASE_STORAGE_BUCKET + "/o?uploadType=media&name=" + encodedPath;

  HTTPClient http;
  http.setTimeout(20000);
  http.begin(secureClient, url);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "image/jpeg");
  int code = http.POST(fb->buf, fb->len);
  String resp = http.getString();
  http.end();

  if (code == 401) {
    idToken = "";
    return false;
  }
  if (code < 200 || code >= 300) {
    Serial.printf("[Storage] upload failed (%d): %s\n", code, resp.c_str());
    return false;
  }
  Serial.printf("[Storage] cap uploaded: %s\n", storagePath.c_str());
  return true;
}

// ── Write cap_storage_path to Firestore (updateMask — other fields untouched) ─
//
// Uses dot notation in updateMask so only last_capture.cap_storage_path is
// updated. Other last_capture fields (label_storage_path, captured_at, etc.)
// written by the Master's Cloud Function are left intact.

bool firestoreWriteCapPath(const String& storagePath) {
  const String commitUrl = String("https://firestore.googleapis.com/v1/projects/") +
                           FIREBASE_PROJECT_ID +
                           "/databases/(default)/documents:commit";
  const String docPath = String("projects/") + FIREBASE_PROJECT_ID +
                         "/databases/(default)/documents/machines/" + MACHINE_ID;

  DynamicJsonDocument payload(1024);

  // Write 1: update last_capture.cap_storage_path only
  JsonObject update = payload["writes"][0]["update"].to<JsonObject>();
  update["name"] = docPath;
  update["fields"]["last_capture"]["mapValue"]["fields"]
        ["cap_storage_path"]["stringValue"] = storagePath;
  payload["writes"][0]["updateMask"]["fieldPaths"][0] = "last_capture.cap_storage_path";

  // Write 2: server timestamp on updatedAt
  JsonObject transform = payload["writes"][1]["transform"].to<JsonObject>();
  transform["document"] = docPath;
  JsonObject ft = transform["fieldTransforms"][0].to<JsonObject>();
  ft["fieldPath"] = "updatedAt";
  ft["setToServerValue"] = "REQUEST_TIME";

  String payloadText;
  serializeJson(payload, payloadText);

  HTTPClient http;
  http.setTimeout(8000);
  http.begin(secureClient, commitUrl);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payloadText);
  String resp = http.getString();
  http.end();

  if (code == 401) {
    idToken = "";
    return false;
  }
  if (code < 200 || code >= 300) {
    Serial.printf("[Firestore] cap_storage_path write failed (%d): %s\n", code, resp.c_str());
    return false;
  }
  Serial.println("[Firestore] cap_storage_path written");
  return true;
}

// ── Main capture-and-upload sequence ─────────────────────────────────────────

void captureAndUploadCap(const String& sessionId) {
  if (!cameraReady) {
    Serial.println("[Slave] camera not ready — skipping");
    return;
  }

  // Wait up to 200 ms for AF to confirm focus (continuous AF already running)
  {
    const unsigned long afStart = millis();
    while (millis() - afStart < 200) {
      if (ov5640.getFWStatus() == FW_STATUS_S_FOCUSED) {
        Serial.println("[CAM] AF focused");
        break;
      }
      delay(30);
    }
  }

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[Slave] capture failed");
    return;
  }
  Serial.printf("[Slave] captured %u bytes\n", fb->len);

  // Build storage path: captures/{machineId}/{sessionId}/{timestamp}_cap.jpg
  struct tm timeinfo;
  char timestamp[20];
  if (getLocalTime(&timeinfo)) {
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%d_%H-%M-%S", &timeinfo);
  } else {
    // Fallback if NTP not ready (should not happen — ensureTime() guards this)
    snprintf(timestamp, sizeof(timestamp), "%lu", millis());
  }
  const String storagePath = String("captures/") + MACHINE_ID + "/" +
                             sessionId + "/caps/" + timestamp + "_cap.jpg";

  if (uploadCapToStorage(fb, storagePath)) {
    firestoreWriteCapPath(storagePath);
  }

  esp_camera_fb_return(fb);
  lastCaptureAt = millis();
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Gloop Slave ESP32-S3 starting...");

  secureClient.setCACert(GOOGLE_ROOT_CA);
  initCamera(); // persistent init — stays on for the lifetime of the device
  ensureWiFi();
}

void loop() {
  if (!ensureWiFi()) { delay(50); return; }
  if (!ensureTime()) { delay(400); return; }
  if (!ensureAuth()) { delay(400); return; }

  const unsigned long now = millis();
  if (now - lastPollAt < CAP_POLL_INTERVAL_MS) { delay(10); return; }
  lastPollAt = now;

  SlaveState state = firestoreGetState();
  if (!state.valid) { delay(100); return; }

  if (state.slaveRestart) {
    Serial.println("[Slave] restart requested from admin — restarting...");
    firestoreClearSlaveRestart();
    delay(200);
    ESP.restart();
  }

  const bool isReady = (state.status == "ready");

  // Edge detect: only trigger once per "ready" transition, and respect cooldown
  if (isReady && !lastStatusWasReady && (now - lastCaptureAt >= CAP_COOLDOWN_MS)) {
    Serial.println("[Slave] status=ready detected — capturing cap image");
    captureAndUploadCap(state.sessionId);
  }

  lastStatusWasReady = isReady;
  delay(5);
}
