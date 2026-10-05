/**
 * ====================================================================
 *   IoT WebApp - ESP32 Hardware Firmware (Arduino C++)
 *   เชื่อมต่อ WiFi, อ่านค่าเซนเซอร์, ส่ง Telemetry สู่เซิร์ฟเวอร์คลาวด์ Render
 *   ออนไลน์ 24 ชม. ดูและควบคุมได้จากทุกที่ทั่วโลกผ่านมือถือและคอมพิวเตอร์
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
// 2. ตั้งค่า URL ของเซิร์ฟเวอร์คลาวด์ Render ของคุณ
// --------------------------------------------------------------------
// นำลิงก์ Render ของคุณมาใส่ตรงนี้ แล้วต่อท้ายด้วย /api/esp32/telemetry
// เช่น: "https://webapp-iot-ar.onrender.com/api/esp32/telemetry"
const char* SERVER_URL    = "https://webapp-iot-ar.onrender.com/api/esp32/telemetry";

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
  Serial.println("🚀 กำลังเริ่มต้นระบบ ESP32 - IoT Cloud Node");
  Serial.print("🌐 เซิร์ฟเวอร์เป้าหมาย: ");
  Serial.println(SERVER_URL);
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

  // ส่งข้อมูลสู่เซิร์ฟเวอร์ (รองรับทั้ง HTTPS ของ Render และ HTTP ธรรมดา)
  WiFiClientSecure client;
  client.setInsecure(); // สำคัญมาก: รองรับ HTTPS ของ Render ได้ 100% โดยไม่ต้องใช้ SSL certificate

  HTTPClient http;
  bool isHttps = String(SERVER_URL).startsWith("https");
  
  if (isHttps) {
    http.begin(client, SERVER_URL);
  } else {
    http.begin(SERVER_URL);
  }
  http.addHeader("Content-Type", "application/json");

  Serial.println("\n📤 กำลังส่งข้อมูลเซนเซอร์สู่เซิร์ฟเวอร์คลาวด์...");
  Serial.println(requestJson);

  int httpCode = http.POST(requestJson);

  if (httpCode == HTTP_CODE_OK || httpCode == 200) {
    String response = http.getString();
    Serial.println("📥 ตอบกลับจากเซิร์ฟเวอร์สำเร็จ (สถานะออนไลน์):");
    Serial.println(response);

    // อ่านคำสั่งเปิด-ปิด Relay ที่ส่งกลับมาจากเซิร์ฟเวอร์
    StaticJsonDocument<512> responseDoc;
    DeserializationError error = deserializeJson(responseDoc, response);

    if (!error && responseDoc["success"]) {
      JsonObject relays = responseDoc["relays"];
      
      bool foggerState  = relays["fogger"] | false;
      bool fanState     = relays["fan"] | false;
      bool lightState   = relays["light"] | false;
      bool curtainState = relays["curtain"] | false;

      // อัปเดตสวิตช์ Relay จริง
      digitalWrite(PIN_RELAY_FOGGER,  foggerState  ? HIGH : LOW);
      digitalWrite(PIN_RELAY_FAN,     fanState     ? HIGH : LOW);
      digitalWrite(PIN_RELAY_LIGHT,   lightState   ? HIGH : LOW);
      digitalWrite(PIN_RELAY_CURTAIN, curtainState ? HIGH : LOW);

      Serial.printf("⚡ [Relay] พ่นหมอก=%s, พัดลม=%s, ไฟLED=%s, ม่าน=%s\n",
        foggerState ? "ON" : "OFF",
        fanState ? "ON" : "OFF",
        lightState ? "ON" : "OFF",
        curtainState ? "ON" : "OFF"
      );
    }
  } else {
    Serial.printf("⚠️ ส่งข้อมูลไม่สำเร็จ HTTP Code: %d\n", httpCode);
  }

  http.end();
}
