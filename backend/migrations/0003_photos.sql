CREATE TABLE "photos" (
    "id" bigserial PRIMARY KEY,
    "taken_at" timestamptz NOT NULL DEFAULT now(),
    "width" int NOT NULL,
    "height" int NOT NULL,
    "content_type" text NOT NULL DEFAULT 'image/jpeg',
    "bytes" bytea NOT NULL
);

CREATE INDEX "photos_taken_at_idx" ON "photos" ("taken_at" DESC, "id" DESC);
