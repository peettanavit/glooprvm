#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp_camera.h"
#include "ESP32_OV5640_AF.h"

#include "../config.h"
#include "../firebase_cert.h"

namespace {

OV5640 ov5640;

const unsigned long WIFI_RETRY_MS = 4000;
const unsigned long REJECT_HOLD_MS = 1200;
const unsigned long TOKEN_REFRESH_MARGIN_MS = 60000;
const unsigned long SENSOR_DEBOUNCE_MS = 20;
const unsigned long SOLENOID_PULSE_MS = 600;

const int SCORE_SMALL = 1;
const int SCORE_MEDIUM = 2;
const int SCORE_LARGE = 3;

WiFiClientSecure secureClient;
unsigned long lastWiFiRetryAt = 0;
unsigned long lastFirestorePollAt = 0;
unsigned long tokenExpiresAt = 0;
unsigned long rejectUntil = 0;
unsigned long lastSensorReadAt = 0;
bool lastSensorState = false;
bool wifiBeginInProgress = false;
bool timeInitialized = false;

String idToken;
String refreshToken;

struct MachineState {
  String status = "IDLE";
  String currentUser = "";
  int sessionScore = 0;
  String sessionId = "";
  bool exists = false;
};

MachineState machineState;

volatile bool readyButtonInterrupt = false;
volatile bool slotSmallInterrupt = false;

bool cameraReady = false;
unsigned long solenoidOnAt = 0;
bool solenoidActive = false;

bool isActiveStatus(const String& status) {
  return status == "READY" || status == "PROCESSING" || status == "REJECTED";
}

bool isSessionActive(const MachineState& state) {
  return isActiveStatus(state.status) && state.currentUser.length() > 0;
}

bool initCamera() {
  if (!CAMERA_ENABLED) return false;
  if (cameraReady) return true; // already initialized — skip

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = CAM_PIN_Y2;
  config.pin_d1 = CAM_PIN_Y3;
  config.pin_d2 = CAM_PIN_Y4;
  config.pin_d3 = CAM_PIN_Y5;
  config.pin_d4 = CAM_PIN_Y6;
  config.pin_d5 = CAM_PIN_Y7;
  config.pin_d6 = CAM_PIN_Y8;
  config.pin_d7 = CAM_PIN_Y9;
  config.pin_xclk = CAM_PIN_XCLK;
  config.pin_pclk = CAM_PIN_PCLK;
  config.pin_vsync = CAM_PIN_VSYNC;
  config.pin_href = CAM_PIN_HREF;
  config.pin_sccb_sda = CAM_PIN_SIOD;
  config.pin_sccb_scl = CAM_PIN_SIOC;
  config.pin_pwdn = CAM_PIN_PWDN;
  config.pin_reset = CAM_PIN_RESET;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_SVGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 2;

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

// Soft reset: deinit + reinit without full power cycle
bool reinitCamera() {
  cameraReady = false;
  esp_camera_deinit();
  delay(100);
  return initCamera();
}

bool uploadFrameToCloudFunction(camera_fb_t* fb, const String& userId, const String& sessionId) {
  if (!CAMERA_ENABLED || fb == nullptr) {
    return false;
  }
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  http.setTimeout(20000);
  http.begin(secureClient, CF_UPLOAD_URL);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Api-Key", CF_UPLOAD_API_KEY);
  http.addHeader("X-Machine-Id", MACHINE_ID);
  if (userId.length()) {
    http.addHeader("X-User-Id", userId);
  }
  if (sessionId.length()) {
    http.addHeader("X-Session-Id", sessionId);
  }

  int code = http.POST(fb->buf, fb->len);
  String body = http.getString();
  http.end();

  if (code == 401) {
    Serial.println("[CAM] upload rejected (401) — check CF_UPLOAD_API_KEY in config.h");
    return false;
  }
  if (code == 413) {
    Serial.println("[CAM] upload rejected (413) — image too large for Cloud Function");
    return false;
  }
  if (code < 200 || code >= 300) {
    Serial.printf("[CAM] upload failed (%d): %s\n", code, body.c_str());
    return false;
  }

  Serial.println("[CAM] upload ok");
  return true;
}

String machineDocUrl() {
  return String("https://firestore.googleapis.com/v1/projects/") +
         FIREBASE_PROJECT_ID +
         "/databases/(default)/documents/machines/" +
         MACHINE_ID;
}

bool parseIntField(JsonVariantConst field, int& output) {
  if (!field.is<JsonObjectConst>()) {
    return false;
  }
  JsonVariantConst integerValue = field["integerValue"];
  if (!integerValue.is<const char*>()) {
    return false;
  }
  output = atoi(integerValue.as<const char*>());
  return true;
}

bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiBeginInProgress = false;
    return true;
  }

