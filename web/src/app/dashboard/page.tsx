"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Spinner } from "@heroui/react";
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
  waitingForMachine,
}: {
  status: MachineState["status"];
  authReady: boolean;
  hasError: boolean;
  waitingForMachine: boolean;
}) {
  const isWaiting = waitingForMachine;
  const isOffline = !isWaiting && (!authReady || hasError);
  const isActive = !isOffline && !isWaiting && (status === "READY" || status === "PROCESSING" || status === "REJECTED");
  const label = isWaiting ? "Waiting" : isOffline ? "Offline" : isActive ? "Active" : "Idle";
  const dotColor = isWaiting ? "bg-yellow-500" : isOffline ? "bg-red-500" : isActive ? "bg-blue-500" : "bg-green-500";
  const textColor = isWaiting ? "text-yellow-600" : isOffline ? "text-red-600" : isActive ? "text-blue-600" : "text-green-600";
  const bgColor = isWaiting ? "bg-yellow-50" : isOffline ? "bg-red-50" : isActive ? "bg-blue-50" : "bg-green-50";

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
  const [waitingForMachine, setWaitingForMachine] = useState(false);
  const [ending, setEnding] = useState(false);
  const [sortingLogs, setSortingLogs] = useState<SortingLog[]>([]);
  const lastActivityRef = useRef<number>(Date.now());

  // Refs so subscription callbacks always see the latest values without stale closures
  const waitingForMachineRef = useRef(false);
  const currentUidRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeMachine: (() => void) | null = null;
    let unsubscribeLogs: (() => void) | null = null;

    const tryAssign = async (uid: string) => {
      if (cancelled) return;
      try {
        await assignMachineToUser(uid);
        if (cancelled) return;
        setSessionError(null);
        setWaitingForMachine(false);
        waitingForMachineRef.current = false;
        // Set up logs subscription once assignment succeeds (idempotent: skip if already set up)
        if (!unsubscribeLogs) {
          unsubscribeLogs = subscribeToSortingLogs(setSortingLogs);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to assign machine to user:", err);
        const message = err instanceof Error ? err.message : "ไม่สามารถเริ่มเซสชันได้";
        setSessionError(message);
        if (message === "Machine is currently in use") {
          setWaitingForMachine(true);
          waitingForMachineRef.current = true;
        }
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setAuthReady(true);

      // Clean up previous machine subscription before creating a new one
      if (unsubscribeMachine) {
        unsubscribeMachine();
        unsubscribeMachine = null;
      }

      if (user) {
        currentUidRef.current = user.uid;

        try {
          await user.getIdToken();
          if (cancelled) return;

          // Always subscribe to the machine so the UI shows the real state,
          // regardless of whether assignment succeeds or fails.
          unsubscribeMachine = subscribeToMachine(
            (state) => {
              setMachine(state);

              if (state.status === "PROCESSING" || state.status === "REJECTED") {
                lastActivityRef.current = Date.now();
              }

              if (state.status === "COMPLETED" && !waitingForMachineRef.current) {
                window.location.href = "/summary";
              }

              // Auto-retry assignment when we're waiting and the machine becomes free
              if (
                waitingForMachineRef.current &&
                currentUidRef.current &&
                (state.status === "IDLE" ||
                  (state.status === "COMPLETED" &&
                    (state.current_user === "" || state.current_user === currentUidRef.current)))
              ) {
                tryAssign(currentUidRef.current);
              }
            },
            (error) => {
              if (auth.currentUser) {
                console.error("Machine listener error:", error);
                router.replace("/login");
              }
            },
          );

          // Attempt initial assignment after the subscription is live
          await tryAssign(user.uid);
        } catch (err) {
          if (cancelled) return;
          console.error("Failed to initialize machine session:", err);
          const message = err instanceof Error ? err.message : "ไม่สามารถเริ่มเซสชันได้";
          setSessionError(message);
        }
        return;
      }

      // User signed out
      currentUidRef.current = null;
      waitingForMachineRef.current = false;
      setWaitingForMachine(false);

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

  // Auto-end session after 10 minutes of inactivity (no bottles processed)
  useEffect(() => {
    const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
    const interval = setInterval(() => {
      if (
        machine.status === "READY" &&
        Date.now() - lastActivityRef.current > SESSION_TIMEOUT_MS
      ) {
        forceSetStatus("COMPLETED").then(() => {
          window.location.href = "/summary?manual=1";
        });
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [machine.status, router]);

  const endSessionNow = async () => {
    setEnding(true);
    try {
      await forceSetStatus("COMPLETED");
      window.location.href = "/summary?manual=1";
    } finally {
      setEnding(false);
    }
  };

  const isMachineInUseError = sessionError === "Machine is currently in use";
  const hasOtherError = !!sessionError && !isMachineInUseError;

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md flex flex-col gap-4">
        {/* Header */}
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold text-gray-800">แดชบอร์ด</h1>
          <p className="text-gray-400 text-sm">ใส่ขวดเพื่อเริ่มสะสมคะแนน</p>
          <SystemStatusBadge
            status={machine.status}
            authReady={authReady}
            hasError={hasOtherError}
            waitingForMachine={waitingForMachine}
          />
        </div>

        {!authReady && <MachineWaitingAnimation />}

        <MachineStatusCard status={machine.status} score={machine.session_score} />

        {(machine.status === "READY" || machine.status === "PROCESSING") && (
          <MachineWaitingAnimation />
        )}

        {machine.status === "REJECTED" && (
          <Alert color="warning" title="ขวดไม่ผ่านการตรวจสอบ กรุณาใส่ขวดใบถัดไป" />
        )}

        {/* Friendly waiting UI when another user is using the machine */}
        {waitingForMachine && (
          <div className="flex flex-col items-center justify-center gap-3 py-5 px-4 rounded-xl bg-yellow-50 border border-yellow-200">
            <Spinner size="lg" color="warning" />
            <p className="text-yellow-700 text-sm font-medium text-center">
              เครื่องกำลังถูกใช้งาน กรุณารอสักครู่...
            </p>
            <p className="text-yellow-500 text-xs text-center">
              ระบบจะเริ่มเซสชันอัตโนมัติเมื่อเครื่องว่าง
            </p>
          </div>
        )}

        {hasOtherError && (
          <Alert color="danger" title={sessionError!} />
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
