CREATE TYPE "caregiver" AS ENUM('maman', 'papa');

CREATE TYPE "event_type" AS ENUM('feed', 'sleep', 'diaper', 'pump', 'medicine');

CREATE TABLE "babies" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "birth_date" date NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "events" (
    "id" serial PRIMARY KEY NOT NULL,
    "baby_id" integer NOT NULL REFERENCES "babies"("id"),
    "type" "event_type" NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "note" text,
    "caregiver" "caregiver" NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "measurements" (
    "id" serial PRIMARY KEY NOT NULL,
    "baby_id" integer NOT NULL REFERENCES "babies"("id"),
    "measured_at" date NOT NULL,
    "weight_g" integer,
    "height_mm" integer,
    "head_circ_mm" integer,
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "events_one_running_per_type" ON "events" ("type") WHERE ended_at IS NULL;

CREATE UNIQUE INDEX "babies_singleton" ON "babies" ((true));