  const unsigned long now = millis();
  if (wifiBeginInProgress && now - lastWiFiRetryAt < WIFI_RETRY_MS) {
    return false;
  }

  lastWiFiRetryAt = now;
  wifiBeginInProgress = true;
  Serial.println("[WiFi] connecting...");
  WiFi.disconnect(true);
  delay(50);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  return false;
}

bool ensureTime() {
  if (timeInitialized) return true;
  if (WiFi.status() != WL_CONNECTED) return false;

  configTime(0, 0, "pool.ntp.org", "time.google.com");
  struct tm timeinfo;
  for (int i = 0; i < 20; i++) {
    if (getLocalTime(&timeinfo)) {
      timeInitialized = true;
      Serial.printf("[NTP] time synced: %04d-%02d-%02d\n",
                    timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday);
      return true;
    }
    delay(500);
  }
  Serial.println("[NTP] time sync failed — SSL may fail");
  return false;
}

bool parseAuthResponse(const String& body, bool refreshFlow) {
  DynamicJsonDocument doc(4096);
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.printf("[Auth] JSON parse failed: %s\n", err.c_str());
    return false;
  }

  if (refreshFlow) {
    if (!doc["id_token"].is<const char*>()) {
      return false;
    }
    idToken = doc["id_token"].as<const char*>();
    if (doc["refresh_token"].is<const char*>()) {
      refreshToken = doc["refresh_token"].as<const char*>();
    }
    int expiresInSec = atoi(doc["expires_in"] | "3600");
    tokenExpiresAt = millis() + (unsigned long) expiresInSec * 1000UL;
    return true;
  }

  if (!doc["idToken"].is<const char*>() || !doc["refreshToken"].is<const char*>()) {
    return false;
  }
  idToken = doc["idToken"].as<const char*>();
  refreshToken = doc["refreshToken"].as<const char*>();
  int expiresInSec = atoi(doc["expiresIn"] | "3600");
  tokenExpiresAt = millis() + (unsigned long) expiresInSec * 1000UL;
  return true;
}

bool signInMachineAccount() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  const String url = String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + FIREBASE_API_KEY;

  DynamicJsonDocument payload(512);
  payload["email"] = MACHINE_EMAIL;
  payload["password"] = MACHINE_PASSWORD;
  payload["returnSecureToken"] = true;

  String payloadText;
  serializeJson(payload, payloadText);

  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payloadText);
  String body = http.getString();
  http.end();

  if (code < 200 || code >= 300) {
    char sslErr[128] = "";
    secureClient.lastError(sslErr, sizeof(sslErr));
    Serial.printf("[Auth] signIn failed (%d): %s | heap=%u ssl=%s\n",
                  code, body.c_str(), ESP.getFreeHeap(), sslErr);
    return false;
  }

  if (!parseAuthResponse(body, false)) {
    Serial.println("[Auth] invalid signIn response");
    return false;
  }

  Serial.println("[Auth] machine signed in");
  return true;
}

bool refreshIdToken() {
  if (WiFi.status() != WL_CONNECTED || refreshToken.isEmpty()) {
    return false;
  }

  HTTPClient http;
  const String url = String("https://securetoken.googleapis.com/v1/token?key=") + FIREBASE_API_KEY;
  const String form = String("grant_type=refresh_token&refresh_token=") + refreshToken;

  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  int code = http.POST(form);
  String body = http.getString();
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("[Auth] token refresh failed (%d): %s\n", code, body.c_str());
    return false;
  }

  if (!parseAuthResponse(body, true)) {
    Serial.println("[Auth] invalid refresh response");
    return false;
  }

  Serial.println("[Auth] token refreshed");
  return true;
}

bool ensureAuth() {
  if (idToken.isEmpty()) {
    return signInMachineAccount();
  }

  const unsigned long now = millis();
  if (tokenExpiresAt > now + TOKEN_REFRESH_MARGIN_MS) {
    return true;
  }

  if (refreshIdToken()) {
    return true;
  }

  // Fallback: full sign-in again
  idToken = "";
  return signInMachineAccount();
}

