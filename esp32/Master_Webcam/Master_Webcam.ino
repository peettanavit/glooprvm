// ============================================================
// Gloop RVM — Master ESP32-S3 (Webcam Mode)
// Role: Solenoid + Scoring — ไม่มีกล้อง ESP32
//
// Flow:
//   trigger_source set → set status="ready" → PC listener_webcam.py
//   ถ่ายรูปจาก USB webcam → AI → เขียน status=PROCESSING/REJECTED
//   → PROCESSING: open solenoid | REJECTED: hold 1.2 s → READY
//   → Slot sensor fires: increment session_score, status→READY
//
// Config: ../config.h  (gitignored — copy from config.example.h)
// Cert:   ../firebase_cert.h
// ============================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#include "../config.h"
#include "../firebase_cert.h"

namespace {

const unsigned long WIFI_RETRY_MS = 4000;
const unsigned long REJECT_HOLD_MS = 1200;
const unsigned long TOKEN_REFRESH_MARGIN_MS = 60000;
const unsigned long SOLENOID_PULSE_MS = 600;

WiFiClientSecure secureClient;
unsigned long lastWiFiRetryAt = 0;
unsigned long lastFirestorePollAt = 0;
unsigned long tokenExpiresAt = 0;
unsigned long rejectUntil = 0;
bool wifiBeginInProgress = false;
bool timeInitialized = false;

String idToken;
String refreshToken;

struct MachineState {
  String status = "IDLE";
  String currentUser = "";
  int sessionScore = 0;
  String sessionId = "";
  String triggerSource = "";
  bool exists = false;
};

MachineState machineState;

volatile bool readyButtonInterrupt = false;
volatile bool slotSmallInterrupt  = false;
volatile bool slotMediumInterrupt = false;
volatile bool slotLargeInterrupt  = false;

unsigned long solenoidOnAt = 0;
bool solenoidActive = false;

bool isActiveStatus(const String& status) {
  return status == "READY" || status == "PROCESSING" || status == "REJECTED";
}

bool isSessionActive(const MachineState& state) {
  return isActiveStatus(state.status) && state.currentUser.length() > 0;
}

String machineDocUrl() {
  return String("https://firestore.googleapis.com/v1/projects/") +
         FIREBASE_PROJECT_ID +
         "/databases/(default)/documents/machines/" +
         MACHINE_ID;
}

bool parseIntField(JsonVariantConst field, int& output) {
  if (!field.is<JsonObjectConst>()) return false;
  JsonVariantConst integerValue = field["integerValue"];
  if (!integerValue.is<const char*>()) return false;
  output = atoi(integerValue.as<const char*>());
  return true;
}

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
    if (!doc["id_token"].is<const char*>()) return false;
    idToken = doc["id_token"].as<const char*>();
    if (doc["refresh_token"].is<const char*>()) refreshToken = doc["refresh_token"].as<const char*>();
    int expiresInSec = atoi(doc["expires_in"] | "3600");
    tokenExpiresAt = millis() + (unsigned long) expiresInSec * 1000UL;
    return true;
  }

  if (!doc["idToken"].is<const char*>() || !doc["refreshToken"].is<const char*>()) return false;
  idToken = doc["idToken"].as<const char*>();
  refreshToken = doc["refreshToken"].as<const char*>();
  int expiresInSec = atoi(doc["expiresIn"] | "3600");
  tokenExpiresAt = millis() + (unsigned long) expiresInSec * 1000UL;
  return true;
}

bool signInMachineAccount() {
  if (WiFi.status() != WL_CONNECTED) return false;

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
  if (WiFi.status() != WL_CONNECTED || refreshToken.isEmpty()) return false;

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
  if (idToken.isEmpty()) return signInMachineAccount();

  const unsigned long now = millis();
  if (tokenExpiresAt > now + TOKEN_REFRESH_MARGIN_MS) return true;

  if (refreshIdToken()) return true;

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
  if (fields.isNull()) return false;

  MachineState parsed;
  parsed.exists = true;

  if (fields["status"]["stringValue"].is<const char*>())
    parsed.status = fields["status"]["stringValue"].as<const char*>();
  if (fields["current_user"]["stringValue"].is<const char*>())
    parsed.currentUser = fields["current_user"]["stringValue"].as<const char*>();
  if (fields["session_id"]["stringValue"].is<const char*>())
    parsed.sessionId = fields["session_id"]["stringValue"].as<const char*>();
  if (fields["trigger_source"]["stringValue"].is<const char*>())
    parsed.triggerSource = fields["trigger_source"]["stringValue"].as<const char*>();

  int score = 0;
  if (parseIntField(fields["session_score"], score)) parsed.sessionScore = score;

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

  if (code == 401) { idToken = ""; return false; }
  if (code < 200 || code >= 300) {
    Serial.printf("[Firestore] patch status failed (%d): %s\n", code, body.c_str());
    return false;
  }
  return true;
}

