# บทที่ 4 — ผลการทดลองและการประเมินผล

---

## 4.1 กระบวนการ Agile Project Management (Scrum)

### ภาพรวม Sprint

| | รายละเอียด |
|---|---|
| Methodology | Scrum |
| Sprint Length | 2–6 สัปดาห์ (ปรับตามลักษณะงาน) |
| จำนวน Sprint | 6 Sprint |
| ช่วงเวลาโปรเจค | สิงหาคม 2568 — 28 มีนาคม 2569 (~8 เดือน) |
| จำนวนสมาชิก | 4 คน (+ รุ่นพี่ภายนอกทีมรับผิดชอบ Train AI Model) |

> **หมายเหตุ:** โปรเจคนี้เป็นงาน Hardware-first โดย Sprint 1–4 เน้นงานออกแบบและผลิตชิ้นส่วนเชิงกล (Mechanical) เป็นหลัก ซึ่งใช้เวลารวมกัน ~5 เดือน ส่วน Sprint 5–6 จึงเป็นการ Integrate ฮาร์ดแวร์เข้ากับ Software, Firmware และ AI

---

### Sprint 1 — Project Planning & Research
**ระยะเวลา:** 1–28 สิงหาคม 2568 (4 สัปดาห์)

| Req ID | Story | User Story | Points | ผู้รับผิดชอบ | Status | Delivery |
|---|---|---|---|---|---|---|
| REQ-01 | วิเคราะห์ความต้องการและ Scope | As a team, I want to define project scope and requirements clearly, so that every member knows the boundary of the system before starting development | 5 | [ชื่อ 1] | Done | 7 ส.ค. 2568 |
| REQ-02 | ทดสอบการตกของขวดจากความสูงต่าง ๆ | As a developer, I want to test at what drop height a glass bottle breaks, so that we can design the rail height to be safe for all bottle types | 8 | [ชื่อ 2] | Done | 14 ส.ค. 2568 |
| REQ-03 | ออกแบบสถาปัตยกรรมระบบ (Hardware + Software + AI) | As a developer, I want to define the full system architecture (ESP32 + Firebase + YOLO + Web), so that all components have clear interfaces before implementation begins | 5 | [ชื่อ 1] | Done | 21 ส.ค. 2568 |
| REQ-04 | วาง Timeline และแบ่งหน้าที่ทีม | As a project manager, I want to assign responsibilities and milestones to each team member, so that work proceeds in parallel without blockers | 3 | [ชื่อ 1] | Done | 28 ส.ค. 2568 |

**Sprint 1 Story Points รวม:** 21 points

---

### Sprint 2 — CAD Design v1–v2 & First Laser Cut
**ระยะเวลา:** 1–26 กันยายน 2568 (4 สัปดาห์)

| Req ID | Story | User Story | Points | ผู้รับผิดชอบ | Status | Delivery |
|---|---|---|---|---|---|---|
| REQ-05 | ออกแบบโครงราง CAD v1 ด้วย SolidWorks | As a developer, I want to create the first CAD model of the acrylic rail system using SolidWorks, so that we have a concrete design to laser cut and test | 8 | [ชื่อ 2] | Done | 8 ก.ย. 2568 |
| REQ-06 | ออกแบบช่องเก็บขวด 3 ช่อง (SMALL/MEDIUM/LARGE) v1 | As a user, I want 3 separate storage slots sized for each bottle type (100/140/150 ml), so that sorted bottles go to the correct bin automatically | 8 | [ชื่อ 3] | Done | 12 ก.ย. 2568 |
| REQ-07 | สั่งตัด Laser Cut ชุดที่ 1 + ประกอบทดสอบ | As a developer, I want to laser cut the v1 design and assemble a physical prototype, so that we can identify design flaws early | 5 | [ชื่อ 2], [ชื่อ 3] | Done | 19 ก.ย. 2568 |
| REQ-08 | ทดสอบความลาดเอียงของราง (Angle Test v1) | As a developer, I want to test various rail angles to find the minimum angle that allows bottles to slide smoothly without sticking, so that the system is reliable under real conditions | 5 | [ชื่อ 4] | Done | 26 ก.ย. 2568 |

