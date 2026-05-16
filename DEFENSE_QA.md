# คำถาม-คำตอบ สำหรับการสอบ Senior Project
## เครื่องคัดแยกขวดอัตโนมัติพลังงานต่ำเพื่อการรีไซเคิล

---

## หมวด 1 — Infrastructure & Hosting (พื้นฐาน)

**Q: Server ของระบบตั้งอยู่ที่ไหน?**
> ระบบใช้ Firebase ของ Google เป็น Backend ทั้งหมด ซึ่ง Host อยู่บน Google Cloud Platform (GCP) ที่ Region asia-southeast1 (สิงคโปร์) ประกอบด้วย Firebase Hosting สำหรับ Web App, Firestore สำหรับฐานข้อมูล, Firebase Storage สำหรับเก็บรูปภาพ และ Cloud Functions สำหรับ Backend Logic ส่วน Python AI Listener รันบน Local Server ของทีม

**Q: ทำไมถึงเลือกใช้ Firebase ไม่ใช่ Server ตัวเอง?**
> Firebase เหมาะกับ Prototype เพราะมี Free Tier เพียงพอสำหรับการพัฒนา, รองรับ Real-time Listener ได้ทันที, มีระบบ Authentication พร้อมใช้, และไม่ต้องดูแล Infrastructure เอง ทำให้ทีมโฟกัสที่ Feature ได้เต็มที่

**Q: ถ้า Internet ขาด เครื่องยังทำงานได้ไหม?**
> ไม่ได้ครับ เพราะ ESP32 ต้องส่งภาพขึ้น Firebase Storage และรับผล AI กลับมาผ่าน Firestore การทำงาน Offline เป็น Limitation ที่ระบุไว้และสามารถแก้ไขในอนาคตด้วยการ Deploy โมเดล AI ลงบน ESP32 โดยตรง (Edge Inference)

**Q: Web App Deploy ที่ไหน?**
> Deploy บน Firebase Hosting ซึ่งเป็น Static Hosting รองรับ Next.js แบบ Static Export สามารถเข้าใช้ได้ที่ https://glooprvm.web.app

---

## หมวด 2 — Hardware & Embedded System

**Q: ทำไมถึงใช้ ESP32-S3 ไม่ใช้ Raspberry Pi?**
> ESP32-S3 มีราคาถูกกว่ามาก (~300 บาท vs ~1,500 บาท), ใช้พลังงานต่ำกว่า, Boot เร็วกว่า และเพียงพอสำหรับงาน Capture ภาพ + HTTP Request ที่ระบบนี้ต้องการ Raspberry Pi จะ Overkill และขัดกับ Objective "พลังงานต่ำ"

**Q: ทำไมต้องใช้ ESP32 สองตัว?**
> แบ่งหน้าที่ชัดเจนเพื่อลด Latency: Master ดูแลกล้องฉลาก + Solenoid + Sensor, Slave ดูแลกล้องฝาขวดโดยเฉพาะ ถ้าใช้ตัวเดียวจะต้องรอการถ่ายภาพทั้งสองมุมก่อนจึงจะประมวลผลได้ ทำให้ช้าลง

**Q: Solenoid Valve ทำงานอย่างไร?**
> ใช้ Active-Low Relay หมายความว่า LOW = เปิด Solenoid (ขวดผ่าน), HIGH = ปิด (ค่า Default ปลอดภัย) เมื่อ AI ยืนยันว่าขวดผ่าน ESP32 จะ Pulse Solenoid เปิด 600ms จากนั้นปิดอัตโนมัติ ขวดจะไหลลงทางลาดตามแรงโน้มถ่วงสู่ช่องที่ถูกต้อง

**Q: ถ้า Solenoid เปิดค้างจะเกิดอะไร?**
> มี Safety Default คือ HIGH = ปิด เสมอ ดังนั้นถ้าไฟดับหรือ ESP32 Reset Solenoid จะปิดทันที ป้องกันขวดผ่านโดยไม่ผ่านการตรวจสอบ

**Q: Sensor ตรวจจับขวดใช้อะไร?**
> ใช้ IR Sensor ตรวจจับว่ามีขวดเข้ามา และ Limit Switch (Slot Sensor) ตรวจจับว่าขวดตกลงช่องจริง เพื่อ Trigger การนับคะแนนและ Increment slotCounts

---

## หมวด 3 — AI & Machine Learning

**Q: โมเดล AI ที่ใช้คืออะไร?**
> ใช้ YOLO (You Only Look Once) จาก Ultralytics ซึ่งเป็น Object Detection Model แบบ Real-time ที่มีประสิทธิภาพสูง ระบบมีโมเดล 2 ตัว: label_model.pt สำหรับตรวจจากรูปฉลากด้านข้าง และ cap_model.pt สำหรับยืนยันจากฝาขวดด้านบน

**Q: YOLO ย่อมาจากอะไร ทำงานอย่างไร?**
> You Only Look Once หมายความว่าโมเดลประมวลผลภาพทั้งใบในครั้งเดียว แทนที่จะสแกนทีละ Region เหมือน R-CNN ทำให้เร็วมากและเหมาะกับ Real-time Detection โดยแบ่งภาพเป็น Grid และทำนาย Bounding Box + Class Probability พร้อมกัน

