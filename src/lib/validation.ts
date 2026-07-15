import { z } from "zod";
import type { EventType } from "./types";

export const TIMER_TYPES: EventType[] = ["feed", "sleep", "pump"];
export const POINT_TYPES: EventType[] = ["diaper", "medicine"];

export const eventTypeSchema = z.enum(["feed", "sleep", "diaper", "pump", "medicine"]);
export const caregiverSchema = z.enum(["maman", "papa"]);

const feedDetails = z.object({
  method: z.enum(["breast", "bottle", "solids"]),
  side: z.enum(["left", "right"]).optional(),
  amountMl: z.number().int().positive().max(2000).optional(),
  food: z.string().max(200).optional(),
});
const sleepDetails = z.object({});
const diaperDetails = z.object({ kind: z.enum(["wet", "dirty", "both"]) });
const pumpDetails = z.object({
  leftMl: z.number().int().min(0).max(2000).optional(),
  rightMl: z.number().int().min(0).max(2000).optional(),
});
const medicineDetails = z.object({
  name: z.string().min(1).max(200),
  dose: z.string().max(100).optional(),
});

export const detailsByType: Record<EventType, z.ZodTypeAny> = {
  feed: feedDetails,
  sleep: sleepDetails,
  diaper: diaperDetails,
  pump: pumpDetails,
  medicine: medicineDetails,
};

export const createEventSchema = z
  .object({
    type: eventTypeSchema,
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().nullable().default(null),
    details: z.record(z.string(), z.unknown()).default({}),
    note: z.string().max(1000).nullable().optional(),
    caregiver: caregiverSchema,
  })
  .superRefine((val, ctx) => {
    const r = detailsByType[val.type].safeParse(val.details ?? {});
    if (!r.success) {
      ctx.addIssue({ code: "custom", path: ["details"], message: `invalid details for ${val.type}` });
    }
    if (val.endedAt && val.endedAt.getTime() < val.startedAt.getTime()) {
      ctx.addIssue({ code: "custom", path: ["endedAt"], message: "endedAt before startedAt" });
    }
    if (POINT_TYPES.includes(val.type) && val.endedAt === null) {
      ctx.addIssue({ code: "custom", path: ["endedAt"], message: `${val.type} requires endedAt` });
    }
  });

export const patchEventSchema = z.object({
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().nullable().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  note: z.string().max(1000).nullable().optional(),
  caregiver: caregiverSchema.optional(),
});

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const babySchema = z.object({
  name: z.string().min(1).max(100),
  birthDate: dateString,
});

export const measurementSchema = z
  .object({
    measuredAt: dateString,
    weightG: z.number().int().positive().max(50000).optional(),
    heightMm: z.number().int().positive().max(2000).optional(),
    headCircMm: z.number().int().positive().max(1000).optional(),
    note: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => v.weightG != null || v.heightMm != null || v.headCircMm != null, {
    message: "at least one measurement value required",
  });
