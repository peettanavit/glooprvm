"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@heroui/react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { assignMachineToUser, forceSetStatus, subscribeToMachine } from "@/lib/machine";
import { MachineStatusCard } from "@/components/machine-status-card";
import { MachineWaitingAnimation } from "@/components/machine-waiting-animation";
import { type MachineState } from "@/types/machine";

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

  useEffect(() => {
    let unsubscribeMachine: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setAuthReady(true);
      if (user) {
        try {
          await user.getIdToken();
          await assignMachineToUser(user.uid);
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
        } catch (err) {
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
      router.replace("/login");
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeMachine) {
        unsubscribeMachine();
      }
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
