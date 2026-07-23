# Baby Marks MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only MCP server (Streamable HTTP + single-user OAuth 2.1) inside the FastAPI backend so claude.ai can query Theana's tracking data.

**Architecture:** FastMCP 2.x app mounted into the existing FastAPI backend at `/mcp`; five read-only tools backed by the existing asyncpg pool; a minimal OAuth 2.1 authorization server (DCR + secret-gated authorize page + PKCE + HS256 tokens) persisted in Postgres; Traefik exposes only `/mcp*` + OAuth/well-known paths.

**Tech Stack:** Python 3.12, FastAPI, FastMCP 2.x (`fastmcp`), asyncpg, zoneinfo, pytest + httpx. No JS changes.

**Spec:** `docs/superpowers/specs/2026-07-23-mcp-server-design.md` (authoritative for tool shapes and the OAuth contract).

## Global Constraints

- Repo root `"/Users/lorenzo/Desktop/Projects /baby_marks"` (space in path — always quote). Backend work happens in `backend/`; deps managed with **uv** (`uv add`, `uv sync`, `uv run pytest`). If `uv` is unavailable, `pip install -e .` + `python3 -m pytest` from `backend/` is the fallback — say which you used.
- **Verify FastMCP APIs against the installed version** (Task 1 produces `backend/app/mcp/NOTES.md`; later tasks follow it, never memory). WebFetch `https://gofastmcp.com/llms.txt` → relevant pages, or read the installed package source.
- Existing suites stay green: `cd backend && python3 -m pytest` (currently 15 passed + DB-gated skips), `cd frontend && npm run test` (9). DB-gated tests use `BM_TEST_DATABASE_URL` (Postgres via `docker compose up -d db`).
- New env vars exactly: `MCP_ACCESS_SECRET`, `MCP_JWT_SECRET`, `MCP_PUBLIC_URL`, `MCP_DEFAULT_TIMEZONE` (default `Europe/Paris`).
- Tool output shapes and OAuth flow are the spec's — do not rename fields.
- Never expose `/api/*` in Traefik; only `/mcp*`, `/.well-known/oauth-*`, and the OAuth endpoint paths.
- Commit after every task; messages given per task.

---

### Task 1: FastMCP dependency + verified spike + NOTES.md

**Files:**
- Modify: `backend/pyproject.toml` (add `fastmcp`)
- Create: `backend/app/mcp/__init__.py` (empty), `backend/app/mcp/NOTES.md`, `backend/tests/test_mcp_spike.py`

