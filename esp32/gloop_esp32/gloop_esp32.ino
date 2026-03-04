#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#include "../config.h"

namespace {

const unsigned long WIFI_RETRY_MS = 4000;
const unsigned long FIRESTORE_POLL_MS = 400;
const unsigned long REJECT_HOLD_MS = 1200;
const unsigned long TOKEN_REFRESH_MARGIN_MS = 60000;
const unsigned long SENSOR_DEBOUNCE_MS = 80;
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

String idToken;
String refreshToken;

struct MachineState {
  String status = "IDLE";
  String currentUser = "";
  int sessionScore = 0;
  bool exists = false;
};

MachineState machineState;

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
    return true;
  }

  const unsigned long now = millis();
  if (now - lastWiFiRetryAt < WIFI_RETRY_MS) {
    return false;
  }

  lastWiFiRetryAt = now;
  Serial.println("[WiFi] connecting...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
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
    Serial.printf("[Auth] signIn failed (%d): %s\n", code, body.c_str());
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

  int score = 0;
  if (parseIntField(fields["session_score"], score)) {
    parsed.sessionScore = score;
  }

  outState = parsed;
  return true;
}

bool firestorePatchStatus(const String& status) {
  HTTPClient http;
  const String url = machineDocUrl() + "?updateMask.fieldPaths=status";

  DynamicJsonDocument payload(256);
  payload["fields"]["status"]["stringValue"] = status;
  String payloadText;
  serializeJson(payload, payloadText);

  http.begin(secureClient, url);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "application/json");
  int code = http.PATCH(payloadText);
  String body = http.getString();
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("[Firestore] PATCH status failed (%d): %s\n", code, body.c_str());
    return false;
  }
  return true;
}

bool firestorePatchStatusAndScore(const String& status, int score) {
  HTTPClient http;
  const String url = machineDocUrl() +
                     "?updateMask.fieldPaths=status"
                     "&updateMask.fieldPaths=session_score";

  DynamicJsonDocument payload(384);
  payload["fields"]["status"]["stringValue"] = status;
  payload["fields"]["session_score"]["integerValue"] = String(score);
  String payloadText;
  serializeJson(payload, payloadText);

  http.begin(secureClient, url);
  http.addHeader("Authorization", String("Bearer ") + idToken);
  http.addHeader("Content-Type", "application/json");
  int code = http.PATCH(payloadText);
  String body = http.getString();
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("[Firestore] PATCH status+score failed (%d): %s\n", code, body.c_str());
    return false;
  }
  return true;
}

bool readBottleEdge() {
  const unsigned long now = millis();
  if (now - lastSensorReadAt < SENSOR_DEBOUNCE_MS) {
    return false;
  }
  lastSensorReadAt = now;

  bool active = false;
  if (DEV_SIMULATION) {
    // Random event generator for bench testing without sensor.
    active = (float) (esp_random() % 10000) / 10000.0f < SIM_BOTTLE_PROBABILITY;
  } else {
    const int raw = digitalRead(SENSOR_PIN);
    active = SENSOR_ACTIVE_HIGH ? (raw == HIGH) : (raw == LOW);
  }

  const bool edge = active && !lastSensorState;
  lastSensorState = active;
  return edge;
}

int classifyBottleScore() {
  const int r = esp_random() % 100;
  if (r < 40) {
    return SCORE_SMALL;
  }
  if (r < 80) {
    return SCORE_MEDIUM;
  }
  return SCORE_LARGE;
}

bool isBottleValid() {
  const int r = esp_random() % 100;
  return r < 78;
}

void pulseSolenoid() {
  digitalWrite(SOLENOID_PIN, HIGH);
  delay(SOLENOID_PULSE_MS);
  digitalWrite(SOLENOID_PIN, LOW);
}

void handleBottleInsert() {
  if (!isBottleValid()) {
    Serial.println("[RVM] bottle rejected");
    if (firestorePatchStatus("REJECTED")) {
      machineState.status = "REJECTED";
      rejectUntil = millis() + REJECT_HOLD_MS;
    }
    return;
  }

  const int gained = classifyBottleScore();
  const int nextScore = machineState.sessionScore + gained;
  pulseSolenoid();
  if (firestorePatchStatusAndScore("PROCESSING", nextScore)) {
    machineState.status = "PROCESSING";
    machineState.sessionScore = nextScore;
    Serial.printf("[RVM] bottle accepted (+%d) total=%d\n", gained, nextScore);
  }
}

void setupPins() {
  pinMode(SOLENOID_PIN, OUTPUT);
  digitalWrite(SOLENOID_PIN, LOW);
  pinMode(SENSOR_PIN, INPUT);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Gloop ESP32 edge starting...");

  secureClient.setInsecure();
  setupPins();
  ensureWiFi();
}

void loop() {
  if (!ensureWiFi()) {
    delay(50);
    return;
  }

  if (!ensureAuth()) {
    delay(400);
    return;
  }

  const unsigned long now = millis();
  if (now - lastFirestorePollAt >= FIRESTORE_POLL_MS) {
    lastFirestorePollAt = now;
    MachineState latest;
    if (firestoreGet(latest)) {
      machineState = latest;
    }
  }

  if (!machineState.exists) {
    delay(120);
    return;
  }

  if (machineState.status == "REJECTED" && rejectUntil > 0 && millis() >= rejectUntil) {
    rejectUntil = 0;
    if (firestorePatchStatus("READY")) {
      machineState.status = "READY";
    }
  }

  if (!isSessionActive(machineState)) {
    delay(80);
    return;
  }

  if (readBottleEdge()) {
    handleBottleInsert();
  }

  delay(20);
}
