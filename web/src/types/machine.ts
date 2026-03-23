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

export interface MachineState {
  status: MachineStatus;
  current_user: string;
  session_score: number;
  session_id?: string;
  slotCounts?: SlotCounts;
  // Explicit capture trigger — "" means no trigger pending.
  // Sources: "web" (manual), "button" (next phase), "sensor" (future).
  trigger_source?: string;
}

export const MACHINE_ID = "Gloop_01";
