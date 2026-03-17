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
  setDoc,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

function generateRedeemCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  let code = "GLP-";
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export async function redeemReward(
  uid: string,
  reward: { id: string; name: string; cost: number },
): Promise<string> {
  const userRef = doc(db, "users", uid);
  let committedCode = "";

  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const data = userSnap.data() as { total_score?: number } | undefined;
    const currentScore = data?.total_score ?? 0;

    if (currentScore < reward.cost) {
      throw new Error("คะแนนไม่เพียงพอ");
    }

    // Generate inside the transaction so each retry gets fresh values
    const redemptionRef = doc(collection(db, "users", uid, "redemptions"));
    const code = generateRedeemCode();
    committedCode = code;

    tx.update(userRef, {
      total_score: increment(-reward.cost),
      updated_at: serverTimestamp(),
    });

    tx.set(redemptionRef, {
      reward_id: reward.id,
      reward_name: reward.name,
      cost: reward.cost,
      code,
      redeemed_at: serverTimestamp(),
    });
  });

  return committedCode;
}

export interface UserProfile {
  total_score: number;
  session_count: number;
  nickname?: string;
  avatar_url?: string;
  avatar_preset?: string;
}

export async function uploadAvatar(uid: string, file: File): Promise<string> {
  // Fixed path (no extension) so re-uploading always overwrites the same file
  const avatarRef = ref(storage, `avatars/${uid}`);
  await uploadBytes(avatarRef, file, { contentType: file.type });
  return getDownloadURL(avatarRef);
}

export async function updateUserProfile(
  uid: string,
  data: { nickname?: string; avatar_url?: string; avatar_preset?: string },
): Promise<void> {
  const userRef = doc(db, "users", uid);
  await setDoc(userRef, { ...data, updated_at: serverTimestamp() }, { merge: true });
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
        nickname: data?.nickname,
        avatar_url: data?.avatar_url,
        avatar_preset: data?.avatar_preset,
      });
    },
    (error) => {
      if (onError) {
        onError(error);
      }
    },
  );
}

export interface UserRedemptionHistory {
  id: string;
  reward_name: string;
  cost: number;
  code: string;
  redeemed_at?: Timestamp;
}

export function subscribeToUserRedemptions(
  uid: string,
  callback: (redemptions: UserRedemptionHistory[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const ref = collection(db, "users", uid, "redemptions");
  const q = query(ref, orderBy("redeemed_at", "desc"), limit(10));
  return onSnapshot(
    q,
    (snapshot) => {
      callback(
        snapshot.docs.map((d) => {
          const data = d.data() as Omit<UserRedemptionHistory, "id">;
          return { id: d.id, reward_name: data.reward_name ?? "", cost: data.cost ?? 0, code: data.code ?? "", redeemed_at: data.redeemed_at };
        }),
      );
    },
    (error) => { if (onError) onError(error); },
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
