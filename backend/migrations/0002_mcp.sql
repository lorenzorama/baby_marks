CREATE TABLE "mcp_clients" (
    "client_id" text PRIMARY KEY NOT NULL,
    "redirect_uris" jsonb NOT NULL,
    "client_name" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "mcp_refresh_tokens" (
    "token_hash" text PRIMARY KEY NOT NULL,
    "client_id" text NOT NULL REFERENCES "mcp_clients"("client_id") ON DELETE CASCADE,
    "expires_at" timestamptz NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);
