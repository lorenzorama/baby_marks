import {
  pgTable, pgEnum, serial, text, date, timestamp, integer, jsonb, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const eventTypeEnum = pgEnum("event_type", [
  "feed", "sleep", "diaper", "pump", "medicine",
]);
export const caregiverEnum = pgEnum("caregiver", ["maman", "papa"]);

export const babies = pgTable("babies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  birthDate: date("birth_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, () => [
  uniqueIndex("babies_singleton").on(sql`(true)`),
]);

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  babyId: integer("baby_id").notNull().references(() => babies.id),
  type: eventTypeEnum("type").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  details: jsonb("details").notNull().default({}),
  note: text("note"),
  caregiver: caregiverEnum("caregiver").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("events_one_running_per_type").on(table.type).where(sql`ended_at IS NULL`),
]);

export const measurements = pgTable("measurements", {
  id: serial("id").primaryKey(),
  babyId: integer("baby_id").notNull().references(() => babies.id),
  measuredAt: date("measured_at").notNull(),
  weightG: integer("weight_g"),
  heightMm: integer("height_mm"),
  headCircMm: integer("head_circ_mm"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
