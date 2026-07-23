# Baby Marks — MCP Server Design Spec

**Date:** 2026-07-23
**Status:** Approved by user (decisions: domain available; read-only tools; integrated OAuth; **FastMCP stack**)
**Context:** Per CLAUDE_SCRATCH task "App suivi Theana + serveur MCP" — expose Theana's tracking data to claude.ai as a custom connector so the parent journal can be fed with real numbers.

## Goals

- claude.ai (Settings → Connectors → Add custom connector) can connect to `https://<domain>/mcp` and call read-only tools over **Streamable HTTP**.
- Tool outputs are compact, journal-ready JSON with clear day semantics (DST-correct IANA timezones).
- Auth is a self-contained OAuth 2.1 flow gated by a dedicated secret, revocable independently of the parents' app logins. No credential ever reaches claude.ai except the OAuth tokens the server itself mints.

## Stack

- **FastMCP 2.x** (`fastmcp` PyPI package) as the MCP framework: `@mcp.tool` definitions, Streamable HTTP transport via `mcp.http_app()`, mounted into the existing FastAPI backend.
- Server code lives in `backend/app/mcp/` (`server.py` tools + wiring, `auth.py` OAuth, `summaries.py` query/aggregation helpers).
- Reuses the existing asyncpg pool (`app/db.py`) and daily-aggregation logic (port of `app/stats.py` internals where needed).
- **Version-verification rule:** exact FastMCP auth/mount APIs MUST be verified against the installed version's docs (gofastmcp.com / package source) at implementation time — do not code from memory. If FastMCP's built-in OAuth provider doesn't support the flow below, implement a custom provider against FastMCP's auth interfaces; if that is not feasible, fall back to hand-rolled OAuth endpoints in FastAPI with FastMCP running as a bearer-verified resource server (JWT verifier). The externally observable flow (below) is the contract; the internal mechanism may adapt.

## Architecture

```
claude.ai ──HTTPS──▶ Traefik (domain) ──▶ backend :8000
                                          ├── /mcp            FastMCP Streamable HTTP app (auth-gated)
                                          ├── /.well-known/oauth-authorization-server   ┐
                                          ├── /.well-known/oauth-protected-resource     │ OAuth mini-AS
                                          ├── /mcp/oauth/{register,authorize,token}     ┘ (paths may differ per FastMCP conventions)
                                          └── /api/*          existing app API (unchanged, still fronted by Next rewrite for the web app)
```