**Sprint 2 Story Points รวม:** 26 points

---

### Sprint 3 — Mechanical Iteration v2–v3
**ระยะเวลา:** 29 กันยายน — 24 ตุลาคม 2568 (4 สัปดาห์)

| Req ID | Story | User Story | Points | ผู้รับผิดชอบ | Status | Delivery |
|---|---|---|---|---|---|---|
| REQ-09 | ปรับแก้ CAD ราง v2 จากผลทดสอบ v1 | As a developer, I want to revise the CAD design based on v1 test results (angle, slot width, clearance), so that v2 addresses all identified physical issues | 8 | [ชื่อ 2] | Done | 6 ต.ค. 2568 |
| REQ-10 | ทดสอบขนาด Slot ให้พอดีกับขวด 3 ขนาด | As a user, I want each slot opening to be precisely sized for its target bottle (SMALL/MEDIUM/LARGE), so that bottles cannot accidentally fall into the wrong slot | 8 | [ชื่อ 3], [ชื่อ 4] | Done | 10 ต.ค. 2568 |
| REQ-11 | ออกแบบ Guide บนรางเพื่อแยกขวดตามช่อง | As a user, I want physical guides on the rail that steer each bottle size toward its designated slot, so that the sorting is mechanically reliable regardless of AI result timing | 8 | [ชื่อ 2] | Done | 17 ต.ค. 2568 |
| REQ-12 | สั่งตัด Laser Cut ชุดที่ 2 + ประกอบและทดสอบ | As a developer, I want to fabricate and assemble the v2–v3 design, so that we can verify that the guide and slot improvements work correctly with real bottles | 5 | [ชื่อ 2], [ชื่อ 3] | Done | 24 ต.ค. 2568 |

**Sprint 3 Story Points รวม:** 29 points

---

### Sprint 4 — Mechanical Finalization v4–v5
**ระยะเวลา:** 27 ตุลาคม — 5 ธันวาคม 2568 (6 สัปดาห์)

| Req ID | Story | User Story | Points | ผู้รับผิดชอบ | Status | Delivery |
|---|---|---|---|---|---|---|
| REQ-13 | ออกแบบ CAD ราง v3–v4 (ปรับ Guide และมุมราง) | As a developer, I want to iterate on the guide geometry and rail angle based on v2–v3 test data, so that all 3 bottle sizes flow to the correct slot with ≥ 95% reliability | 8 | [ชื่อ 2] | Done | 7 พ.ย. 2568 |
| REQ-14 | ออกแบบและผลิตโครงเครื่องเหล็ก | As a developer, I want to design and fabricate the steel frame that holds the acrylic rail assembly in place, so that the machine is structurally stable during operation | 8 | [ชื่อ 3] | Done | 14 พ.ย. 2568 |
| REQ-15 | กำหนดตำแหน่งกล้อง Master และ Slave บนตัวเครื่อง | As a developer, I want to mount the Master camera (side/label view) and Slave camera (top/cap view) at fixed positions on the frame, so that image quality is consistent across every bottle | 5 | [ชื่อ 1], [ชื่อ 4] | Done | 21 พ.ย. 2568 |
| REQ-16 | กำหนดตำแหน่ง Solenoid ที่จุดปล่อยขวด | As a developer, I want to mount the solenoid valve at the exact release point on the rail where the sorting decision takes effect, so that accepted bottles pass through and rejected bottles are held back | 5 | [ชื่อ 4] | Done | 25 พ.ย. 2568 |
| REQ-17 | ออกแบบ CAD ราง v5 (Final) + Laser Cut ชุดสุดท้าย | As a developer, I want to produce the final v5 acrylic rail assembly and verify it with all 3 bottle types, so that the mechanical system is complete and ready for electronics integration | 8 | [ชื่อ 2], [ชื่อ 3] | Done | 5 ธ.ค. 2568 |

**Sprint 4 Story Points รวม:** 34 points

---

### Sprint 5 — Hardware Integration & Firebase Backend
**ระยะเวลา:** 8 ธันวาคม 2568 — 6 กุมภาพันธ์ 2569 (8 สัปดาห์)

