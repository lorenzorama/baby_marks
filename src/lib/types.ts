export type EventType = "feed" | "sleep" | "diaper" | "pump" | "medicine";
export type Caregiver = "maman" | "papa";

export type ApiEvent = {
  id: number;
  babyId: number;
  type: EventType;
  startedAt: string;          // ISO
  endedAt: string | null;     // ISO or null = running
  details: Record<string, unknown>;
  note: string | null;
  caregiver: Caregiver;
};

export type Baby = { id: number; name: string; birthDate: string };

export type Measurement = {
  id: number;
  babyId: number;
  measuredAt: string;
  weightG: number | null;
  heightMm: number | null;
  headCircMm: number | null;
  note: string | null;
};

export type CreateEventInput = {
  type: EventType;
  startedAt: string;
  endedAt?: string | null;
  details?: Record<string, unknown>;
  note?: string | null;
  caregiver: Caregiver;
};