- The FastMCP ASGI app is mounted into the FastAPI app; **lifespans must be combined** (FastMCP's http_app lifespan + existing pool/migrations lifespan).
- The Next frontend and its `/api/*` rewrite are untouched.
- Discovery endpoints must be reachable at the URL locations claude.ai's OAuth client expects relative to the advertised MCP URL (RFC 8414 / RFC 9728). Verify with a real connection attempt.

## Tools (read-only)

All tools return JSON-serializable dicts; times in output are ISO 8601 with offset AND a human-friendly local `HH:MM`. Every tool takes `timezone: str = "Europe/Paris"` (IANA; per-date offsets computed with `zoneinfo` — DST-correct). A "day" = local midnight to midnight in that timezone. Descriptions must state **when to use the tool** (claude.ai triggering).

1. `get_daily_summary(date: str, timezone?: str)` — THE journal tool. Returns for the local day: `sleep: {total_minutes, blocks: [{start, end, minutes}], longest_block_minutes}` (blocks spanning midnight clipped to the day; running sleep counted up to now), `feeds: {count, breast_count, breast_minutes, bottle_count, bottle_ml, solids: [food]}`, `diapers: {wet, dirty, both, total}`, `medicines: [{time, name, dose}]`, `pump_ml`, `measurements: [{weight_g, height_mm, head_circ_mm}]` (that day, if any), plus `date`, `timezone`, `baby_name`.
2. `get_sleep_stats(start_date: str, end_date: str, timezone?: str)` — per-day `{date, total_minutes, block_count, longest_block_minutes}` + period averages. Range clamped to ≤ 90 days.
3. `get_feedings(date: str, timezone?: str)` — chronological list `{start, end, method, side?, amount_ml?, food?, minutes?}` for the local day.
4. `get_diapers(date: str, timezone?: str)` — chronological list `{time, kind}` for the local day.
5. `get_measurements(limit: int = 20)` — most recent measurements `{date, weight_g, height_mm, head_circ_mm, note}` (ascending output after limiting to the latest N).

Errors: invalid date/timezone → MCP tool error with a clear message (no stack traces). Empty days return zeroed structures, not errors.

## Auth (OAuth 2.1 mini-AS, single-user)

Externally observable contract (what claude.ai's connector client does):
1. Fetches protected-resource / authorization-server metadata from the well-known endpoints.
2. Registers via **Dynamic Client Registration** (open registration; server stores client_id/redirect_uri; redirect URIs restricted to `https://claude.ai/*` and `https://claude.com/*` callbacks).
3. Opens the **authorize page** in the browser: a minimal warm-styled HTML form asking for the **MCP access secret**. Correct secret (+ PKCE challenge recorded) → 302 back to claude.ai with an authorization code. Wrong secret → error + 0.5 s damper (same anti-bruteforce approach as the app login).
4. Exchanges code (+PKCE verifier) at the token endpoint → **JWT access token** (HS256, `MCP_JWT_SECRET`, 1 h expiry) + refresh token (30 d). Refresh grant supported.
5. Calls `/mcp` with `Authorization: Bearer <access token>`; invalid/missing → 401 with `WWW-Authenticate` per spec.

State: DCR clients and refresh tokens persisted in Postgres (new table(s) via migration `0002_mcp.sql` in `backend/migrations/`) so restarts don't break the connector. Authorization codes may be in-memory (short-lived) or DB — implementer's choice, documented.

New env vars (backend): `MCP_ACCESS_SECRET` (human-typed secret for the authorize page), `MCP_JWT_SECRET` (signing key), `MCP_PUBLIC_URL` (e.g. `https://baby.example.com` — used in metadata/issuer), `MCP_DEFAULT_TIMEZONE` (default `Europe/Paris`). Rotating `MCP_JWT_SECRET` or `MCP_ACCESS_SECRET` revokes access without touching `APP_SECRET_PHRASE`.

## Deployment

- `docker-compose.prod.yml`: backend gets Traefik router rules exposing ONLY `/mcp*` and the OAuth/well-known paths on the domain (the `/api/*` surface stays internal, reached via the frontend rewrite). New env vars wired with `:?` guards where secret.
- `backend/.env.example` + root `.env.example`: new vars documented.
- README: "Connect claude.ai" section — DNS → prod compose up → add custom connector → authorize with the MCP secret; plus revocation (rotate secrets) and troubleshooting (well-known 404 = Traefik rule; 401 loop = clock/secret).
- CLAUDE_SCRATCH: update the "App suivi Theana + serveur MCP" task description + comment when shipped (done by the session controller, not a subagent).

## Testing

- **Unit (no DB):** summary aggregation (midnight-spanning sleep clipped per day, running sleep, DST transition day in Europe/Paris, empty day), timezone/date validation, JWT mint/verify/expiry/bad-signature.
- **Auth flow (in-process, httpx ASGI):** metadata endpoints shape; DCR → authorize (wrong secret 4xx + damper, right secret → code) → token (PKCE mismatch rejected; happy path returns access+refresh) → refresh; `/mcp` 401 without token / with expired token.
- **DB-gated integration** (`BM_TEST_DATABASE_URL`, consistent with existing suite): seed events → `get_daily_summary` numbers match.
- **E2E local:** `fastmcp` client (or MCP Inspector) over Streamable HTTP against the dev server: initialize, list tools (5), call `get_daily_summary` — using a token minted via the real flow.
- Existing suites (frontend 9 vitest, backend pytest) stay green.

## Out of scope (v1)

`log_event` / any write tool; multi-user auth; token introspection/revocation endpoints beyond secret rotation; MCP resources/prompts (tools only); exposing `/api/*` publicly.