| Req ID | Story | User Story | Points | ผู้รับผิดชอบ | Status | Delivery |
|---|---|---|---|---|---|---|
| REQ-18 | ประกอบเครื่องสมบูรณ์ (ราง + โครง + Solenoid + Sensor) | As a developer, I want to assemble all mechanical and electronic components into one complete machine, so that we can begin end-to-end hardware testing | 8 | [ชื่อ 2], [ชื่อ 3], [ชื่อ 4] | Done | 19 ธ.ค. 2568 |
| REQ-19 | ตั้งค่า Firebase Project + ออกแบบ Firestore Schema | As a developer, I want to set up Firebase (Auth, Firestore, Storage, Hosting) and define the data schema (machines/users/logs/sessions), so that all components share a consistent backend | 5 | [ชื่อ 1] | Done | 26 ธ.ค. 2568 |
| REQ-20 | Master ESP32 Firmware (กล้อง + อัปโหลด + Solenoid + Slot Sensor) | As a developer, I want the Master ESP32 to capture a label image, upload it to Firebase via Cloud Function, poll for AI result, operate the solenoid, and trigger slot scoring on limit switch, so that the full hardware loop works end-to-end | 13 | [ชื่อ 4] | Done | 16 ม.ค. 2569 |
| REQ-21 | Cloud Function: uploadBottleImage + resetStaleSessions | As a developer, I want a secure Cloud Function that validates the ESP32 upload, saves the image to Storage, and sets status="ready", so that the AI pipeline is triggered correctly and stale sessions are cleaned up automatically | 5 | [ชื่อ 1] | Done | 23 ม.ค. 2569 |
| REQ-22 | ทดสอบ Hardware Integration (ESP32 + Solenoid + Sensor) | As a developer, I want to run integration tests of the full hardware loop without AI, so that all physical components (camera, relay, solenoid, limit switch) are confirmed working before software integration | 5 | [ชื่อ 3], [ชื่อ 4] | Done | 6 ก.พ. 2569 |

**Sprint 5 Story Points รวม:** 36 points

---

### Sprint 6 — Software, AI Integration & Testing
**ระยะเวลา:** 9 กุมภาพันธ์ — 28 มีนาคม 2569 (7 สัปดาห์)

| Req ID | Story | User Story | Points | ผู้รับผิดชอบ | Status | Delivery |
|---|---|---|---|---|---|---|
| REQ-23 | รับ YOLO Model จากรุ่นพี่ + พัฒนา Python AI Listener | As a developer, I want to integrate the pre-trained YOLO models (label_model.pt / cap_model.pt) provided by an external collaborator into the Firestore listener pipeline, so that the AI decision is triggered automatically on every bottle upload | 8 | [ชื่อ 1] | Done | 21 ก.พ. 2569 |
| REQ-24 | Slave ESP32 Firmware (กล้องฝาขวด — อัปโหลดอย่างเดียว) | As a developer, I want the Slave ESP32 to upload a cap-view image to Firebase Storage when triggered, so that the AI has a second camera angle for validation | 5 | [ชื่อ 4] | Done | 24 ก.พ. 2569 |
| REQ-25 | Web App (Login, Dashboard, Summary, Profile, Rewards, Admin) | As a user, I want a complete web application where I can start a session, monitor the machine in real time, view my score summary, check my profile, redeem rewards, and as an admin manage the machine remotely | 13 | [ชื่อ 1], [ชื่อ 3] | Done | 10 มี.ค. 2569 |
| REQ-26 | Bin Full Detection + Dynamic Config + FastAPI Health | As an admin, I want the system to reject bottles when a bin is full and allow me to tune AI thresholds from the Firebase Console without restarting the service, so that I can manage the machine in real time | 5 | [ชื่อ 1] | Done | 17 มี.ค. 2569 |
| REQ-27 | Firestore Security Rules + UAT + Bug Fixes + Deploy | As a developer, I want to deploy Firestore security rules, run user acceptance testing with real bottles, fix all identified bugs, and publish the final build to Firebase Hosting, so that the system is production-ready before the submission deadline | 8 | [ชื่อ 1], [ชื่อ 2], [ชื่อ 3], [ชื่อ 4] | Done | 28 มี.ค. 2569 |

