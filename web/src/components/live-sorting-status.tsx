"use client";

import { useEffect, useState } from "react";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { MACHINE_ID } from "@/types/machine";

// All statuses the machine document can ever have (including transient AI states)
type AnyMachineStatus =
  | "IDLE"
  | "READY"
  | "PROCESSING"
  | "REJECTED"
  | "COMPLETED"
  | "ready"          // set by Cloud Function — waiting for AI
  | "processing_ai"; // set by Python listener — AI running

interface LastCapture {
  ai_label?: string;
  ai_conf?: number;
  cap_name?: string;
  cap_conf?: number;
  dual_cam?: boolean;
  reason?: string;
  valid?: boolean;
}

interface LiveMachineData {
  status: AnyMachineStatus;
  slotCounts?: { SMALL: number; MEDIUM: number; LARGE: number };
  last_capture?: LastCapture;
}

const STATUS_LABEL: Record<AnyMachineStatus, string> = {
  IDLE:          "ว่าง",
  READY:         "พร้อมรับขวด",
  PROCESSING:    "กำลังรับขวด",
  REJECTED:      "ปฏิเสธขวด",
  COMPLETED:     "เสร็จสิ้น",
  ready:         "รอ AI ประมวลผล",
  processing_ai: "AI กำลังวิเคราะห์…",
};

const STATUS_COLOR: Record<AnyMachineStatus, string> = {
  IDLE:          "bg-gray-100 text-gray-500",
  READY:         "bg-green-100 text-green-700",
  PROCESSING:    "bg-blue-100 text-blue-700",
  REJECTED:      "bg-red-100 text-red-600",
  COMPLETED:     "bg-purple-100 text-purple-700",
  ready:         "bg-yellow-100 text-yellow-700",
  processing_ai: "bg-orange-100 text-orange-600",
};

const STATUS_DOT: Record<AnyMachineStatus, string> = {
  IDLE:          "bg-gray-400",
  READY:         "bg-green-500 animate-pulse",
  PROCESSING:    "bg-blue-500 animate-pulse",
  REJECTED:      "bg-red-500",
  COMPLETED:     "bg-purple-500",
  ready:         "bg-yellow-500 animate-pulse",
  processing_ai: "bg-orange-500 animate-pulse",
};

const BRAND_LABEL: Record<string, string> = {
  lipo_cap:    "Lipoviton (Small)",
  cvitt_cap:   "C-Vitt (Medium)",
  m150_cap:    "M-150 (Large)",
  ginseng_cap: "Ginseng (ไม่รับ)",
  "m-sport_cap": "M-Sport (ไม่รับ)",
  peptein_cap: "Peptein (ไม่รับ)",
  shark_cap:   "Shark (ไม่รับ)",
  none:        "ตรวจไม่พบ",
};

const SLOT_LABELS = [
  { key: "SMALL",  label: "Small",  brand: "Lipoviton", color: "text-green-600" },
  { key: "MEDIUM", label: "Medium", brand: "C-Vitt",    color: "text-blue-600" },
  { key: "LARGE",  label: "Large",  brand: "M-150",     color: "text-purple-600" },
] as const;

const initial: LiveMachineData = {
  status: "IDLE",
  slotCounts: { SMALL: 0, MEDIUM: 0, LARGE: 0 },
};

export function LiveSortingStatus() {
  const [data, setData] = useState<LiveMachineData>(initial);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const machineRef = doc(db, "machines", MACHINE_ID);
    const unsub = onSnapshot(
      machineRef,
      (snap) => {
        setConnected(true);
        if (!snap.exists()) return;

        const raw = snap.data();
        const sc = raw.slotCounts as Partial<{ SMALL: number; MEDIUM: number; LARGE: number }> | undefined;

        setData({
          status: (raw.status as AnyMachineStatus) ?? "IDLE",
          slotCounts: {
            SMALL:  sc?.SMALL  ?? 0,
            MEDIUM: sc?.MEDIUM ?? 0,
            LARGE:  sc?.LARGE  ?? 0,
          },
          last_capture: raw.last_capture as LastCapture | undefined,
        });
      },
      () => setConnected(false),
    );

    return () => unsub();
  }, []);

  const status       = data.status;
  const lastCapture  = data.last_capture;
  const slotCounts   = data.slotCounts ?? { SMALL: 0, MEDIUM: 0, LARGE: 0 };
  const aiLabel      = lastCapture?.ai_label ?? "—";
  const aiConf       = lastCapture?.ai_conf;
  const brandDisplay = BRAND_LABEL[aiLabel] ?? aiLabel;
  const isValid      = lastCapture?.valid;

  return (
    <div className="w-full max-w-md flex flex-col gap-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-700">Live Sorting Status</h2>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${
            connected ? "text-green-600" : "text-gray-400"
          }`}
        >
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? "bg-green-500 animate-pulse" : "bg-gray-300"
            }`}
          />
          {connected ? "Live" : "Connecting…"}
        </span>
      </div>

      {/* Status card */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white p-5">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">สถานะเครื่อง</p>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT[status]}`} />
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${STATUS_COLOR[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
          <span className="ml-auto text-xs text-gray-300 font-mono">{status}</span>
        </div>
      </div>

      {/* Last detected bottle */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white p-5">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">ขวดล่าสุดที่ตรวจพบ</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-bold text-gray-800">
              {aiLabel === "—" ? (
                <span className="text-gray-300">ยังไม่มีข้อมูล</span>
              ) : (
                brandDisplay
              )}
            </p>
            {aiConf !== undefined && aiLabel !== "—" && (
              <p className="text-xs text-gray-400 mt-0.5">
                ความมั่นใจ {(aiConf * 100).toFixed(1)}%
              </p>
            )}
          </div>

          {aiLabel !== "—" && (
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                isValid === true
                  ? "bg-green-100 text-green-700"
                  : isValid === false
                  ? "bg-red-100 text-red-600"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {isValid === true ? "รับแล้ว" : isValid === false ? "ปฏิเสธ" : "—"}
            </span>
          )}
        </div>

        {lastCapture?.reason && (
          <p className="text-xs text-gray-400 mt-2 truncate" title={lastCapture.reason}>
            {lastCapture.reason}
          </p>
        )}

        {lastCapture?.dual_cam === true && (
          <p className="text-xs text-blue-400 mt-1">Dual-cam verified</p>
        )}
      </div>

      {/* Slot counters */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white p-5">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">จำนวนขวดในแต่ละช่อง</p>
        <div className="flex flex-col gap-0 divide-y divide-gray-50">
          {SLOT_LABELS.map(({ key, label, brand, color }) => (
            <div key={key} className="flex items-center justify-between py-3">
              <div>
                <span className="text-sm font-medium text-gray-700">{label}</span>
                <span className="ml-2 text-xs text-gray-400">{brand}</span>
              </div>
              <span className={`text-2xl font-bold tabular-nums ${color}`}>
                {slotCounts[key]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
