"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody } from "@heroui/react";
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
  const [machine, setMachine] = useState<MachineState>(initialState);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedSessionRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
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
        if (cancelled) return;
        unsubscribeMachine = subscribeToMachine(
          (state) => {
            setMachine(state);
            const isManual = new URLSearchParams(window.location.search).get("manual") === "1";
            if (!isManual && state.status !== "COMPLETED") {
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
                sessionStorage.setItem("summaryViewed", state.session_id ?? "");
                // resetMachine failure is non-critical — score already saved;
                // scheduled Cloud Function will clean up stale sessions.
                return resetMachine().catch((err) => {
                  console.error("resetMachine failed (non-critical):", err);
                });
              })
              .catch((error: unknown) => {
                setSaveError("บันทึกคะแนนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
                console.error("persistUserSessionScore failed:", error);
              })
              .finally(() => {
                setSaving(false);
              });
          },
          (error) => {
            if (auth.currentUser) {
              console.error("Machine listener error:", error);
              router.replace("/login");
            }
          },
        );
      } catch (error) {
        console.error("Failed to initialize summary listener:", error);
        router.replace("/login");
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      if (unsubscribeMachine) {
        unsubscribeMachine();
      }
    };
  }, [router]);

  const onSignOut = async () => {
    await signOut(auth);
    router.replace("/login");
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md flex flex-col gap-4">
        {/* Header */}
        <div className="text-center mb-2">
          <div className="flex justify-center mb-2">
            <div className="bg-white rounded-2xl shadow-sm p-1.5 inline-flex">
              <Image src="/logo.jpg" alt="Gloop" width={72} height={72} className="rounded-xl" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">สรุปผลการรีไซเคิล</h1>
          <p className="text-gray-400 text-sm">ขอบคุณที่ร่วมรักษาสิ่งแวดล้อม</p>
        </div>

        {/* Score card */}
        <Card className="shadow-md border border-green-100">
          <CardBody className="py-8 px-6 text-center">
            <p className="text-gray-500 text-sm mb-2">คะแนนที่ได้รับเซสชันนี้</p>
            <p className="text-6xl font-bold text-green-600 mb-1">{machine.session_score}</p>
            <p className="text-gray-400 text-sm">คะแนน</p>

            <div className="mt-4 pt-4 border-t border-gray-100">
              {saving && <p className="text-gray-400 text-sm">กำลังบันทึกคะแนน...</p>}
              {saved && !saveError && (
                <p className="text-green-600 text-sm font-medium">บันทึกคะแนนเรียบร้อยแล้ว</p>
              )}
              {saveError && (
                <p className="text-red-500 text-sm">{saveError}</p>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button as={Link} href="/profile" color="primary" variant="flat" className="font-medium">
            คะแนนสะสม
          </Button>
          <Button as={Link} href="/rewards" variant="flat" className="font-medium">
            ของรางวัล
          </Button>
        </div>

        <Button as={Link} href="/dashboard" color="success" size="lg" className="font-semibold">
          ใส่ขวดอีกครั้ง
        </Button>

        <Button color="default" variant="flat" onPress={onSignOut} className="font-medium">
          ออกจากระบบ
        </Button>
      </div>
    </main>
  );
}