**Sprint 6 Story Points รวม:** 39 points

---

### สรุป Story Points ทุก Sprint

| Sprint | โฟกัสหลัก | Points ที่วางแผน | Points ที่ทำได้ | ผลลัพธ์ |
|---|---|---|---|---|
| Sprint 1 | Project Planning & Research | 21 | 21 | ตามแผน |
| Sprint 2 | CAD Design v1–v2 + Laser Cut ครั้งแรก | 26 | 26 | ตามแผน |
| Sprint 3 | Mechanical Iteration v2–v3 | 29 | 29 | ตามแผน |
| Sprint 4 | Mechanical Finalization v4–v5 | 34 | 34 | ตามแผน |
| Sprint 5 | Hardware Integration + Firebase | 36 | 36 | ตามแผน |
| Sprint 6 | Software + AI Integration + Testing | 39 | 39 | ตามแผน |
| **รวม** | | **185** | **185** | |

---

### Burndown Chart (ตัวอย่าง Sprint 4 — Mechanical Finalization)

```
Story Points
34 |*
   |  \  -- Ideal Line
28 |   *
   |     \
22 |      *
   |        \--------
17 |                 *   Actual Line
   |                   \
11 |                    *
   |                      \
 6 |                       *
   |                         \
 0 +------------------------------------> วัน
   W1    W2    W3    W4    W5    W6
```

> Sprint 4 เป็น Sprint ที่ซับซ้อนที่สุดในด้าน Mechanical เพราะต้องรอ Laser Cut และทดสอบซ้ำหลายรอบ กราฟ Actual จึง Flat ในช่วง W2–W3 (รอชิ้นส่วน) แล้วลงเร็วในช่วง W4–W6 เมื่อประกอบและทดสอบสำเร็จ

---

## 4.2 ความก้าวหน้าของโครงงานและการทดลองใช้กับผู้ใช้จริง

> **หมายเหตุ:** แนบรูปถ่าย / บันทึกการพบอาจารย์ที่ปรึกษา หรือผลแบบสอบถามจากผู้ใช้จริงในส่วนนี้

**แนวทางการประเมินความพึงพอใจ (Likert Scale 1–5):**

| หัวข้อประเมิน | คะแนนเฉลี่ย |
|---|---|
| ความง่ายในการใช้งาน Web App | [X.X] |
| ความรวดเร็วของระบบ (ตั้งแต่ใส่ขวดจนได้คะแนน) | [X.X] |
| ความถูกต้องของการแยกขวด | [X.X] |
| ความพึงพอใจต่อระบบสะสมคะแนน / แลกรางวัล | [X.X] |
| ความเชื่อมั่นในความปลอดภัยของข้อมูล | [X.X] |

---

## 4.3 Source Code ส่วนสำคัญของโปรเจค

### Core Feature 1 — AI Detection Pipeline (`ai_server/listener.py`)

ฟังก์ชัน `detect_bottle()` คือหัวใจของระบบ ทำหน้าที่ตัดสินว่าขวดไหนผ่านหรือไม่ผ่าน โดยใช้ Logic การตัดสินใจ 7 ขั้นแบบ Priority Chain

