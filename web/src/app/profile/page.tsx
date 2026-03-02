"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  subscribeToUserProfile,
  subscribeToUserSessions,
  type UserProfile,
  type UserSessionHistory,
} from "@/lib/user";

const initialProfile: UserProfile = {
  total_score: 0,
  session_count: 0,
};

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [sessions, setSessions] = useState<UserSessionHistory[]>([]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeSessions: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }
      if (unsubscribeSessions) {
        unsubscribeSessions();
        unsubscribeSessions = null;
      }

      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        await user.getIdToken();
        unsubscribeProfile = subscribeToUserProfile(user.uid, setProfile, () => router.replace("/login"));
        unsubscribeSessions = subscribeToUserSessions(user.uid, setSessions, () => router.replace("/login"));
      } catch (error) {
        console.error("Failed to initialize profile listeners:", error);
        router.replace("/login");
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
      if (unsubscribeSessions) {
        unsubscribeSessions();
      }
    };
  }, [router]);

  return (
    <main>
      <section style={{ width: "100%", maxWidth: 640, display: "grid", gap: 12 }}>
        <Card>
          <CardHeader>
            <h1 style={{ margin: 0 }}>My Points</h1>
          </CardHeader>
          <CardBody style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0 }}>
              Total Score: <strong>{profile.total_score}</strong>
            </p>
            <p style={{ margin: 0 }}>
              Sessions Completed: <strong>{profile.session_count}</strong>
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 style={{ margin: 0 }}>Recent Sessions</h2>
          </CardHeader>
          <CardBody style={{ display: "grid", gap: 8 }}>
            {sessions.length === 0 && <p style={{ margin: 0 }}>No session history yet.</p>}
            {sessions.map((session) => (
              <div
                key={session.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderBottom: "1px solid #e5e7eb",
                  paddingBottom: 8,
                }}
              >
                <span>{session.machine_id}</span>
                <strong>+{session.score}</strong>
              </div>
            ))}
          </CardBody>
        </Card>

        <div style={{ display: "flex", gap: 8 }}>
          <Button as={Link} href="/rewards" color="primary" variant="flat">
            View Rewards
          </Button>
          <Button as={Link} href="/dashboard" variant="flat">
            Back to Machine
          </Button>
        </div>
      </section>
    </main>
  );
}
