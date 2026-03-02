"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { persistUserSessionScore, resetMachine, subscribeToMachine } from "@/lib/machine";
import { type MachineState } from "@/types/machine";

const initialState: MachineState = {
  status: "IDLE",
  current_user: "",
  session_score: 0,
};

export default function SummaryPage() {
  const router = useRouter();
  const [manualMode, setManualMode] = useState(false);
  const [machine, setMachine] = useState<MachineState>(initialState);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedSessionRef = useRef<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setManualMode(params.get("manual") === "1");
  }, []);

  useEffect(() => {
    let unsubscribeMachine: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeMachine) {
        unsubscribeMachine();
        unsubscribeMachine = null;
      }

      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        await user.getIdToken();
        unsubscribeMachine = subscribeToMachine(
          (state) => {
            setMachine(state);
            if (!manualMode && state.status !== "COMPLETED") {
              router.replace("/dashboard");
              return;
            }

            if (state.current_user !== user.uid || !state.session_id) {
              return;
            }

            if (savedSessionRef.current === state.session_id) {
              return;
            }

            setSaving(true);
            setSaveError(null);
            void persistUserSessionScore(user.uid, state)
              .then(() => {
                savedSessionRef.current = state.session_id ?? "";
                setSaved(true);
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : "Failed to save score";
                setSaveError(message);
              })
              .finally(() => {
                setSaving(false);
              });
          },
          (error) => {
            console.error("Machine listener error:", error);
            router.replace("/login");
          },
        );
      } catch (error) {
        console.error("Failed to initialize summary listener:", error);
        router.replace("/login");
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeMachine) {
        unsubscribeMachine();
      }
    };
  }, [manualMode, router]);

  const onEndSession = async () => {
    await resetMachine();
    await signOut(auth);
    router.replace("/login");
  };

  return (
    <main>
      <Card style={{ width: "100%", maxWidth: 520 }}>
        <CardHeader>
          <h1 style={{ margin: 0 }}>Session Summary</h1>
        </CardHeader>
        <CardBody style={{ display: "grid", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 18 }}>
            Total Score: <strong>{machine.session_score}</strong>
          </p>
          {saving && <p style={{ margin: 0, color: "#4b5563" }}>Saving score...</p>}
          {saved && !saveError && <p style={{ margin: 0, color: "#047857" }}>Score saved.</p>}
          {saveError && <p style={{ margin: 0, color: "#dc2626" }}>{saveError}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button as={Link} href="/profile" color="primary" variant="flat">
              My Points
            </Button>
            <Button as={Link} href="/rewards" variant="flat">
              Rewards
            </Button>
            <Button color="primary" onPress={onEndSession}>
              Confirm & Finish
            </Button>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
