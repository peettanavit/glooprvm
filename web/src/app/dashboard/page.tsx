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
              console.error("Machine listener error:", error);
              router.replace("/login");
            },
          );
        } catch (err) {
          console.error("Failed to initialize machine session:", err);
          const message = err instanceof Error ? err.message : "Failed to start machine session";
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
    <main>
      <section style={{ width: "100%", maxWidth: 560, display: "grid", gap: 12 }}>
        {!authReady && <MachineWaitingAnimation />}
        <MachineStatusCard status={machine.status} score={machine.session_score} />

        {(machine.status === "READY" || machine.status === "PROCESSING") && (
          <MachineWaitingAnimation />
        )}

        {machine.status === "REJECTED" && (
          <Alert color="warning" title="Bottle not accepted, please insert the next one." />
        )}

        {sessionError && (
          <Alert color="danger" title={sessionError} />
        )}

        <p style={{ margin: 0, fontSize: 14, color: "#4b5563" }}>
          Session starts automatically after login and keeps receiving bottles until you end it.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button as={Link} href="/profile" variant="flat">
            My Points
          </Button>
          <Button as={Link} href="/rewards" variant="flat">
            Rewards
          </Button>
        </div>

        <Button color="danger" variant="flat" onPress={endSessionNow} isLoading={ending}>
          End Session
        </Button>
      </section>
    </main>
  );
}
