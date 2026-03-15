"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@heroui/react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { assignMachineToUser, forceSetStatus, subscribeToMachine, subscribeToSortingLogs, type SortingLog } from "@/lib/machine";
import { MachineStatusCard } from "@/components/machine-status-card";
import { MachineWaitingAnimation } from "@/components/machine-waiting-animation";
import { SortingHistoryTable } from "@/components/sorting-history-table";
import { type MachineState } from "@/types/machine";

function SystemStatusBadge({
  status,
  authReady,
  hasError,
}: {
  status: MachineState["status"];
  authReady: boolean;
  hasError: boolean;
}) {
  const isOffline = !authReady || hasError;
  const isActive = !isOffline && (status === "READY" || status === "PROCESSING" || status === "REJECTED");
  const label = isOffline ? "Offline" : isActive ? "Active" : "Idle";
  const dotColor = isOffline ? "bg-red-500" : isActive ? "bg-blue-500" : "bg-green-500";
  const textColor = isOffline ? "text-red-600" : isActive ? "text-blue-600" : "text-green-600";
  const bgColor = isOffline ? "bg-red-50" : isActive ? "bg-blue-50" : "bg-green-50";

  return (
    <div className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full ${bgColor}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor} ${!isOffline ? "animate-pulse" : ""}`} />
      <span className={`text-xs font-medium ${textColor}`}>System Status: {label}</span>
    </div>
  );
}

const initialState: MachineState = {
  status: "IDLE",
  current_user: "",
  session_score: 0,
};

export default function DashboardPage() {
  const router = useRouter();
  const [machine, setMachine] = useState<MachineState>(initialState);
  const [authReady, setAuthReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [sortingLogs, setSortingLogs] = useState<SortingLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeMachine: (() => void) | null = null;
    let unsubscribeLogs: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setAuthReady(true);
      if (user) {
        if (unsubscribeMachine) {
          unsubscribeMachine();
          unsubscribeMachine = null;
        }
        try {
          await user.getIdToken();
          if (cancelled) return;
          await assignMachineToUser(user.uid);
          if (cancelled) return;
          setSessionError(null);
          unsubscribeMachine = subscribeToMachine(
            (state) => {
              setMachine(state);
              if (state.status === "COMPLETED") {
                router.push("/summary");
              }
            },
            (error) => {
              if (auth.currentUser) {
                console.error("Machine listener error:", error);
                router.replace("/login");
              }
            },
          );
          unsubscribeLogs = subscribeToSortingLogs(setSortingLogs);
        } catch (err) {
          if (cancelled) return;
          console.error("Failed to initialize machine session:", err);
          const message = err instanceof Error ? err.message : "ไม่สามารถเริ่มเซสชันได้";
          setSessionError(message);
        }
        return;
      }

      if (unsubscribeMachine) {
        unsubscribeMachine();
        unsubscribeMachine = null;
      }
      if (unsubscribeLogs) {
        unsubscribeLogs();
        unsubscribeLogs = null;
      }
      router.replace("/login");
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      if (unsubscribeMachine) unsubscribeMachine();
      if (unsubscribeLogs) unsubscribeLogs();
    };
  }, [router]);

  const endSessionNow = async () => {
    setEnding(true);
    try {
      await forceSetStatus("COMPLETED");
      router.push("/summary?manual=1");
    } finally {
      setEnding(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md flex flex-col gap-4">
        {/* Header */}
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold text-gray-800">แดชบอร์ด</h1>
          <p className="text-gray-400 text-sm">ใส่ขวดเพื่อเริ่มสะสมคะแนน</p>
          <SystemStatusBadge status={machine.status} authReady={authReady} hasError={!!sessionError} />
        </div>

        {!authReady && <MachineWaitingAnimation />}

        <MachineStatusCard status={machine.status} score={machine.session_score} />

        {(machine.status === "READY" || machine.status === "PROCESSING") && (
          <MachineWaitingAnimation />
        )}

        {machine.status === "REJECTED" && (
          <Alert color="warning" title="ขวดไม่ผ่านการตรวจสอบ กรุณาใส่ขวดใบถัดไป" />
        )}

        {sessionError && (
          <Alert color="danger" title={sessionError} />
        )}

        <SortingHistoryTable logs={sortingLogs} />

        <p className="text-center text-xs text-gray-400">
          เซสชันเริ่มต้นอัตโนมัติหลังเข้าสู่ระบบ และรับขวดจนกว่าจะกดสิ้นสุด
        </p>

        {/* Navigation */}
        <div className="grid grid-cols-2 gap-3">
          <Button as={Link} href="/profile" variant="flat" color="primary" className="font-medium">
            คะแนนของฉัน
          </Button>
          <Button as={Link} href="/rewards" variant="flat" color="primary" className="font-medium">
            ของรางวัล
          </Button>
        </div>

        <Button
          color="danger"
          variant="flat"
          onPress={endSessionNow}
          isLoading={ending}
          className="font-medium"
        >
          สิ้นสุดเซสชัน
        </Button>
      </div>
    </main>
  );
}