bool firestoreGet(MachineState& outState) {
  HTTPClient http;
  http.setTimeout(8000);
  http.begin(secureClient, machineDocUrl());
  http.addHeader("Authorization", String("Bearer ") + idToken);
  int code = http.GET();
  String body = http.getString();
  http.end();

  if (code == 404) {
    outState = MachineState{};
    outState.exists = false;
    return true;
  }

  if (code == 401) {
    Serial.println("[Firestore] GET 401 — forcing token refresh");
    idToken = "";
    return false;
  }

  if (code < 200 || code >= 300) {
    Serial.printf("[Firestore] GET failed (%d): %s\n", code, body.c_str());
    return false;
  }

  DynamicJsonDocument doc(8192);
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.printf("[Firestore] GET parse failed: %s\n", err.c_str());
    return false;
  }

  JsonObjectConst fields = doc["fields"].as<JsonObjectConst>();
  if (fields.isNull()) {
    return false;
  }

  MachineState parsed;
  parsed.exists = true;

  if (fields["status"]["stringValue"].is<const char*>()) {
    parsed.status = fields["status"]["stringValue"].as<const char*>();
  }
  if (fields["current_user"]["stringValue"].is<const char*>()) {
    parsed.currentUser = fields["current_user"]["stringValue"].as<const char*>();
  }
  if (fields["session_id"]["stringValue"].is<const char*>()) {
    parsed.sessionId = fields["session_id"]["stringValue"].as<const char*>();
  }

  int score = 0;
  if (parseIntField(fields["session_score"], score)) {
    parsed.sessionScore = score;
  }

  outState = parsed;
  return true;
}

bool firestorePatchStatus(const String& status) {
  HTTPClient http;
  const String url = String("https://firestore.googleapis.com/v1/projects/") +
                     FIREBASE_PROJECT_ID +
                     "/databases/(default)/documents:commit";
  const String docPath = String("projects/") + FIREBASE_PROJECT_ID +
                         "/databases/(default)/documents/machines/" + MACHINE_ID;

  DynamicJsonDocument payload(768);
  JsonObject update = payload["writes"][0]["update"].to<JsonObject>();
  update["name"] = docPath;
  update["fields"]["status"]["stringValue"] = status;
  payload["writes"][0]["updateMask"]["fieldPaths"][0] = "status";
  JsonObject transform = payload["writes"][1]["transform"].to<JsonObject>();
  transform["document"] = docPath;
  JsonObject ft = transform["fieldTransforms"][0].to<JsonObject>();
  ft["fieldPath"] = "updatedAt";
  ft["setToServerValue"] = "REQUEST_TIME";

  String payloadText;
  serializeJson(payload, payloadText);

  http.setTimeout(8000);
  http.begin(secureClient, url);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payloadText);
  String body = http.getString();
  http.end();

  if (code == 401) {
    Serial.println("[Firestore] patch 401 — forcing token refresh");
    idToken = "";
    return false;
  }
  if (code < 200 || code >= 300) {
    Serial.printf("[Firestore] patch status failed (%d): %s\n", code, body.c_str());
    return false;
  }
  return true;
}

bool firestoreSlotEvent(const String& size) {
  int score = 0;
  if (size == "SMALL") score = SCORE_SMALL;
  else if (size == "MEDIUM") score = SCORE_MEDIUM;
  else if (size == "LARGE") score = SCORE_LARGE;

  HTTPClient http;
  const String url = String("https://firestore.googleapis.com/v1/projects/") +
                     FIREBASE_PROJECT_ID +
                     "/databases/(default)/documents:commit";
  const String docPath = String("projects/") + FIREBASE_PROJECT_ID +
                         "/databases/(default)/documents/machines/" + MACHINE_ID;

  DynamicJsonDocument payload(1536);

  // Write 1: increment slotCounts.<size> + session_score + set timestamps
  JsonObject transform = payload["writes"][0]["transform"].to<JsonObject>();
  transform["document"] = docPath;
  JsonObject ft0 = transform["fieldTransforms"][0].to<JsonObject>();
  ft0["fieldPath"] = String("slotCounts.") + size;
  ft0["increment"]["integerValue"] = "1";
  JsonObject ft1 = transform["fieldTransforms"][1].to<JsonObject>();
  ft1["fieldPath"] = "session_score";
  ft1["increment"]["integerValue"] = String(score);
  JsonObject ft2 = transform["fieldTransforms"][2].to<JsonObject>();
  ft2["fieldPath"] = "updatedAt";
  ft2["setToServerValue"] = "REQUEST_TIME";
  JsonObject ft3 = transform["fieldTransforms"][3].to<JsonObject>();
  ft3["fieldPath"] = "lastSlotEvent.timestamp";
  ft3["setToServerValue"] = "REQUEST_TIME";

  // Write 2: update lastSlotEvent fields + status
  JsonObject update = payload["writes"][1]["update"].to<JsonObject>();
  update["name"] = docPath;
  update["fields"]["lastSlotEvent"]["mapValue"]["fields"]["size"]["stringValue"] = size;
  update["fields"]["lastSlotEvent"]["mapValue"]["fields"]["machineId"]["stringValue"] = MACHINE_ID;
  update["fields"]["status"]["stringValue"] = "READY";
  payload["writes"][1]["updateMask"]["fieldPaths"][0] = "lastSlotEvent";
  payload["writes"][1]["updateMask"]["fieldPaths"][1] = "status";

  String payloadText;
  serializeJson(payload, payloadText);

  http.setTimeout(8000);
  http.begin(secureClient, url);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payloadText);
  String body = http.getString();
  http.end();

  if (code == 401) {
    Serial.println("[Firestore] slot event 401 — forcing token refresh");
    idToken = "";
    return false;
  }
  if (code < 200 || code >= 300) {
    Serial.printf("[Firestore] slot event failed (%d): %s\n", code, body.c_str());
    return false;
  }
  Serial.printf("[Slot] %s +1 score+%d, status->READY\n", size.c_str(), score);
  return true;
}