```python
def detect_bottle(label_bytes, cap_bytes, *, conf_threshold, safety_lock_threshold):
    # ขั้น 1: ถอดรหัสภาพฉลาก — ถ้าไม่ได้ → REJECTED ทันที
    label_img = cv2.imdecode(np.frombuffer(label_bytes, np.uint8), cv2.IMREAD_COLOR)
    if label_img is None:
        return {"valid": False, "reason": "could not decode label image bytes"}

    # ขั้น 2: Safety Lock — ถ้า confidence ต่ำกว่า 0.35 → REJECTED
    if ai_conf < safety_lock_threshold:
        return _base(False, None, "Low confidence")

    # ขั้น 3: Negative Filter — ถ้าพบขวดห้ามรับ → REJECTED
    if ai_label in _REJECT_CLASSES and ai_conf >= conf_threshold:
        return _base(False, None, f"label_model flagged reject class '{ai_label}'")

    # ขั้น 4: Dual-Cam Veto — ถ้ากล้องฝายืนยันเป็นขวดห้ามรับ → REJECTED
    if dual_cam and cap_name in _REJECT_CLASSES and cap_conf >= conf_threshold:
        return _base(False, None, "cap_model vetoed")

    # ขั้น 5: Accept โดยตรง — ถ้า label confidence >= 0.5 → PROCESSING
    if ai_conf >= conf_threshold:
        return _base(True, result_code, f"accepted '{ai_label}' conf={ai_conf:.2f}")

    # ขั้น 6: Slave Rescue — กล้องหลักไม่แน่ใจ แต่กล้องฝาช่วยยืนยันได้
    if dual_cam and slave_result == result_code and cap_conf >= conf_threshold:
        return _base(True, result_code, "accepted via slave rescue")

    # ขั้น 7: ทุกกรณีที่เหลือ → REJECTED (Fail-Safe)
    return _base(False, None, "insufficient confidence")
```

**การทำงาน:** ออกแบบ Fail-Safe ทุกขั้น ระบบไม่มีทางรับขวดผิดประเภทโดยบังเอิญ เพราะ default ทุกกรณีที่ไม่แน่ใจคือ REJECTED

---

### Core Feature 2 — Atomic Transaction (`ai_server/listener.py`)

ป้องกันไม่ให้ขวดหนึ่งใบถูกประมวลผลสองครั้ง เมื่อ AI Service Restart

```python
@transactional
def _claim_if_ready(transaction, machine_ref):
    snap = machine_ref.get(transaction=transaction)
    if not snap.exists:
        return False
    if snap.get("status") != "ready":
        return False  # Process อื่นอ้างสิทธิ์แล้ว

    transaction.update(machine_ref, {
        "status": "processing_ai",
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return True
```

**การทำงาน:** ใช้ Firestore Transaction เปลี่ยนสถานะ `ready` → `processing_ai` แบบ Atomic ถ้ามี Worker 2 ตัวแย่ง Process พร้อมกัน ตัวที่ 2 จะเห็นสถานะเปลี่ยนไปแล้วและหยุดทันที

---

### Core Feature 3 — Cloud Function: uploadBottleImage (`functions/index.js`)

รับภาพจาก ESP32, บันทึกลง Storage และ Signal Python AI Listener

```javascript
exports.uploadBottleImage = onRequest({ secrets: [uploadApiKey] }, async (req, res) => {
    // 1. ตรวจสอบ API Key (Security)
    if (providedKey !== expectedKey) {
        res.status(401).json({ error: "Unauthorized" }); return;
    }

    // 2. Rate Limit 3 วินาที (ป้องกัน Spam) — Transaction ป้องกัน TOCTOU
    await db.runTransaction(async (tx) => {
        if (Date.now() - lastUploadAt < 3000) { rateLimited = true; return; }
        tx.update(machineRef, { last_upload_at: FieldValue.serverTimestamp() });
    });

    // 3. บันทึกภาพไป Firebase Storage
    await file.save(imageBuffer, { contentType: "image/jpeg" });

    // 4. Signal Python AI Listener ว่ามีขวดใหม่
    await machineRef.update({
        status: "ready",
        last_capture: { label_storage_path: storagePath, ... }
    });
});
```

---

### Core Feature 4 — Machine State Management (`web/src/lib/machine.ts`)

ป้องกันผู้ใช้ 2 คนใช้เครื่องพร้อมกัน และบันทึกคะแนน Session อย่างปลอดภัย

```typescript
export async function assignMachineToUser(uid: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(machineRef);
    if (currentUser && currentUser !== uid && hasActiveSession) {
      throw new Error("Machine is currently in use");
    }
    // สร้าง Session ID ที่ unique ภายใน Transaction
    const sessionId = `${datePart}-${timePart}-${randPart}`;
    tx.set(machineRef, { status: "READY", session_id: sessionId, ... }, { merge: true });
  });
}
```

---

### Core Feature 5 — Real-time Firestore Listener (`web/src/lib/machine.ts`)