**Interfaces:**
- Produces `backend/app/mcp/NOTES.md` — the API ground truth later tasks follow. Must document, each with a working snippet verified by the spike test: (1) defining a tool (`@mcp.tool` or current equivalent) incl. param descriptions; (2) getting the ASGI app for Streamable HTTP (`mcp.http_app()` or equivalent) and its **mount path behavior** (what URL the client connects to when mounted at `/mcp` in FastAPI); (3) **combining lifespans** with an existing FastAPI lifespan (FastMCP's http_app has its own lifespan that must run); (4) what auth interfaces this version exposes (built-in OAuth/AS provider classes, `TokenVerifier`/`JWTVerifier`-style resource-server hooks, or none) with class/function names and import paths — this decides Task 4's mechanism; (5) how to call the server from a Python client (`fastmcp.Client` against an ASGI transport or local URL) for tests; (6) installed version pin.

- [ ] **Step 1:** `cd backend && uv add fastmcp` (record the resolved version). If FastMCP's Starlette/FastAPI pins conflict with the existing FastAPI version, stop and report BLOCKED with the conflict.
- [ ] **Step 2:** Research: WebFetch the FastMCP docs (start at `https://gofastmcp.com/llms.txt`, follow to server/http/auth pages) AND read the installed package (`uv run python -c "import fastmcp, inspect, pathlib; print(pathlib.Path(fastmcp.__file__).parent)"`) for the items in Interfaces. Prefer package source over docs when they disagree.
- [ ] **Step 3: Spike test `backend/tests/test_mcp_spike.py`** (adapt API names to what you verified; keep the assertions):

```python
import pytest
from fastmcp import FastMCP, Client

@pytest.fixture
def spike_server():
    mcp = FastMCP("spike")

    @mcp.tool
    def ping(name: str) -> dict:
        """Return a greeting."""
        return {"hello": name}

    return mcp

@pytest.mark.asyncio
async def test_spike_tool_roundtrip(spike_server):
    async with Client(spike_server) as client:
        tools = await client.list_tools()
        assert [t.name for t in tools] == ["ping"]
        result = await client.call_tool("ping", {"name": "Theana"})
        assert result.data == {"hello": "Theana"}  # if `.data` is not this version's accessor, use the verified one
```

The `result.data` accessor is the FastMCP 2.x documented shape; if the installed version exposes results differently (`structured_content`, content-block parsing), switch to the verified accessor and record it in NOTES.md — the assertion must still compare against `{"hello": "Theana"}`. Add a second test that builds the HTTP ASGI app, mounts it in a scratch FastAPI app with combined lifespan, and does the same round-trip through the mounted path — this is what proves items (2)+(3).
- [ ] **Step 4:** Run `cd backend && uv run pytest tests/test_mcp_spike.py -v` → all pass. Also full `python3 -m pytest` → prior suites unaffected. (If pytest-asyncio config is needed, add it consistently with the existing test setup.)
- [ ] **Step 5:** Write `backend/app/mcp/NOTES.md` covering Interfaces (1)-(6) with the verified snippets.
- [ ] **Step 6:** Commit — `feat(mcp): add fastmcp dependency, verified spike and API notes`

---

### Task 2: Summaries module (pure aggregation + fetchers) — TDD

**Files:**
- Create: `backend/app/mcp/summaries.py`, `backend/tests/test_mcp_summaries.py`

**Interfaces (later tasks call these exact names):**
- `day_bounds(date_str: str, tz_name: str) -> tuple[datetime, datetime]` — UTC instants of local midnight → next local midnight (zoneinfo; DST-correct; ValueError on bad date/tz).
- `summarize_day(events: list[dict], measurements: list[dict], date_str: str, tz_name: str, now: datetime, baby_name: str | None) -> dict` — exactly the spec's `get_daily_summary` shape.
- `sleep_stats(events: list[dict], start_date: str, end_date: str, tz_name: str, now: datetime) -> dict` — `{days: [{date, total_minutes, block_count, longest_block_minutes}], averages: {total_minutes, longest_block_minutes}}`.
- `list_feedings(events, date_str, tz_name) -> list[dict]`, `list_diapers(events, date_str, tz_name) -> list[dict]` — spec shapes, chronological.
- Async fetchers (thin, asyncpg): `fetch_events_between(pool, start_utc, end_utc) -> list[dict]` (also returns rows with `ended_at IS NULL` regardless of start), `fetch_measurements_on(pool, date_str) -> list[dict]`, `fetch_all_measurements(pool, limit) -> list[dict]`, `fetch_baby_name(pool) -> str | None`.
- Event dicts use the DB row fields: `type, started_at (aware datetime), ended_at (aware|None), details (dict)`.
- Time formatting helper `fmt(dt, tz) -> {"iso": ..., "local": "HH:MM"}` used for every timestamp in outputs.

Rules the tests pin down: sleep blocks are clipped to the local day (a block may span midnight — count only the overlap); running sleep (`ended_at None`) counts up to `now` (clipped); breast feed minutes from started/ended; empty day returns zeroed structure; invalid date/tz raises ValueError with a readable message; `sleep_stats` range max 90 days (ValueError beyond).

- [ ] **Step 1: Write failing tests** — `backend/tests/test_mcp_summaries.py` with AT LEAST these cases (UTC helper `d(s) = datetime.fromisoformat(s).replace(tzinfo=timezone.utc)`):

```python
NOW = d("2026-07-23T12:00:00")

def ev(type, start, end=None, **details):
    return {"type": type, "started_at": d(start), "ended_at": d(end) if end else None, "details": details}

# 1. midnight-spanning sleep, tz=UTC: 23:00→01:30 → Jul22 gets one 60-min block, Jul23 gets one 90-min block
# 2. Europe/Paris bucketing: event at 21:30Z Jul 22 (= 23:30 local) belongs to local day 2026-07-22
# 3. DST spring-forward day (Europe/Paris 2026-03-29): day_bounds spans 23 hours exactly
# 4. running sleep started 10:00Z with NOW=12:00Z → 120-min block, longest_block_minutes == 120
# 5. empty day → sleep.total_minutes == 0, blocks == [], feeds.count == 0, diapers.total == 0, medicines == [], pump_ml == 0
# 6. full summary: breast feed 08:00→08:20 (side left) + bottle 90ml + diaper both + medicine "Vit D" + pump left 60 right 40
#    → feeds.count 2, breast_minutes 20, bottle_ml 90, diapers.both 1, medicines[0].name "Vit D", pump_ml 100
# 7. measurements passthrough: weight 4200g on the date appears in summary.measurements
# 8. invalid date "2026-13-01" and tz "Mars/Olympus" → ValueError
# 9. sleep_stats over 3 days returns 3 day entries oldest-first + correct averages; >90-day range → ValueError
# 10. list_feedings chronological with minutes for completed breast feeds; list_diapers {time, kind}
```

Write each as a real test with concrete numbers (shapes per the spec).
- [ ] **Step 2:** `uv run pytest tests/test_mcp_summaries.py -v` → FAIL (module missing).
- [ ] **Step 3:** Implement `summaries.py`. Core clipping loop (reference — adapt names):

```python
def clip_to_day(start, end, day_start, day_end):
    s, e = max(start, day_start), min(end, day_end)
    return (s, e) if s < e else None
```

Iterate sleep events; for each, `end = ended_at or now`; clip; build blocks `{start: fmt(s), end: fmt(e) (or None if running & clipped end == now), minutes: round(...)}`. Fetchers: parameterized SQL only (`$1` placeholders), `WHERE (started_at < $2 AND (ended_at IS NULL OR ended_at > $1))` for the between-fetch so midnight-spanning and running rows are included.
- [ ] **Step 4:** `uv run pytest tests/test_mcp_summaries.py -v` → PASS; full suite green.
- [ ] **Step 5:** Commit — `feat(mcp): journal summaries aggregation with DST-correct day bounds`

---

### Task 3: OAuth storage + token core — migration, JWT, DCR persistence — TDD

**Files:**
- Create: `backend/migrations/0002_mcp.sql`, `backend/app/mcp/tokens.py`, `backend/tests/test_mcp_tokens.py`
- Modify: `backend/app/config.py` (new env accessors: `mcp_access_secret()`, `mcp_jwt_secret()`, `mcp_public_url()`, `mcp_default_timezone()` — same style as existing accessors)

**Interfaces:**
- Migration creates: `mcp_clients(client_id text PK, redirect_uris jsonb NOT NULL, client_name text, created_at timestamptz NOT NULL DEFAULT now())` and `mcp_refresh_tokens(token_hash text PK, client_id text NOT NULL REFERENCES mcp_clients(client_id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`.
- `tokens.py` (pure, no DB): `mint_access_token(secret: str, ttl_seconds: int = 3600) -> str` (compact JWS, header exactly `{"alg":"HS256","typ":"JWT"}`, claims `{sub:"mcp", scope:"mcp", iat, exp, jti}`); `verify_access_token(token: str, secret: str) -> dict` (returns claims; raises `TokenError` on bad format / wrong alg header / bad signature / expired); `new_refresh_token() -> str` (43+ chars urlsafe) and `hash_refresh_token(token: str) -> str` (sha256 hex). Implement JWS by hand with `hmac` + `base64.urlsafe_b64encode` (no new deps); `verify` must reject any header that isn't byte-equal to the minted one (kills alg-confusion).

- [ ] **Step 1: Failing tests** `backend/tests/test_mcp_tokens.py`:

```python
from app.mcp.tokens import mint_access_token, verify_access_token, new_refresh_token, hash_refresh_token, TokenError
import pytest, time

SECRET = "test-jwt-secret"

def test_mint_and_verify_roundtrip():
    claims = verify_access_token(mint_access_token(SECRET), SECRET)
    assert claims["sub"] == "mcp" and claims["scope"] == "mcp"
    assert claims["exp"] - claims["iat"] == 3600

def test_wrong_secret_rejected():
    with pytest.raises(TokenError): verify_access_token(mint_access_token(SECRET), "other")

def test_expired_rejected():
    tok = mint_access_token(SECRET, ttl_seconds=-1)
    with pytest.raises(TokenError): verify_access_token(tok, SECRET)

def test_tampered_header_rejected():
    import base64, json
    h = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    _, payload, sig = mint_access_token(SECRET).split(".")
    with pytest.raises(TokenError): verify_access_token(f"{h}.{payload}.{sig}", SECRET)

def test_garbage_rejected():
    for bad in ["", "a.b", "a.b.c.d", "not-a-token"]:
        with pytest.raises(TokenError): verify_access_token(bad, SECRET)

def test_refresh_token_entropy_and_hash():
    t1, t2 = new_refresh_token(), new_refresh_token()
    assert t1 != t2 and len(t1) >= 43
    assert hash_refresh_token(t1) != hash_refresh_token(t2) and len(hash_refresh_token(t1)) == 64
```

- [ ] **Step 2:** RED run. **Step 3:** Implement `tokens.py` + migration SQL + config accessors. **Step 4:** GREEN + full suite. Verify the migration applies: with `docker compose up -d db`, boot the backend once (`run_migrations` applies 0002) or run the runner directly; `\dt` shows the two tables.
- [ ] **Step 5:** Commit — `feat(mcp): token core (HS256 JWS, refresh hashing) and oauth storage migration`

---

### Task 4: OAuth endpoints — metadata, DCR, authorize, token — per NOTES.md

**Files:**
- Create: `backend/app/mcp/oauth.py` (endpoints + code store), `backend/tests/test_mcp_oauth.py`
- Modify: `backend/app/main.py` (include routes), `backend/app/mcp/NOTES.md` (record the mechanism chosen)

**Interfaces:**
- Mechanism decision (from Task 1 NOTES.md, in order of preference): (a) FastMCP built-in OAuth/AS provider configured for our flow; (b) custom provider implementing FastMCP's auth interfaces; (c) plain FastAPI routes below + FastMCP as bearer-verified resource server. **Whichever is chosen, the externally observable contract is fixed** and is what the tests assert:
  - `GET /.well-known/oauth-authorization-server` → JSON with `issuer` (= `MCP_PUBLIC_URL`), `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported` incl. `authorization_code` + `refresh_token`.
  - `GET /.well-known/oauth-protected-resource` → JSON with `resource` and `authorization_servers: [MCP_PUBLIC_URL]`. (Also serve both well-knowns with the `/mcp` path-suffix variants if the chosen mechanism/claude.ai probes them — FastMCP may handle this; verify.)
  - `POST <registration_endpoint>` (open DCR): body with `redirect_uris` → 201 `{client_id, redirect_uris, ...}`; **reject** any redirect_uri whose origin is not `https://claude.ai` or `https://claude.com` (400). Persist to `mcp_clients`.
  - `GET <authorization_endpoint>?client_id&redirect_uri&state&code_challenge&code_challenge_method=S256&response_type=code` → 200 HTML form (POST target same path) with hidden fields carrying the query params; unknown client_id or mismatched redirect_uri → 400.
  - `POST <authorization_endpoint>` with form `secret=...` + hidden fields: wrong secret → `await asyncio.sleep(0.5)` then re-render form with error; right secret (`hmac.compare_digest` vs `MCP_ACCESS_SECRET`) → 302 to `redirect_uri?code=...&state=...`. Codes: `secrets.token_urlsafe(32)`, stored in an in-module dict `{code: {client_id, redirect_uri, code_challenge, expires (now+600s)}}`, single-use.
  - `POST <token_endpoint>` (form): `grant_type=authorization_code` + `code` + `code_verifier` + `client_id` + `redirect_uri` → verify code exists/unexpired/single-use, client+redirect match, and `S256(code_verifier) == code_challenge` → 200 `{access_token, token_type: "bearer", expires_in: 3600, refresh_token}`; store refresh hash (30-day expiry). `grant_type=refresh_token` + `refresh_token` → rotate: verify hash exists & unexpired, delete it, issue new pair. All failures → 400 `{error: "invalid_grant"}` (or `invalid_request` for malformed).
- Produces for Task 5: the dependency/verifier used to gate `/mcp` (e.g. `verify_bearer(request) -> claims` raising 401 with `WWW-Authenticate: Bearer resource_metadata="<MCP_PUBLIC_URL>/.well-known/oauth-protected-resource"`).

- [ ] **Step 1: Failing tests** `backend/tests/test_mcp_oauth.py` — httpx `ASGITransport` against the FastAPI app, env monkeypatched (`MCP_ACCESS_SECRET=test-mcp-secret`, `MCP_JWT_SECRET=test-jwt`, `MCP_PUBLIC_URL=https://test.local`). DB-backed steps (DCR persistence, refresh) are DB-gated like `test_api.py` (skip without `BM_TEST_DATABASE_URL`); pure-shape tests (metadata endpoints) run ungated. Cases: metadata shapes; DCR happy + evil-redirect 400; authorize GET renders form / bad client 400; authorize POST wrong secret re-renders (and takes ≥0.5 s); full happy path DCR→authorize→code→token (build PKCE verifier/challenge with hashlib) → tokens verify with `verify_access_token`; PKCE mismatch → 400; code reuse → 400; refresh rotation works and old refresh dies. Write them all concretely.
- [ ] **Step 2:** RED. **Step 3:** Implement per the chosen mechanism; record the choice + why in NOTES.md. **Step 4:** GREEN + full suite. **Step 5:** Commit — `feat(mcp): single-user OAuth 2.1 endpoints (DCR, PKCE, secret-gated authorize, refresh rotation)`

---

### Task 5: Tools + mount + bearer gating + integration/e2e

**Files:**
- Create: `backend/app/mcp/server.py`, `backend/tests/test_mcp_tools.py`
- Modify: `backend/app/main.py` (mount per NOTES.md, combined lifespan)

**Interfaces:**
- `server.py` builds `mcp = FastMCP("Baby Marks")` with the five tools calling Task 2 fetchers+aggregators via the app's pool; each docstring says what it returns AND when to use it (e.g. get_daily_summary: "Use this to write or update Theana's daily journal entry — one call per day."). Tool signatures exactly: `get_daily_summary(date: str, timezone: str = DEFAULT_TZ)`, `get_sleep_stats(start_date: str, end_date: str, timezone: str = DEFAULT_TZ)`, `get_feedings(date: str, timezone: str = DEFAULT_TZ)`, `get_diapers(date: str, timezone: str = DEFAULT_TZ)`, `get_measurements(limit: int = 20)` where `DEFAULT_TZ = config.mcp_default_timezone()`. ValueError from summaries → clean MCP tool error (per NOTES.md's error idiom).
- `/mcp` requests without a valid bearer → 401 + `WWW-Authenticate` header (Task 4's verifier, wired via the mechanism NOTES.md documents — FastMCP auth hook or ASGI middleware wrapper).
- Health/auth invariants: `/api/health` still 200; `/api/*` untouched.

- [ ] **Step 1: Failing tests** `backend/tests/test_mcp_tools.py` (DB-gated suite): seed via existing helpers/SQL (baby "Theana", a midnight-spanning sleep, a breast feed, a bottle, diapers, a medicine, 2 measurements) then, using the Python MCP client from NOTES.md item (5) with a real access token from `mint_access_token`: `list_tools()` returns exactly the 5 names; `get_daily_summary` numbers match the seed; `get_measurements(limit=1)` returns 1. Plus non-gated: request to `/mcp` without token → 401 with `WWW-Authenticate`; with valid token → not 401.
- [ ] **Step 2:** RED. **Step 3:** Implement server.py + mount + gating. **Step 4:** GREEN; full backend suite; `cd frontend && npm run test` still 9 (nothing frontend changed — sanity). **Step 5:** Manual e2e: `docker compose up -d db && uv run uvicorn app.main:app --port 8000` + a scratch script that runs the FULL OAuth flow over HTTP (DCR → authorize POST with secret → token) then connects `fastmcp.Client` to `http://localhost:8000/mcp` with the bearer and calls `get_daily_summary` — paste transcript into the task report. Kill processes. **Step 6:** Commit — `feat(mcp): read-only MCP tools mounted with bearer gating`

---

### Task 6: Deployment, docs, final gates

**Files:**
- Modify: `docker-compose.prod.yml` (Traefik rules), `docker-compose.yml` (pass new env vars to backend, loopback unchanged), `backend/.env.example`, `.env.example`, `README.md`

- [ ] **Step 1:** Prod compose: add the four MCP env vars to the backend service (`MCP_ACCESS_SECRET: ${MCP_ACCESS_SECRET:?}`, `MCP_JWT_SECRET: ${MCP_JWT_SECRET:?}`, `MCP_PUBLIC_URL`, `MCP_DEFAULT_TIMEZONE: ${MCP_DEFAULT_TIMEZONE:-Europe/Paris}`) and a Traefik router on the backend matching ONLY: `PathPrefix(`/mcp`) || PathPrefix(`/.well-known/oauth-authorization-server`) || PathPrefix(`/.well-known/oauth-protected-resource`)` plus the OAuth endpoint paths from Task 4 if they live outside `/mcp` — read the existing router labels and follow their conventions (same entrypoint/certresolver). `/api` must NOT match.
- [ ] **Step 2:** Dev compose: add the same vars with dev defaults (`change-me-mcp`, etc.). Env examples updated in both files with one-line comments (incl. "rotate either secret to revoke claude.ai access").
- [ ] **Step 3:** README: new "MCP server (claude.ai connector)" section — what it is, env vars, DNS + prod compose bring-up, claude.ai steps (Settings → Connectors → Add custom connector → `https://<domain>/mcp` → authorize with MCP secret), revocation, troubleshooting (well-known 404 → Traefik rule; 401 loop → MCP_JWT_SECRET mismatch/rotation; tools missing → check backend logs).
- [ ] **Step 4:** Gates: `docker compose config` and `docker compose -f docker-compose.prod.yml config` both parse (export dummy required vars); `cd backend && python3 -m pytest` all green; `cd frontend && npm run test` 9; grep prod compose to assert no `/api` PathPrefix rule was added.
- [ ] **Step 5:** Commit — `feat(mcp): expose MCP + OAuth via Traefik, env plumbing, connector docs`