bool firestoreClearTrigger() {
  HTTPClient http;
  const String url = String("https://firestore.googleapis.com/v1/projects/") +
                     FIREBASE_PROJECT_ID +
                     "/databases/(default)/documents:commit";
  const String docPath = String("projects/") + FIREBASE_PROJECT_ID +
                         "/databases/(default)/documents/machines/" + MACHINE_ID;

  DynamicJsonDocument payload(512);
  JsonObject update = payload["writes"][0]["update"].to<JsonObject>();
  update["name"] = docPath;
  update["fields"]["trigger_source"]["stringValue"] = "";
  payload["writes"][0]["updateMask"]["fieldPaths"][0] = "trigger_source";

  String payloadText;
  serializeJson(payload, payloadText);

  http.setTimeout(8000);
  http.begin(secureClient, url);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payloadText);
  http.end();

  if (code == 401) { idToken = ""; return false; }
  return (code >= 200 && code < 300);
}

bool firestoreSlotEvent(const String& size) {
  HTTPClient http;
  const String url = String("https://firestore.googleapis.com/v1/projects/") +
                     FIREBASE_PROJECT_ID +
                     "/databases/(default)/documents:commit";
  const String docPath = String("projects/") + FIREBASE_PROJECT_ID +
                         "/databases/(default)/documents/machines/" + MACHINE_ID;

  DynamicJsonDocument payload(1536);

  // Note: session_score is incremented by the Python AI listener based on the AI result
  // (1 = lipo/SMALL, 2 = cvitt/MEDIUM, 3 = m150/LARGE), not by the physical slot sensor.
  JsonObject transform = payload["writes"][0]["transform"].to<JsonObject>();
  transform["document"] = docPath;
  JsonObject ft0 = transform["fieldTransforms"][0].to<JsonObject>();
  ft0["fieldPath"] = String("slotCounts.") + size;
  ft0["increment"]["integerValue"] = "1";
  JsonObject ft2 = transform["fieldTransforms"][1].to<JsonObject>();
  ft2["fieldPath"] = "updatedAt";
  ft2["setToServerValue"] = "REQUEST_TIME";
  JsonObject ft3 = transform["fieldTransforms"][2].to<JsonObject>();
  ft3["fieldPath"] = "lastSlotEvent.timestamp";
  ft3["setToServerValue"] = "REQUEST_TIME";

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

  if (code == 401) { idToken = ""; return false; }
  if (code < 200 || code >= 300) {
    Serial.printf("[Firestore] slot event failed (%d): %s\n", code, body.c_str());
    return false;
  }
  Serial.printf("[Slot] %s +1, status->READY\n", size.c_str());
  return true;
}

void IRAM_ATTR onReadyButtonInterrupt() { readyButtonInterrupt = true; }
void IRAM_ATTR onSlotSmallInterrupt()   { slotSmallInterrupt  = true; }
void IRAM_ATTR onSlotMediumInterrupt()  { slotMediumInterrupt = true; }
void IRAM_ATTR onSlotLargeInterrupt()   { slotLargeInterrupt  = true; }

void startSolenoid() {
  digitalWrite(SOLENOID_PIN, LOW); // active-low relay: LOW = energised = solenoid open
  solenoidOnAt = millis();
  solenoidActive = true;
}

void updateSolenoid() {
  if (solenoidActive && millis() - solenoidOnAt >= SOLENOID_PULSE_MS) {
    digitalWrite(SOLENOID_PIN, HIGH); // active-low relay: HIGH = de-energised = solenoid closed
    solenoidActive = false;
  }
}

void handleBottleInsert() {
  firestoreClearTrigger();
  machineState.triggerSource = "";
  Serial.printf("[RVM] trigger consumed — setting status=ready for PC listener\n");

  if (!firestorePatchStatus("ready")) {
    Serial.println("[RVM] failed to set status=ready");
    return;
  }

  const unsigned long aiWaitStart = millis();
  String aiStatus = "";
  int pollCount = 0;
  while (millis() - aiWaitStart < 10000UL) {
    delay(400);
    pollCount++;
    MachineState latest;
    if (firestoreGet(latest)) {
      Serial.printf("[RVM] poll #%d (%.1fs): status=%s\n",
        pollCount,
        (millis() - aiWaitStart) / 1000.0f,
        latest.status.c_str());
      if (latest.status == "PROCESSING" || latest.status == "REJECTED") {
        aiStatus = latest.status;
        machineState = latest;
        break;
      }
    }
  }

  if (aiStatus == "PROCESSING") {
    startSolenoid();
    Serial.println("[RVM] AI accepted → solenoid open");
  } else if (aiStatus == "REJECTED") {
    rejectUntil = millis() + REJECT_HOLD_MS;
    Serial.println("[RVM] AI rejected bottle");
  } else {
    rejectUntil = millis() + REJECT_HOLD_MS;
    firestorePatchStatus("REJECTED");
    machineState.status = "REJECTED";
    Serial.printf("[RVM] AI timeout after %d polls (10s) — defaulting to REJECT\n", pollCount);
  }
}