bool readSensorEdgeRaw() {
  const unsigned long now = millis();
  if (now - lastSensorReadAt < SENSOR_DEBOUNCE_MS) {
    return false;
  }
  lastSensorReadAt = now;

  const int raw = digitalRead(SENSOR_PIN);
  const bool active = SENSOR_ACTIVE_HIGH ? (raw == HIGH) : (raw == LOW);
  const bool edge = active && !lastSensorState;
  lastSensorState = active;
  return edge;
}

void IRAM_ATTR onReadyButtonInterrupt() {
  readyButtonInterrupt = true;
}

void IRAM_ATTR onSlotSmallInterrupt() {
  slotSmallInterrupt = true;
}

// Non-blocking solenoid: call startSolenoid() to open, loop() closes it via updateSolenoid()
void startSolenoid() {
  digitalWrite(SOLENOID_PIN, HIGH);
  solenoidOnAt = millis();
  solenoidActive = true;
}

void updateSolenoid() {
  if (solenoidActive && millis() - solenoidOnAt >= SOLENOID_PULSE_MS) {
    digitalWrite(SOLENOID_PIN, LOW);
    solenoidActive = false;
  }
}

void handleBottleInsert() {
  if (CAMERA_ENABLED) {
    bool captured = false;
    bool uploaded = false;

    // Camera is kept alive since setup() — no init/deinit per bottle.
    // On first call or after a soft reset, cameraReady may be false.
    if (!cameraReady && !initCamera()) {
      Serial.println("[RVM] camera unavailable, using local logic");
    } else {
      // Continuous AF has been running since setup(), focus is usually locked.
      // Wait at most 500 ms for confirmation — no warmup needed.
      {
        const unsigned long afStart = millis();
        while (millis() - afStart < 500) {
          uint8_t st = ov5640.getFWStatus();
          if (st == FW_STATUS_S_FOCUSED) {
            Serial.println("[CAM] AF focused");
            break;
          }
          delay(50);
        }
      }

      camera_fb_t* fb = esp_camera_fb_get();
      if (!fb) {
        Serial.println("[CAM] capture failed — attempting soft reinit");
        if (reinitCamera()) fb = esp_camera_fb_get();
      }

      if (!fb) {
        Serial.println("[CAM] capture still failed after reinit");
      } else {
        captured = true;
        Serial.printf("[CAM] captured %u bytes\n", fb->len);
        uploaded = uploadFrameToCloudFunction(fb, machineState.currentUser, machineState.sessionId);
        esp_camera_fb_return(fb);
      }
    }

    if (captured && uploaded) {
      // Cloud Function handles status update (PROCESSING or REJECTED).
      // Poll Firestore until CF writes a result (max 10 s).
      Serial.println("[RVM] waiting for AI result...");
      const unsigned long aiWaitStart = millis();
      String aiStatus = "";
      while (millis() - aiWaitStart < 10000UL) {
        delay(400);
        MachineState latest;
        if (firestoreGet(latest)) {
          if (latest.status == "PROCESSING" || latest.status == "REJECTED") {
            aiStatus = latest.status;
            machineState = latest;
            break;
          }
        }
      }

      if (aiStatus == "PROCESSING") {
        startSolenoid();
        Serial.println("[RVM] AI accepted -> solenoid open, status PROCESSING");
      } else if (aiStatus == "REJECTED") {
        rejectUntil = millis() + REJECT_HOLD_MS;
        Serial.println("[RVM] AI rejected bottle");
      } else {
        // Timeout: default to accept so user is not blocked
        startSolenoid();
        firestorePatchStatus("PROCESSING");
        machineState.status = "PROCESSING";
        Serial.println("[RVM] AI timeout, defaulting to accept");
      }
      return;
    }
    // Camera capture or upload failed — fall through to local logic
    Serial.println("[RVM] camera/upload failed, using local logic");
  }

  // No camera or upload failed: accept unconditionally (no AI check)
  startSolenoid();
  if (firestorePatchStatus("PROCESSING")) {
    machineState.status = "PROCESSING";
    Serial.println("[RVM] bottle accepted (no AI), status->PROCESSING");
  }
}

