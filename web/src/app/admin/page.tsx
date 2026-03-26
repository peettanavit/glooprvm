"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  type ChipProps,
} from "@heroui/react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  resetMachine,
  restartSlave,
  subscribeToMachine,
  subscribeToSortingLogs,
  triggerSlotEvent,
  updateBinFull,
  type SortingLog,
} from "@/lib/machine";
import { LiveSortingStatus } from "@/components/live-sorting-status";
import { BIN_CAPACITY, BIN_WARN_THRESHOLD, type MachineState, type MachineStatus } from "@/types/machine";

const initialMachine: MachineState = {
  status: "IDLE",
  current_user: "",
  session_score: 0,
  session_id: "",
};

function statusChipColor(status: MachineStatus): ChipProps["color"] {
  switch (status) {
    case "IDLE":
      return "default";
    case "READY":
      return "success";
    case "PROCESSING":
      return "primary";
    case "REJECTED":
      return "warning";
    case "COMPLETED":
      return "secondary";
    default:
      return "default";
  }
}

export default function AdminPage() {
  const router = useRouter();
  const [machine, setMachine] = useState<MachineState>(initialMachine);
  const [logs, setLogs] = useState<SortingLog[]>([]);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [restartingslave, setRestartingSlave] = useState(false);
  const [restartSlaveError, setRestartSlaveError] = useState<string | null>(null);
  const [slotLoading, setSlotLoading] = useState<"SMALL" | "MEDIUM" | "LARGE" | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeMachine: (() => void) | null = null;
    let unsubscribeLogs: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeMachine) { unsubscribeMachine(); unsubscribeMachine = null; }
      if (unsubscribeLogs) { unsubscribeLogs(); unsubscribeLogs = null; }

      if (!user) { router.replace("/login"); return; }

      try {
        await user.getIdToken(); // force-refresh token before Firestore reads
        if (cancelled) return;

        const adminSnap = await getDoc(doc(db, "admins", user.uid));
        if (cancelled) return;
        if (!adminSnap.exists()) {
          router.replace("/dashboard");
          return;
        }

        unsubscribeMachine = subscribeToMachine(setMachine, (error) => {
          console.error("Machine listener error:", error);
        });

        unsubscribeLogs = subscribeToSortingLogs(setLogs, (error) => {
          console.error("Logs listener error:", error);
        });
      } catch {
        if (!cancelled) router.replace("/login");
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      if (unsubscribeMachine) unsubscribeMachine();
      if (unsubscribeLogs) unsubscribeLogs();
    };
  }, [router]);

  const handleResetMachine = async () => {
    setResetting(true);
    setResetError(null);
    try {
      await resetMachine();
    } catch (err) {
      if (err instanceof Error) {
        setResetError(err.message);
      } else {
        setResetError("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
      }
    } finally {
      setResetting(false);
    }
  };

  // Auto-write bin_full to Firestore whenever slotCounts change
  useEffect(() => {
    if (!machine.slotCounts) return;
    const { SMALL, MEDIUM, LARGE } = machine.slotCounts;
    const next = {
      SMALL:  SMALL  >= BIN_CAPACITY.SMALL,
      MEDIUM: MEDIUM >= BIN_CAPACITY.MEDIUM,
      LARGE:  LARGE  >= BIN_CAPACITY.LARGE,
    };
    const prev = machine.bin_full;
    if (
      prev?.SMALL  !== next.SMALL ||
      prev?.MEDIUM !== next.MEDIUM ||
      prev?.LARGE  !== next.LARGE
    ) {
      updateBinFull(next).catch((err) => console.error("updateBinFull failed:", err));
    }
  }, [machine.slotCounts, machine.bin_full]);

  const handleSlotEvent = async (size: "SMALL" | "MEDIUM" | "LARGE") => {
    setSlotLoading(size);
    setSlotError(null);
    try {
      await triggerSlotEvent(size);
    } catch (err) {
      setSlotError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSlotLoading(null);
    }
  };

  const handleRestartSlave = async () => {
    setRestartingSlave(true);
    setRestartSlaveError(null);
    try {
      await restartSlave();
    } catch (err) {
      if (err instanceof Error) {
        setRestartSlaveError(err.message);
      } else {
        setRestartSlaveError("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
      }
    } finally {
      setRestartingSlave(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg flex flex-col gap-4">

        {/* Header */}
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
          <p className="text-gray-400 text-sm">จัดการและติดตามสถานะเครื่อง Gloop</p>
        </div>

        {/* Machine Status */}
        <Card className="shadow-sm border border-green-100">
          <CardHeader className="pb-2 px-5 pt-4 flex justify-between items-center">
            <h2 className="text-base font-semibold text-gray-700">สถานะเครื่อง</h2>
            <Chip color={statusChipColor(machine.status)} variant="flat" size="sm">
              {machine.status}
            </Chip>
          </CardHeader>
          <CardBody className="pt-0 px-5 pb-4">
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">ผู้ใช้ปัจจุบัน</span>
                <span className="text-gray-800 font-medium truncate max-w-[220px]">
                  {machine.current_user || "—"}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">คะแนนในเซสชัน</span>
                <span className="text-green-700 font-bold">{machine.session_score}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Session ID</span>
                <span className="text-gray-400 font-mono text-xs truncate max-w-[220px]">
                  {machine.session_id || "—"}
                </span>
              </div>
            </div>

            {resetError && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm">{resetError}</p>
              </div>
            )}

            {restartSlaveError && (
              <div className="mt-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                <p className="text-orange-600 text-sm">{restartSlaveError}</p>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                color="danger"
                variant="flat"
                className="flex-1 font-medium"
                isLoading={resetting}
                onPress={handleResetMachine}
              >
                Reset Machine
              </Button>
              <Button
                color="warning"
                variant="flat"
                className="flex-1 font-medium"
                isLoading={restartingslave}
                onPress={handleRestartSlave}
              >
                Restart Slave
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Simulate Slot Event */}
        <Card className="shadow-sm border border-blue-100">
          <CardHeader className="pb-2 px-5 pt-4 flex justify-between items-center">
            <div>
              <h2 className="text-base font-semibold text-gray-700">จำลอง Limit Switch</h2>
              <p className="text-xs text-gray-400 mt-0.5">ใช้ได้เฉพาะเมื่อ status = PROCESSING</p>
            </div>
            <Chip
              color={machine.status === "PROCESSING" ? "primary" : "default"}
              variant="flat"
              size="sm"
            >
              {machine.status === "PROCESSING" ? "พร้อมใช้" : "ไม่พร้อม"}
            </Chip>
          </CardHeader>
          <CardBody className="pt-0 px-5 pb-4">
            <div className="flex gap-2">
              {(
                [
                  { size: "SMALL",  label: "Small",  sub: "Lipoviton (+1)", color: "success" },
                  { size: "MEDIUM", label: "Medium", sub: "C-Vitt (+2)",    color: "primary" },
                  { size: "LARGE",  label: "Large",  sub: "M-150 (+3)",     color: "secondary" },
                ] as const
              ).map(({ size, label, sub, color }) => (
                <Button
                  key={size}
                  color={color}
                  variant="flat"
                  className="flex-1 flex-col h-auto py-3 font-medium"
                  isDisabled={machine.status !== "PROCESSING"}
                  isLoading={slotLoading === size}
                  onPress={() => handleSlotEvent(size)}
                >
                  <span className="text-sm">{label}</span>
                  <span className="text-xs opacity-70">{sub}</span>
                </Button>
              ))}
            </div>
            {slotError && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm">{slotError}</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Slot Counts */}
        <Card className="shadow-sm border border-green-100">
          <CardHeader className="pb-2 px-5 pt-4">
            <h2 className="text-base font-semibold text-gray-700">ความจุถังรองรับ</h2>
          </CardHeader>
          <CardBody className="pt-0 px-5 pb-4">
            <div className="flex flex-col gap-3 text-sm">
              {(
                [
                  { key: "SMALL",  label: "Small (Lipoviton)", count: machine.slotCounts?.SMALL  ?? 0, cap: BIN_CAPACITY.SMALL },
                  { key: "MEDIUM", label: "Medium (C-Vitt)",   count: machine.slotCounts?.MEDIUM ?? 0, cap: BIN_CAPACITY.MEDIUM },
                  { key: "LARGE",  label: "Large (M-150)",     count: machine.slotCounts?.LARGE  ?? 0, cap: BIN_CAPACITY.LARGE },
                ] as const
              ).map(({ key, label, count, cap }) => {
                const pct = Math.min(count / cap, 1);
                const isFull = pct >= 1;
                const isWarn = !isFull && pct >= BIN_WARN_THRESHOLD;
                const barColor = isFull ? "bg-red-500" : isWarn ? "bg-yellow-400" : "bg-green-500";
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-base ${isFull ? "text-red-600" : isWarn ? "text-yellow-600" : "text-green-700"}`}>
                          {count}/{cap}
                        </span>
                        {isFull && (
                          <Chip color="danger" variant="flat" size="sm">เต็ม</Chip>
                        )}
                        {isWarn && (
                          <Chip color="warning" variant="flat" size="sm">ใกล้เต็ม</Chip>
                        )}
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Sorting Logs */}
        <Card className="shadow-sm border border-green-100">
          <CardHeader className="pb-2 px-5 pt-4 flex justify-between items-center">
            <h2 className="text-base font-semibold text-gray-700">ประวัติการคัดแยก</h2>
            <Chip color="default" variant="flat" size="sm">
              {logs.length} รายการ
            </Chip>
          </CardHeader>
          <CardBody className="pt-0 px-5 pb-4">
            {logs.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">ยังไม่มีข้อมูล</p>
            ) : (
              <div className="flex flex-col gap-0">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex justify-between items-start py-3 border-b border-gray-100 last:border-0 gap-3"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <p className="text-sm text-gray-700 font-medium">{log.bottle_type}</p>
                      <p className="text-xs text-gray-400 truncate">{log.user_id}</p>
                      {log.sorted_at && (
                        <p className="text-xs text-gray-400">
                          {log.sorted_at.toDate().toLocaleDateString("th-TH", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>
                    <Chip color="default" variant="flat" size="sm" className="shrink-0 font-mono text-xs">
                      {log.machine_id}
                    </Chip>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Live Sorting Status — real-time operator view */}
        <LiveSortingStatus />

        {/* Back link */}
        <Button as={Link} href="/dashboard" variant="flat" className="font-medium">
          กลับหน้าแดชบอร์ด
        </Button>
      </div>
    </main>
  );
}