**Q: เทรนโมเดลด้วยข้อมูลจากไหน?**
> เก็บภาพขวดจริงในสภาพแสงและมุมต่างๆ แล้ว Label ด้วย Roboflow หรือ LabelImg จากนั้นเทรนด้วย Ultralytics YOLOv8 โดยแบ่ง Dataset เป็น Train/Validation/Test

**Q: ความแม่นยำของโมเดลเป็นเท่าไหร่?**
> [ใส่ค่าจริงจากการทดสอบ เช่น mAP50, Precision, Recall] โดย Threshold ที่ตั้งไว้คือ Confidence >= 0.5 จึงจะรับขวด ต่ำกว่านั้นระบบจะ Reject เพื่อความปลอดภัย

**Q: ถ้าโมเดลไม่แน่ใจ ระบบทำอย่างไร?**
> มีระบบ 3 ชั้น: 1) ถ้า Confidence < Safety Lock (0.35) Reject ทันที 2) ถ้า Confidence อยู่ระหว่าง 0.35–0.5 รอผล Slave Camera ยืนยัน 3) ถ้า Timeout 10 วินาทียังไม่มีผล Default เป็น Reject เสมอ — Fail Safe

**Q: Dual Camera มีประโยชน์อย่างไร?**
> เพิ่มความแม่นยำด้วยการยืนยันจาก 2 มุม กล้องฉลากดูรูปร่างขวด กล้องฝาดูสีและรูปทรงฝา ถ้า Label Model ไม่แน่ใจ Cap Model สามารถ Rescue หรือ Veto ได้

---

## หมวด 4 — Database & Data Model

**Q: ใช้ Database อะไร?**
> Firestore ซึ่งเป็น NoSQL Document Database แบบ Real-time ของ Firebase ข้อดีคือ onSnapshot Listener ทำให้ ESP32 และ Web App ได้รับการอัปเดตสถานะทันทีโดยไม่ต้อง Polling

**Q: ทำไมไม่ใช้ SQL Database?**
> ข้อมูลของระบบนี้มีโครงสร้างแบบ Document ที่เปลี่ยนบ่อย เช่น last_capture map และ slotCounts ถ้าใช้ SQL ต้องออกแบบ Schema ล่วงหน้าและอาจต้อง ALTER TABLE บ่อย Firestore ยืดหยุ่นกว่าสำหรับ Prototype

**Q: Data ในระบบมีอะไรบ้าง?**
> 4 Collections หลัก:
> - `machines/{id}` — สถานะเครื่อง, slotCounts, bin_full
> - `users/{uid}` — โปรไฟล์, total_score, session_count
> - `users/{uid}/sessions/{sid}` — ประวัติเซสชัน
> - `logs` — ผล AI ทุก Bottle (label, confidence, dual_cam, result)

**Q: ป้องกันการ Double-process อย่างไร?**
> ใช้ Firestore Transaction ใน Python AI Listener เพื่อ Atomic Claim สถานะจาก `"ready"` → `"processing_ai"` ถ้า 2 Process พยายาม Claim พร้อมกัน Transaction จะ Retry และ Process ที่ 2 จะเห็นว่าสถานะเปลี่ยนไปแล้วจึงหยุดทำงาน

---

## หมวด 5 — Web Application

**Q: Web App ทำด้วยอะไร?**
> Next.js 15 (App Router) + TypeScript, UI ด้วย HeroUI + Tailwind CSS, Animation ด้วย Framer Motion, เชื่อมต่อ Firebase ด้วย Firebase SDK 11

**Q: ทำไมถึงเลือก Next.js?**
> รองรับ Static Export ได้ดีสำหรับ Firebase Hosting, TypeScript ช่วยลด Bug, App Router ทำให้จัดการ Route และ Layout ง่าย และ Community ใหญ่มีเอกสารครบ

**Q: Real-time ทำอย่างไร?**
> ใช้ `onSnapshot` ของ Firestore SDK ซึ่งเป็น WebSocket-based Listener เมื่อข้อมูลใน Firestore เปลี่ยน Component ใน React จะ Re-render ทันทีโดยไม่ต้อง Polling

**Q: ระบบ Authentication ทำอย่างไร?**
> ใช้ Firebase Authentication รองรับ Email/Password Login หน้า Admin ตรวจสอบเพิ่มว่า UID อยู่ใน Collection `admins` ด้วย ถ้าไม่ใช่ Admin จะ Redirect ไปหน้า Dashboard แทน

---

## หมวด 6 — Bin Full Detection (Feature ใหม่)

**Q: รู้ได้อย่างไรว่าถังเต็ม?**
> ใช้การนับขวดจาก `slotCounts` ที่ ESP32 Increment ทุกครั้งที่ Slot Sensor ตรวจจับขวดตก เมื่อ Web Admin ตรวจพบว่าจำนวนถึง Capacity ที่กำหนด จะเขียน `bin_full.SMALL/MEDIUM/LARGE = true` ลง Firestore และ AI Listener จะอ่านค่านี้ก่อนตัดสินใจรับขวด