void setupPins() {
  pinMode(SOLENOID_PIN, OUTPUT);
  digitalWrite(SOLENOID_PIN, LOW);
  pinMode(SENSOR_PIN, INPUT_PULLUP);
  pinMode(READY_BUTTON_PIN, INPUT_PULLUP);
  pinMode(SLOT_PIN_SMALL, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(READY_BUTTON_PIN), onReadyButtonInterrupt, FALLING);
  attachInterrupt(digitalPinToInterrupt(SLOT_PIN_SMALL), onSlotSmallInterrupt, FALLING);
}

void testCamera() {
  if (!CAMERA_ENABLED) return;
  Serial.println("[CAM] test capture...");
  if (!cameraReady) {
    Serial.println("[CAM] not ready — init failed during setup");
    return;
  }
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] test capture failed");
  } else {
    Serial.printf("[CAM] OK — %u bytes (%dx%d)\n", fb->len, fb->width, fb->height);
    esp_camera_fb_return(fb);
  }
  // No deinit — camera stays alive for persistent use
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Gloop ESP32 edge starting...");

  secureClient.setCACert(GOOGLE_ROOT_CA);
  setupPins();
  initCamera();  // persistent init — stays on for the lifetime of the device
  testCamera();  // sanity check (no deinit)
  ensureWiFi();
}

void loop() {
  updateSolenoid(); // close solenoid after SOLENOID_PULSE_MS without blocking

  if (!ensureWiFi()) {
    delay(50);
    return;
  }

  if (!ensureTime()) {
    delay(400);
    return;
  }

  if (!ensureAuth()) {
    delay(400);
    return;
  }

  const unsigned long now = millis();
  const unsigned long pollInterval = isSessionActive(machineState) ? 200UL : 2000UL;
  if (now - lastFirestorePollAt >= pollInterval) {
    lastFirestorePollAt = now;
    MachineState latest;
    if (firestoreGet(latest)) {
      if (latest.status != machineState.status) {
        Serial.printf("[State] %s -> %s\n", machineState.status.c_str(), latest.status.c_str());
      }
      machineState = latest;
    }
  }

  if (!machineState.exists) {
    delay(30);
    return;
  }

  if (machineState.status == "REJECTED" && rejectUntil > 0 && millis() >= rejectUntil) {
    rejectUntil = 0;
    if (firestorePatchStatus("READY")) {
      machineState.status = "READY";
    }
  }

  if (readyButtonInterrupt) {
    readyButtonInterrupt = false;
    if (machineState.status == "PROCESSING" && firestorePatchStatus("READY")) {
      machineState.status = "READY";
    }
  }

  if (!isSessionActive(machineState) && readSensorEdgeRaw()) {
    if (firestorePatchStatus("IDLE")) {
      machineState.status = "IDLE";
    }
    delay(80);
    return;
  }

  if (!isSessionActive(machineState)) {
    delay(20);
    return;
  }

  if (machineState.status == "READY") {
    handleBottleInsert();
  }

  if (slotSmallInterrupt) {
    slotSmallInterrupt = false;
    Serial.printf("[Slot] SMALL triggered (status=%s)\n", machineState.status.c_str());
    if (machineState.status == "PROCESSING") {
      if (firestoreSlotEvent("SMALL")) {
        machineState.status = "READY";
        machineState.sessionScore += SCORE_SMALL;
      }
    } else {
      Serial.println("[Slot] SMALL ignored: not PROCESSING");
    }
  }

  delay(5);
}