void setupPins() {
  pinMode(SOLENOID_PIN, OUTPUT);
  digitalWrite(SOLENOID_PIN, HIGH); // active-low relay: HIGH = solenoid closed (safe default)
  pinMode(READY_BUTTON_PIN, INPUT_PULLUP);
  pinMode(SLOT_PIN_SMALL,  INPUT_PULLUP);
  pinMode(SLOT_PIN_MEDIUM, INPUT_PULLUP);
  pinMode(SLOT_PIN_LARGE,  INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(READY_BUTTON_PIN),  onReadyButtonInterrupt,  FALLING);
  attachInterrupt(digitalPinToInterrupt(SLOT_PIN_SMALL),    onSlotSmallInterrupt,    FALLING);
  attachInterrupt(digitalPinToInterrupt(SLOT_PIN_MEDIUM),   onSlotMediumInterrupt,   FALLING);
  attachInterrupt(digitalPinToInterrupt(SLOT_PIN_LARGE),    onSlotLargeInterrupt,    FALLING);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Gloop Master ESP32-S3 (Webcam Mode) starting...");

  secureClient.setCACert(GOOGLE_ROOT_CA);
  setupPins();
  ensureWiFi();
}

void loop() {
  updateSolenoid();

  if (!ensureWiFi()) { delay(50); return; }
  if (!ensureTime()) { delay(400); return; }
  if (!ensureAuth()) { delay(400); return; }

  const unsigned long now = millis();
  const unsigned long pollInterval = isSessionActive(machineState) ? 200UL : 2000UL;
  if (now - lastFirestorePollAt >= pollInterval) {
    lastFirestorePollAt = now;
    MachineState latest;
    if (firestoreGet(latest)) {
      const bool wasProcessing = machineState.status == "PROCESSING";
      if (latest.status != machineState.status) {
        Serial.printf("[State] %s -> %s\n", machineState.status.c_str(), latest.status.c_str());
      }
      machineState = latest;
      // Force-release: admin set status=PROCESSING directly (bypassing AI).
      if (!wasProcessing && machineState.status == "PROCESSING" && !solenoidActive) {
        Serial.println("[RVM] force-release detected — opening solenoid");
        startSolenoid();
      }
    }
  }

  if (!machineState.exists) { delay(30); return; }

  if (machineState.status == "REJECTED" && rejectUntil > 0 && millis() >= rejectUntil) {
    rejectUntil = 0;
    if (firestorePatchStatus("READY")) machineState.status = "READY";
  }

  if (readyButtonInterrupt) {
    readyButtonInterrupt = false;
    if (machineState.status == "PROCESSING" && firestorePatchStatus("READY")) {
      machineState.status = "READY";
    }
  }

  if (!isSessionActive(machineState)) { delay(20); return; }

  if (machineState.status == "READY" && machineState.triggerSource.length() > 0) {
    Serial.printf("[RVM] trigger detected (source=%s) — waiting for PC listener\n",
                  machineState.triggerSource.c_str());
    handleBottleInsert();
  }

  if (slotSmallInterrupt) {
    slotSmallInterrupt = false;
    Serial.printf("[Slot] SMALL triggered (status=%s)\n", machineState.status.c_str());
    if (machineState.status == "PROCESSING") {
      if (firestoreSlotEvent("SMALL")) { machineState.status = "READY"; }
    } else { Serial.println("[Slot] SMALL ignored: not PROCESSING"); }
  }

  if (slotMediumInterrupt) {
    slotMediumInterrupt = false;
    Serial.printf("[Slot] MEDIUM triggered (status=%s)\n", machineState.status.c_str());
    if (machineState.status == "PROCESSING") {
      if (firestoreSlotEvent("MEDIUM")) { machineState.status = "READY"; }
    } else { Serial.println("[Slot] MEDIUM ignored: not PROCESSING"); }
  }

  if (slotLargeInterrupt) {
    slotLargeInterrupt = false;
    Serial.printf("[Slot] LARGE triggered (status=%s)\n", machineState.status.c_str());
    if (machineState.status == "PROCESSING") {
      if (firestoreSlotEvent("LARGE")) { machineState.status = "READY"; }
    } else { Serial.println("[Slot] LARGE ignored: not PROCESSING"); }
  }

  delay(5);
}
