/**
 * ====================================================================
 *   IoT WebApp - ESP32 Hardware Firmware (Arduino C++)
 *   เชื่อมต่อ WiFi, อ่านค่าเซนเซอร์, ส่ง Telemetry สู่ฐานข้อมูล
 *   รองรับทั้งระบบคลาวด์ Firebase (ออนไลน์ 24 ชม. ทุกที่ทั่วโลก) 
 *   และ Local Server บนคอมพิวเตอร์
 * ====================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h> // ติดตั้งผ่าน Arduino Library Manager (ArduinoJson ver 6.x หรือ 7.x)

// --------------------------------------------------------------------
// 1. ตั้งค่าการเชื่อมต่อ Wi-Fi
// --------------------------------------------------------------------
const char* WIFI_SSID     = "Romchale_2.4GHz";      // ใส่ชื่อ WiFi ของคุณ
const char* WIFI_PASSWORD = "B5224938";  // ใส่รหัสผ่าน WiFi ของคุณ

// --------------------------------------------------------------------
// 2. เลือกโหมดการทำงาน
// --------------------------------------------------------------------
// ตั้งค่าเป็น 1 : โหมด FIREBASE CLOUD (ออนไลน์ทุกที่ทั่วโลก ดูผ่าน GitHub Pages & เน็ตมือถือ 4G/5G)
// ตั้งค่าเป็น 0 : โหมด LOCAL SERVER (เซิร์ฟเวอร์ในบ้านบนคอมพิวเตอร์พอร์ต 3000)
#define USE_FIREBASE_CLOUD 1

#if USE_FIREBASE_CLOUD
  // นำ URL ของ Firebase Realtime Database ของคุณมาวางที่นี่ (ไม่ต้องมี / ปิดท้าย)
  // ตัวอย่าง: "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app"
  const char* FIREBASE_HOST = "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app";
#else
  const char* SERVER_URL    = "http://192.168.1.138:3000/api/esp32/telemetry";
#endif

// --------------------------------------------------------------------
// 3. กำหนดขา GPIO สำหรับ Relay ควบคุมอุปกรณ์
// --------------------------------------------------------------------
const int PIN_RELAY_FOGGER  = 25; // หัวพ่นหมอก
const int PIN_RELAY_FAN     = 26; // พัดลมระบายอากาศ
const int PIN_RELAY_LIGHT   = 27; // ไฟ LED ส่องสว่าง
const int PIN_RELAY_CURTAIN = 14; // ม่านระบายอากาศ

// กำหนดขาเซนเซอร์ (ตัวอย่าง)
const int PIN_SENSOR_LDR    = 34; // เซนเซอร์แสงสว่าง (Analog ADC)
const int PIN_SENSOR_CO2    = 35; // เซนเซอร์ CO2 MQ135 (Analog ADC)

// รอบการส่งข้อมูล (หน่วยเป็นมิลลิวินาที: 5000 = 5 วินาที)
const unsigned long SEND_INTERVAL_MS = 5000;
unsigned long lastSendTime = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n\n========================================");
  Serial.println("🚀 กำลังเริ่มต้นระบบ ESP32 - IoT WebApp Node");
#if USE_FIREBASE_CLOUD
  Serial.println("☁️ โหมดการทำงาน: Firebase Cloud (ออนไลน์ 24 ชม.)");
#else
  Serial.println("💻 โหมดการทำงาน: Local Server (พอร์ต 3000)");
#endif
  Serial.println("========================================");

  // ตั้งค่าขา Relay เป็น OUTPUT และปิดไว้ก่อนเริ่มต้น
  pinMode(PIN_RELAY_FOGGER, OUTPUT);
  pinMode(PIN_RELAY_FAN, OUTPUT);
  pinMode(PIN_RELAY_LIGHT, OUTPUT);
  pinMode(PIN_RELAY_CURTAIN, OUTPUT);

  digitalWrite(PIN_RELAY_FOGGER, LOW);
  digitalWrite(PIN_RELAY_FAN, LOW);
  digitalWrite(PIN_RELAY_LIGHT, LOW);
  digitalWrite(PIN_RELAY_CURTAIN, LOW);

  // เชื่อมต่อ Wi-Fi
  connectWiFi();
}

void loop() {
  // ตรวจสอบการเชื่อมต่อ Wi-Fi หากหลุดให้ต่อใหม่
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // ส่งข้อมูลเซนเซอร์ตามรอบเวลาที่กำหนด
  unsigned long now = millis();
  if (now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;
    sendTelemetryAndGetCommands();
  }

  delay(50);
}

// ฟังก์ชันเชื่อมต่อ WiFi
void connectWiFi() {
  Serial.printf("📡 กำลังเชื่อมต่อ Wi-Fi: %s ", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ เชื่อมต่อ Wi-Fi สำเร็จ!");
    Serial.print("🌐 IP Address ของ ESP32: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n⚠️ ไม่สามารถเชื่อมต่อ Wi-Fi ได้ กำลังลองใหม่อีกครั้ง...");
  }
}

// ฟังก์ชันอ่านค่าเซนเซอร์ ส่งเข้าฐานข้อมูล และรับคำสั่ง Relay
void sendTelemetryAndGetCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  // --- อ่านค่าจากเซนเซอร์จริง ---
  // * หากต่อ DHT22: float temp = dht.readTemperature(); float humid = dht.readHumidity();
  float temp  = 26.5; 
  float humid = 84.0; 
  
  // แปลงค่า Lux จาก LDR (0-4095 แปลงเป็น Lux โดยประมาณ)
  int rawLdr = analogRead(PIN_SENSOR_LDR);
  float lux  = map(rawLdr, 0, 4095, 100, 1000);

  // แปลงค่า CO2 จาก MQ135
  int rawCo2 = analogRead(PIN_SENSOR_CO2);
  float co2  = map(rawCo2, 0, 4095, 400, 1200);

  // สร้าง JSON Payload
  StaticJsonDocument<256> doc;
  doc["deviceId"] = "esp32-zone1";
  doc["temp"]     = round(temp * 10.0) / 10.0;
  doc["humid"]    = round(humid * 10.0) / 10.0;
  doc["lux"]      = round(lux);
  doc["co2"]      = round(co2);

  String requestJson;
  serializeJson(doc, requestJson);

#if USE_FIREBASE_CLOUD
  // ==================================================================
  // โหมดคลาวด์ FIREBASE REALTIME DATABASE (ออนไลน์ทั่วโลก 24 ชม.)
  // ==================================================================
  WiFiClientSecure client;
  client.setInsecure(); // ไม่ต้องตรวจ SSL Certificate เพื่อความรวดเร็วและประหยัดแรม

  HTTPClient https;
  String telemetryUrl = String(FIREBASE_HOST) + "/iot_device/telemetry.json";

  Serial.println("\n☁️ [Firebase] กำลังส่งข้อมูลเซนเซอร์สู่คลาวด์...");
  Serial.println(requestJson);

  if (https.begin(client, telemetryUrl)) {
    https.addHeader("Content-Type", "application/json");
    int httpCode = https.sendRequest("PATCH", requestJson);

    if (httpCode == HTTP_CODE_OK || httpCode == 200) {
      Serial.printf("✅ ส่งขึ้น Firebase สำเร็จ! (HTTP %d)\n", httpCode);
    } else {
      Serial.printf("⚠️ ส่งขึ้น Firebase ไม่สำเร็จ HTTP: %d\n", httpCode);
    }
    https.end();
  }

  // อ่านคำสั่งเปิด-ปิด Relay จาก Firebase
  String relayUrl = String(FIREBASE_HOST) + "/iot_device/relays.json";
  if (https.begin(client, relayUrl)) {
    int getCode = https.GET();
    if (getCode == HTTP_CODE_OK || getCode == 200) {
      String relayPayload = https.getString();
      StaticJsonDocument<256> relayDoc;
      DeserializationError error = deserializeJson(relayDoc, relayPayload);

      if (!error && relayDoc.is<JsonObject>()) {
        bool foggerState  = relayDoc["fogger"] | false;
        bool fanState     = relayDoc["fan"] | false;
        bool lightState   = relayDoc["light"] | false;
        bool curtainState = relayDoc["curtain"] | false;

        digitalWrite(PIN_RELAY_FOGGER,  foggerState  ? HIGH : LOW);
        digitalWrite(PIN_RELAY_FAN,     fanState     ? HIGH : LOW);
        digitalWrite(PIN_RELAY_LIGHT,   lightState   ? HIGH : LOW);
        digitalWrite(PIN_RELAY_CURTAIN, curtainState ? HIGH : LOW);

        Serial.printf("⚡ [Firebase Relay] พ่นหมอก=%s, พัดลม=%s, ไฟLED=%s, ม่าน=%s\n",
          foggerState ? "ON" : "OFF",
          fanState ? "ON" : "OFF",
          lightState ? "ON" : "OFF",
          curtainState ? "ON" : "OFF"
        );
      }
    }
    https.end();
  }

#else
  // ==================================================================
  // โหมด LOCAL SERVER (เซิร์ฟเวอร์พอร์ต 3000 บนคอมพิวเตอร์)
  // ==================================================================
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  Serial.println("\n📤 [Local] กำลังส่งข้อมูลเซนเซอร์สู่เซิร์ฟเวอร์...");
  Serial.println(requestJson);

  int httpCode = http.POST(requestJson);

  if (httpCode == HTTP_CODE_OK || httpCode == 200) {
    String response = http.getString();
    Serial.println("📥 ตอบกลับจาก Local Server สำเร็จ:");
    Serial.println(response);

    StaticJsonDocument<512> responseDoc;
    DeserializationError error = deserializeJson(responseDoc, response);

    if (!error && responseDoc["success"]) {
      JsonObject relays = responseDoc["relays"];
      
      bool foggerState  = relays["fogger"] | false;
      bool fanState     = relays["fan"] | false;
      bool lightState   = relays["light"] | false;
      bool curtainState = relays["curtain"] | false;

      digitalWrite(PIN_RELAY_FOGGER,  foggerState  ? HIGH : LOW);
      digitalWrite(PIN_RELAY_FAN,     fanState     ? HIGH : LOW);
      digitalWrite(PIN_RELAY_LIGHT,   lightState   ? HIGH : LOW);
      digitalWrite(PIN_RELAY_CURTAIN, curtainState ? HIGH : LOW);

      Serial.printf("⚡ [Local Relay] พ่นหมอก=%s, พัดลม=%s, ไฟLED=%s, ม่าน=%s\n",
        foggerState ? "ON" : "OFF",
        fanState ? "ON" : "OFF",
        lightState ? "ON" : "OFF",
        curtainState ? "ON" : "OFF"
      );
    }
  } else {
    Serial.printf("⚠️ ส่งข้อมูลไม่สำเร็จ HTTP Code: %d (เซิร์ฟเวอร์ยังออฟไลน์หรือเข้าถึงไม่ได้)\n", httpCode);
  }

  http.end();
#endif
}