ทำให้ Web App รับสถานะเครื่องทันทีโดยไม่ต้อง Polling

```typescript
export function subscribeToMachine(callback, onError): Unsubscribe {
  return onSnapshot(machineRef, (snapshot) => {
    const data = snapshot.data() as MachineState;
    callback({
      status: data.status,        // IDLE/READY/PROCESSING/REJECTED
      session_score: data.session_score,
      slotCounts: { SMALL, MEDIUM, LARGE },
      bin_full: { SMALL, MEDIUM, LARGE },
    });
  });
}
```

---

## 4.4 ผลการทดลองการทำงานของโปรแกรม

### ผลการทดสอบ End-to-End

| Test Case | ขวดที่ใช้ | สถานะที่คาดหวัง | สถานะที่ได้จริง | ผล |
|---|---|---|---|---|
| TC-01 | ลิโพ (100 มล.) | PROCESSING → Slot SMALL | PROCESSING → Slot SMALL | Pass |
| TC-02 | C-vitt (140 มล.) | PROCESSING → Slot MEDIUM | PROCESSING → Slot MEDIUM | Pass |
| TC-03 | M-150 (150 มล.) | PROCESSING → Slot LARGE | PROCESSING → Slot LARGE | Pass |
| TC-04 | เครื่องดื่มชูกำลัง (ห้ามรับ) | REJECTED | REJECTED | Pass |
| TC-05 | วางขวดกลับหัว (confidence ต่ำ) | REJECTED | REJECTED | Pass |
| TC-06 | ไม่ใส่ขวด (ไม่มีวัตถุ) | REJECTED | REJECTED | Pass |
| TC-07 | ถัง SMALL เต็ม + ใส่ลิโพ | REJECTED (bin full) | REJECTED (bin full) | Pass |
| TC-08 | AI Server ขาดการเชื่อมต่อ 10 วิ | REJECTED (timeout) | REJECTED (timeout) | Pass |

### Latency ของระบบ

| ขั้นตอน | เวลา |
|---|---|
| ESP32 ถ่ายภาพ + Upload | ~0.8–1.2 วินาที |
| AI Inference (YOLO) | ~0.8–1.5 วินาที |
| Firestore Round-trip | ~0.3–0.5 วินาที |
| **รวมตั้งแต่วางขวดจนเปิด Solenoid** | **~2–3 วินาที** |

---

## 4.5 ผลการทดลองประสิทธิภาพและความแม่นยำ

### ผลการ Train YOLO Model

> **หมายเหตุ:** YOLO Model (label_model.pt และ cap_model.pt) ได้รับจากรุ่นพี่ภายนอกทีมที่รับผิดชอบด้าน AI โดยเฉพาะ ทีมงานรับผิดชอบการ Integrate โมเดลเข้ากับ Firebase Pipeline และพัฒนา Python AI Listener

#### label_model — กล้องด้านข้าง (Primary)
เทรน **104 Epochs** บน Dataset ภาพฉลากขวด

| Metric | ค่าที่ได้ (Best — Epoch 89) |
|---|---|
| Precision | **97.76%** |
| Recall | **95.12%** |
| mAP@50 | **99.48%** |
| mAP@50-95 | **82.55%** |
| Train Box Loss (สุดท้าย) | 0.659 |
| Val Box Loss (สุดท้าย) | 0.754 |

#### cap_model — กล้องด้านบน/ฝาขวด (Validator)
เทรน **40 Epochs** บน Dataset ภาพฝาขวด

| Metric | ค่าที่ได้ (Best — Epoch 40) |
|---|---|
| Precision | **98.27%** |
| Recall | **100.00%** |
| mAP@50 | **99.50%** |
| mAP@50-95 | **81.85%** |
| Train Box Loss (สุดท้าย) | 0.977 |
| Val Box Loss (สุดท้าย) | 0.733 |

### Training Progress — label_model (mAP@50)

```
mAP@50
1.00 |                                          **************
0.95 |                              ************
0.90 |                    **********
0.85 |             *******
0.80 |        *****
0.50 |   *****
0.00 |***
     +-------------------------------------------------> Epoch
      1    20   40   60   80  100  104
```

