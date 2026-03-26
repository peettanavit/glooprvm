export type MachineStatus =
  | "IDLE"
  | "READY"
  | "PROCESSING"
  | "REJECTED"
  | "COMPLETED";

export interface SlotCounts {
  SMALL: number;
  MEDIUM: number;
  LARGE: number;
}

export interface BinFull {
  SMALL: boolean;
  MEDIUM: boolean;
  LARGE: boolean;
}

export const BIN_CAPACITY: SlotCounts = {
  SMALL:  32,
  MEDIUM: 30,
  LARGE:  20,
};

export const BIN_WARN_THRESHOLD = 0.8; // แจ้งเตือนเมื่อใช้ >= 80%

export interface MachineState {
  status: MachineStatus;
  current_user: string;
  session_score: number;
  session_id?: string;
  slotCounts?: SlotCounts;
  bin_full?: BinFull;
  // Explicit capture trigger — "" means no trigger pending.
  // Source: "web" (user presses button on dashboard).
  trigger_source?: string;
}

export const MACHINE_ID = "Gloop_01";
