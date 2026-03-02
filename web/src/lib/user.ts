import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface UserProfile {
  total_score: number;
  session_count: number;
}

export interface UserSessionHistory {
  id: string;
  score: number;
  machine_id: string;
  completed_at?: Timestamp;
}

export function subscribeToUserProfile(
  uid: string,
  callback: (profile: UserProfile) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const userRef = doc(db, "users", uid);
  return onSnapshot(
    userRef,
    (snapshot) => {
      const data = snapshot.data() as UserProfile | undefined;
      callback({
        total_score: data?.total_score ?? 0,
        session_count: data?.session_count ?? 0,
      });
    },
    (error) => {
      if (onError) {
        onError(error);
      }
    },
  );
}

export function subscribeToUserSessions(
  uid: string,
  callback: (sessions: UserSessionHistory[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const sessionsRef = collection(db, "users", uid, "sessions");
  const sessionsQuery = query(sessionsRef, orderBy("completed_at", "desc"), limit(10));

  return onSnapshot(
    sessionsQuery,
    (snapshot) => {
      const sessions: UserSessionHistory[] = snapshot.docs.map((sessionDoc) => {
        const data = sessionDoc.data() as Omit<UserSessionHistory, "id">;
        return {
          id: sessionDoc.id,
          score: data.score ?? 0,
          machine_id: data.machine_id ?? "Unknown",
          completed_at: data.completed_at,
        };
      });
      callback(sessions);
    },
    (error) => {
      if (onError) {
        onError(error);
      }
    },
  );
}
