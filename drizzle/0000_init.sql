CREATE TYPE "public"."caregiver" AS ENUM('maman', 'papa');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('feed', 'sleep', 'diaper', 'pump', 'medicine');--> statement-breakpoint
CREATE TABLE "babies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"birth_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"baby_id" integer NOT NULL,
	"type" "event_type" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"caregiver" "caregiver" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"baby_id" integer NOT NULL,
	"measured_at" date NOT NULL,
	"weight_g" integer,
	"height_mm" integer,
	"head_circ_mm" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_baby_id_babies_id_fk" FOREIGN KEY ("baby_id") REFERENCES "public"."babies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_baby_id_babies_id_fk" FOREIGN KEY ("baby_id") REFERENCES "public"."babies"("id") ON DELETE no action ON UPDATE no action;