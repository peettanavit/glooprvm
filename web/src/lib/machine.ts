import {
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { MACHINE_ID, type BinFull, type MachineState, type MachineStatus, type SlotCounts } from "@/types/machine";

export interface SortingLog {
  id: string;
  machine_id: string;
  bottle_type: string;
  user_id: string;
  session_id: string;
  sorted_at?: Timestamp;
}

const machineRef = doc(db, "machines", MACHINE_ID);

export async function assignMachineToUser(uid: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(machineRef);
    const current = snapshot.data() as MachineState | undefined;
    const currentUser = current?.current_user ?? "";
    const currentStatus = current?.status ?? "IDLE";
    const hasActiveSession = currentStatus === "READY" || currentStatus === "PROCESSING" || currentStatus === "REJECTED"
      || (currentStatus as string) === "ready" || (currentStatus as string) === "processing_ai";

    if (currentUser === uid && hasActiveSession) {
      return;
    }

    if (currentUser && currentUser !== uid && hasActiveSession) {
      throw new Error("Machine is currently in use");
    }

    const now = new Date();
    const datePart = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, "0") +
      now.getDate().toString().padStart(2, "0");
    const timePart = now.getHours().toString().padStart(2, "0") +
      now.getMinutes().toString().padStart(2, "0") +
      now.getSeconds().toString().padStart(2, "0");
    const randPart = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(2)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const sessionId = `${datePart}-${timePart}-${randPart}`;

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
    trigger_source: "",
    updatedAt: serverTimestamp(),
  });
}

export async function triggerCapture(source: "web" | "button" = "web"): Promise<void> {
  await updateDoc(machineRef, {
    trigger_source: source,
    updatedAt: serverTimestamp(),
  });
}

export async function clearTrigger(): Promise<void> {
  await updateDoc(machineRef, { trigger_source: "", updatedAt: serverTimestamp() });
}

export async function restartSlave(): Promise<void> {
  await updateDoc(machineRef, {
    slave_restart: true,
    updatedAt: serverTimestamp(),
  });
}

export async function forceSetStatus(status: MachineStatus): Promise<void> {
  await updateDoc(machineRef, { status, updatedAt: serverTimestamp() });
}

export async function updateBinFull(binFull: BinFull): Promise<void> {
  await updateDoc(machineRef, {
    "bin_full.SMALL":  binFull.SMALL,
    "bin_full.MEDIUM": binFull.MEDIUM,
    "bin_full.LARGE":  binFull.LARGE,
    updatedAt: serverTimestamp(),
  });
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

export function subscribeToSortingLogs(
  callback: (logs: SortingLog[]) => void,
  onError?: (error: Error) => void,
  userId?: string,
): Unsubscribe {
  const constraints = userId
    ? [where("user_id", "==", userId), orderBy("sorted_at", "desc"), limit(10)]
    : [orderBy("sorted_at", "desc"), limit(10)];
  const q = query(collection(db, "logs"), ...constraints);
  return onSnapshot(
    q,
    (snapshot) => {
      callback(
        snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            machine_id: data.machine_id ?? "",
            bottle_type: data.bottle_type ?? "unknown",
            user_id: data.user_id ?? "",
            session_id: data.session_id ?? "",
            sorted_at: data.sorted_at as Timestamp | undefined,
          };
        }),
      );
    },
    (error) => {
      if (onError) onError(error);
    },
  );
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

      const sc = data.slotCounts as Partial<SlotCounts> | undefined;
      const bf = data.bin_full as Partial<BinFull> | undefined;
      callback({
        status: data.status,
        current_user: data.current_user ?? "",
        session_score: data.session_score ?? 0,
        session_id: data.session_id ?? "",
        trigger_source: data.trigger_source ?? "",
        slotCounts: {
          SMALL:  sc?.SMALL  ?? 0,
          MEDIUM: sc?.MEDIUM ?? 0,
          LARGE:  sc?.LARGE  ?? 0,
        },
        bin_full: {
          SMALL:  bf?.SMALL  ?? false,
          MEDIUM: bf?.MEDIUM ?? false,
          LARGE:  bf?.LARGE  ?? false,
        },
      });
    },
    (error) => {
      if (onError) {
        onError(error);
      }
    },
  );
}
