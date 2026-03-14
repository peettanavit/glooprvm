import {
  doc,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { MACHINE_ID, type MachineState, type MachineStatus } from "@/types/machine";

const machineRef = doc(db, "machines", MACHINE_ID);

export async function assignMachineToUser(uid: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(machineRef);
    const current = snapshot.data() as MachineState | undefined;
    const currentUser = current?.current_user ?? "";
    const currentStatus = current?.status ?? "IDLE";
    const hasActiveSession = currentStatus === "READY" || currentStatus === "PROCESSING" || currentStatus === "REJECTED";

    if (currentUser === uid && hasActiveSession) {
      return;
    }

    if (currentUser && currentUser !== uid && hasActiveSession) {
      throw new Error("Machine is currently in use");
    }

    const sessionId = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${uid}-${Date.now()}`;

    tx.set(
      machineRef,
      {
        status: "READY",
        current_user: uid,
        session_score: 0,
        session_id: sessionId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function resetMachine(): Promise<void> {
  await updateDoc(machineRef, {
    status: "IDLE" as MachineStatus,
    current_user: "",
    session_score: 0,
    session_id: "",
    updatedAt: serverTimestamp(),
  });
}

export async function forceSetStatus(status: MachineStatus): Promise<void> {
  await updateDoc(machineRef, { status });
}

export async function addDebugScore(value: number): Promise<void> {
  await updateDoc(machineRef, { session_score: increment(value) });
}

export async function persistUserSessionScore(
  uid: string,
  state: MachineState,
): Promise<boolean> {
  const sessionId = state.session_id ?? "";
  if (!sessionId) {
    throw new Error("Missing session_id");
  }

  const userRef = doc(db, "users", uid);
  const sessionRef = doc(db, "users", uid, "sessions", sessionId);
  let created = false;

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(sessionRef);
    if (existing.exists()) {
      return;
    }

    tx.set(sessionRef, {
      machine_id: MACHINE_ID,
      score: state.session_score ?? 0,
      completed_at: serverTimestamp(),
    });
    tx.set(
      userRef,
      {
        total_score: increment(state.session_score ?? 0),
        session_count: increment(1),
        updated_at: serverTimestamp(),
      },
      { merge: true },
    );
    created = true;
  });

  return created;
}

export function subscribeToMachine(
  callback: (state: MachineState) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    machineRef,
    (snapshot) => {
      const data = snapshot.data() as MachineState | undefined;
      if (!data) {
        callback({ status: "IDLE", current_user: "", session_score: 0, session_id: "" });
        return;
      }

      callback({
        status: data.status,
        current_user: data.current_user ?? "",
        session_score: data.session_score ?? 0,
        session_id: data.session_id ?? "",
      });
    },
    (error) => {
      if (onError) {
        onError(error);
      }
    },
  );
}