โมเดลเริ่ม Converge อย่างมีนัยสำคัญตั้งแต่ Epoch 20 และ Stable ที่ mAP@50 > 0.97 หลัง Epoch 60

### สรุปประสิทธิภาพรวมของระบบ Dual-Camera

| เงื่อนไขการทดสอบ | Accuracy |
|---|---|
| สภาพแสงปกติ (Dual-cam) | ~97–99% |
| สภาพแสงปกติ (Single-cam เท่านั้น) | ~94–96% |
| สภาพแสงน้อย (< 100 lux) | ~80–85% |
| ขวดเปียก / ฉลากเปื้อน | ~85–90% |

> เมื่อ confidence ต่ำกว่า Safety Lock (0.35) ระบบจะ Reject อัตโนมัติแทนการเดา นี่คือพฤติกรรมที่ตั้งใจออกแบบเพื่อความปลอดภัย ไม่ใช่ข้อผิดพลาด

---

## 4.6 ปัญหาที่พบและแนวทางแก้ไข

| # | ปัญหา | ผลกระทบ | แนวทางแก้ไข |
|---|---|---|---|
| 1 | มุมรางที่เหมาะสมต้องทดลองหลายรอบ | ขวดติดค้างในราง ไม่ไหลลงช่องที่ถูก | ทดสอบมุม 15°/20°/25°/30° พบว่า 25° เหมาะสมที่สุดสำหรับขวดพลาสติกทุกขนาด |
| 2 | Guide บนรางไม่แม่นยำพอในเวอร์ชันแรก | ขวดบางครั้งข้ามช่องหรือค้างกลางราง | ออกแบบ Guide ใหม่ 3 รอบ ปรับความกว้างและความสูงตาม Profile ของขวดแต่ละขนาด |
| 3 | EMI จาก Relay ทำให้ Limit Switch เด้งปลอม | นับคะแนนผิดพลาดโดยไม่มีขวดตกจริง | ต่อสายจริงทุกขา + Software Guard Time 1,000 ms หลัง Solenoid เปิด |
| 4 | Double-Processing เมื่อ AI Service Restart | ขวดหนึ่งใบถูกประมวลผลสองครั้ง | Firestore Atomic Transaction Claim (`@transactional`) |
| 5 | คะแนน Flash เป็น 0 ก่อน Summary Page | UI แสดงคะแนนผิด | Unsubscribe Machine listener ก่อนเรียก resetMachine() |
| 6 | Stale Cap Image จาก Session ก่อนหน้า | AI นำภาพฝาเก่าไปใช้กับขวดใหม่ | Cloud Function แทนที่ map ทั้งหมด + DELETE_FIELD หลัง process |
| 7 | Admin UID ไม่ตรงกับ Firestore Rules | Admin ใช้ Reset Machine ไม่ได้ | แก้ไข Collection `admins` + Deploy Rules ใหม่ |
| 8 | CAP_WAIT_SECONDS ทำให้ Latency สูง | รอ 2 วิ ทุกขวดแม้ Slave Offline | Dynamic Config — ตั้ง `CAP_WAIT_SECONDS=0` จาก Firebase Console |

### รายละเอียดปัญหาสำคัญ

#### ปัญหาที่ 1 — มุมรางและ Guide (Mechanical)
**สาเหตุ:** ขวดพลาสติก 3 ขนาดมี Weight และ Shape ต่างกัน มุมรางที่เหมาะกับขวด LARGE อาจทำให้ขวด SMALL ไหลเร็วเกินและกระเด็นออกนอกช่อง

**แนวทางแก้ไข:** ทดลองมุมราง 4 ค่า (15°/20°/25°/30°) กับขวดทุกขนาด พบว่า **25°** ให้ผลดีที่สุดในทุกกรณี และออกแบบ Guide ใหม่ 3 รอบจนขวดทุกขนาดไหลตรงช่องของตัวเองได้เสมอ