**Q: ทำไมไม่ใช้ Sensor วัดความจุจริง?**
> สำหรับ Prototype เพียงพอแล้วที่จะใช้การนับ Software เพราะไม่ต้องเพิ่ม Hardware และ Cost ต่ำกว่า ในอนาคตสามารถเพิ่ม IR Sensor หรือ Load Cell เพื่อความแม่นยำสูงขึ้นได้

**Q: Capacity ตั้งไว้เท่าไหร่ คิดยังไง?**
> Physical Maximum ของแต่ละช่องคือ 144/120/144 ขวด แต่ตั้ง Effective Capacity ไว้ที่ 70% (101/84/101 ขวด) เพราะขวดตกไม่เรียงสวยเสมอไป เผื่อพื้นที่กันชนป้องกันขวดล้น

---

## หมวด 7 — Security

**Q: ระบบมีความปลอดภัยอย่างไร?**
> 1) Firebase Auth ป้องกันการเข้าถึงโดยไม่ได้รับอนุญาต 2) Firestore Security Rules กำหนดสิทธิ์อ่าน/เขียนแยกตาม Role 3) Cloud Function มี Rate Limit 3 วินาทีต่อ Upload ป้องกัน Spam 4) ขนาดภาพ Limit ที่ 2MB

**Q: Firestore Rules เป็นอย่างไร?**
> User อ่านได้เฉพาะข้อมูลของตัวเอง, Admin อ่าน/เขียนได้ทุกอย่าง, Machine Document เขียนได้เฉพาะ Authenticated User ที่เป็นเจ้าของ Session นั้น

---

## หมวด 8 — Scrum & Project Management

**Q: ใช้ Agile แบบไหน? Sprint ยาวแค่ไหน?**
> ใช้ Scrum โดยแต่ละ Sprint ยาว 2 สัปดาห์ มีทั้งหมด 6 Sprint ตั้งแต่ออกแบบ Architecture จนถึงทดสอบและส่งงาน

**Q: User Story เขียนอย่างไร?**
> ใช้ Format: "As a [role], I want [feature], So that [benefit]" เช่น "As a Member, I want to see my point balance, So that I know how many rewards I can redeem"

**Q: Burndown Chart บอกอะไร?**
> แสดงความสัมพันธ์ระหว่าง Story Points ที่เหลือกับเวลาใน Sprint ถ้าเส้นกราฟลงเร็วกว่า Ideal Line แสดงว่างานเสร็จเร็วกว่าแผน ถ้าลงช้ากว่าแสดงว่ามีความเสี่ยง

---

## หมวด 9 — Testing & Performance

**Q: ทดสอบระบบอย่างไร?**
> ทดสอบ 3 ระดับ: 1) Unit Test โมเดล AI วัด mAP, Precision, Recall บน Test Set 2) Integration Test ทดสอบการทำงานร่วมกันของ ESP32, Firebase, AI Listener 3) User Acceptance Test ให้ผู้ใช้ทดลองใส่ขวดจริงและวัด Success Rate

**Q: ผลการทดสอบ Accuracy เป็นอย่างไร?**
> [ใส่ค่าจริง] โดยทดสอบกับขวด 3 ขนาด ในสภาพแสงปกติ ผลที่ได้คือ [X]% Accuracy รวม ปัญหาที่พบคือ Low Confidence ในสภาพแสงน้อย ซึ่งระบบจะ Reject เพื่อความปลอดภัย

**Q: Latency ของระบบเป็นเท่าไหร่?**
> ตั้งแต่วางขวดจนเปิด Solenoid ใช้เวลาประมาณ 3–5 วินาที แบ่งเป็น Upload ภาพ ~1s, AI Inference ~1–2s, Firestore Round-trip ~0.5s

---

## หมวด 10 — Future Work & ข้อจำกัด

**Q: ข้อจำกัดของระบบมีอะไรบ้าง?**
> 1) ต้องใช้ Internet ตลอดเวลา 2) รองรับเฉพาะขวด 3 ขนาดที่เทรนโมเดล 3) ประสิทธิภาพ AI ลดลงในสภาพแสงน้อย 4) ระบบ bin_full ใช้การนับ ไม่ใช่ Sensor จริง

**Q: ถ้าจะพัฒนาต่อจะทำอะไรก่อน?**
> 1) เพิ่ม IR Sensor / Load Cell วัดความจุจริง 2) Deploy AI Model บน ESP32 เพื่อ Offline Mode 3) เพิ่มขวดประเภทใหม่โดย Retrain โมเดล 4) ระบบแจ้งเตือน Admin ผ่าน LINE Notify เมื่อถังใกล้เต็ม

**Q: ถ้า AI Server ล่ม เครื่องจะทำอย่างไร?**
> ESP32 รอผล AI สูงสุด 10 วินาที ถ้า Timeout จะ Default เป็น REJECTED และปิด Solenoid ขวดจะไม่ผ่านโดยไม่ได้รับการตรวจสอบ เป็น Fail-Safe Design

---

*อัปเดตล่าสุด: 26 มีนาคม 2569*