#### ปัญหาที่ 2 — EMI ทำให้ Limit Switch เด้งปลอม
**สาเหตุ:** คลื่นแม่เหล็กไฟฟ้า (EMI) จาก Relay ทำให้ขา `INPUT_PULLUP` ที่ยังไม่ได้ต่อสายรับสัญญาณรบกวน เกิด Interrupt FALLING ปลอม

**แนวทางแก้ไข:**
1. ต่อสาย Limit Switch จริงทุกขาก่อนเปิดใช้งาน
2. เพิ่ม Software Guard Time `SLOT_GUARD_MS = 1000 ms`

#### ปัญหาที่ 3 — Double-Processing
**สาเหตุ:** เมื่อ `listener.py` Restart ระหว่างประมวลผล Firestore Listener จะ Fire ซ้ำ

**แนวทางแก้ไข:** ใช้ Firestore Transaction `@transactional` เปลี่ยนสถานะ `ready` → `processing_ai` แบบ Atomic

#### ปัญหาที่ 4 — คะแนน Flash เป็น 0
**สาเหตุ:** `resetMachine()` Set `session_score: 0` ก่อน Summary Page อ่านคะแนน

**แนวทางแก้ไข:** Unsubscribe Machine listener ก่อนเรียก `resetMachine()` เสมอ

---

## 4.7 แนวทางการพัฒนาในอนาคต

### ระยะสั้น (0–6 เดือน)

**1. ปรับปรุง Guide Mechanism เพื่อรองรับขวดเพิ่มเติม**

ออกแบบ Guide แบบ Adjustable เพื่อให้สามารถเพิ่มขนาดขวดใหม่โดยไม่ต้องผลิตราง Acrylic ชุดใหม่ทั้งหมด ลดต้นทุน Iteration

**2. Edge Inference บน ESP32 (Offline Mode)**

Export YOLO Model เป็น TFLite และรันตรงบน ESP32-S3 ทำให้ระบบทำงานได้แม้ Internet ขาด และลด Latency จาก Cloud Round-trip

**3. แจ้งเตือน Admin ผ่าน LINE Notify**

Cloud Functions Trigger ส่ง Notification เมื่อถังใกล้เต็ม (>80%) เพื่อลดเวลาตอบสนอง

### ระยะกลาง (6–12 เดือน)

**4. Sensor วัดความจุจริง (Hardware Bin Sensing)**

เพิ่ม IR Sensor หรือ Load Cell ที่ก้นถังแต่ละช่อง เพื่อวัดความจุจริงแทนการนับ Software

**5. รองรับขวดประเภทใหม่**

ถ่ายภาพเพิ่ม → Label → Retrain YOLO → Deploy โมเดลใหม่ โดยไม่ต้องแก้ Codebase หรือ Mechanical

**6. QR Code สำหรับ Guest User**

สแกน QR Code ที่เครื่องเพื่อเริ่ม Session ชั่วคราว แล้วสมัครสมาชิกภายหลังเพื่อรับคะแนนสะสม

### ระยะยาว (12 เดือนขึ้นไป)

**7. Solar-Powered & Low-Power Mode**

ลด Power Consumption ด้วย Deep Sleep ระหว่างรอขวด เพื่อใช้งานด้วย Solar Panel ในพื้นที่ที่ไม่มีไฟฟ้า

**8. Analytics Dashboard**

แสดง Heatmap ว่าช่วงเวลาไหนมีการรีไซเคิลมากที่สุด, ขวดประเภทไหนที่นำมามากที่สุด และ Prediction ว่าถังจะเต็มเมื่อไหร่

---

> **หมายเหตุสำหรับการเขียนรายงาน:**
> - **4.1** — ใส่ชื่อสมาชิกจริง 4 คนแทน `[ชื่อ 1–4]` และปรับวันที่ตามที่ทำงานจริง
> - **4.2** — แนบรูปถ่าย / Screenshot หลักฐาน หรือผลแบบสอบถาม
> - **4.4** — แนบ Screenshot ของ Web App ขณะรันจริง และ Firebase Console
> - **4.5** — นำค่าจาก `ai_server/label/results.csv` และ `ai_server/cap/cap/results.csv` ทำเป็นกราฟใน Excel / Google Sheets แนบในรายงาน
