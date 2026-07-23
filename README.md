# Baby Marks 🍼

Mobile-first tracker for a baby's feedings, sleep, diapers, pumping, medicine and growth.
Built for two parents sharing one database — timers live in the backend and sync across phones.

## Architecture

- **frontend** — Next.js 16 app (App Router, next-intl fr/en, Tailwind). Serves the UI and
  proxies `/api/*` to the backend via `next.config.ts` rewrites (baked in at build time — see
  `BACKEND_URL` below), so the browser only ever talks to one origin.
- **backend** — FastAPI + uv, talking to Postgres over `asyncpg`. Owns auth, timers, and all
  `/api/*` routes, including an unauthenticated `/api/health` probe.
- **db** — PostgreSQL 17.

Only the frontend is exposed publicly; the backend is reached exclusively through the frontend's
rewrite, so there's no CORS middleware by design — everything is same-origin from the browser's
point of view.

## Local dev (Docker)

```bash
cp .env.example .env
# edit APP_SECRET_PHRASE if you like

docker compose up --build
# → app on http://localhost:3000
# → api on http://localhost:8000
```

Log in with `APP_SECRET_PHRASE`, create a baby in Settings, then start a timer — it survives page refresh because it is stored in Postgres.

## Local dev (without Docker)

Backend (needs a running Postgres — e.g. `docker compose up -d db`):

```bash
cd backend
pip install uv
uv sync
DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks uv run uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
APP_SECRET_PHRASE=change-me npm run dev
```

`APP_SECRET_PHRASE` must be set for the frontend too (matching the backend's), either inline as
above or via `frontend/.env.local` — without it every page redirects to `/login`.

## Environment variables

| Variable | Where | Default | Notes |
|---|---|---|---|
| `APP_SECRET_PHRASE` | frontend + backend | — | Shared login secret for both parents. Must match on both services. |
| `DATABASE_URL` | backend | — | e.g. `postgresql://baby:baby@localhost:5432/baby_marks`. Required, no default. |
| `COOKIE_SECURE` | backend | `false` | Set `true` when serving over HTTPS (e.g. behind Traefik on the VPS). If `true` on plain HTTP, the browser silently drops the auth cookie. |
| `BACKEND_URL` | frontend | `http://backend:8000` | **Build-time** arg (`ARG BACKEND_URL` in `frontend/Dockerfile`) — Next.js serializes the API rewrite into the build, so changing it requires rebuilding the frontend image, not just restarting the container. |

## Tests

```bash
cd frontend && npm run test   # vitest
cd frontend && npx tsc --noEmit

cd backend && python3 -m pytest   # or: uv run pytest
```

Backend tests run without Postgres by default (DB-dependent tests are skipped). Set
`BM_TEST_DATABASE_URL` to a live Postgres URL to also run the API integration suite
(`tests/test_api.py`):

```bash
BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks python3 -m pytest
```

## Deploy on Hostinger VPS

You need a **Hostinger KVM VPS** (KVM 2 or higher recommended — Next.js builds need RAM). Shared web hosting will not run this stack.

### 1. Server setup

1. Create a KVM VPS in hPanel (Ubuntu 24.04).
2. Open **Docker Manager** → deploy the **Traefik** template project first. This creates the `traefik-proxy` network and handles HTTPS (Let's Encrypt).
3. Point a DNS **A record** at your VPS IP, e.g. `baby.yourdomain.com`.

### 2. Deploy the app

SSH into the VPS, clone the repo, and create `.env`:

```bash
git clone <your-repo-url> baby_marks
cd baby_marks
cp .env.example .env
```

Edit `.env`:

```env
DOMAIN=baby.yourdomain.com
POSTGRES_PASSWORD=<long-random-password>
APP_SECRET_PHRASE=<shared-login-secret>
```

Build and start:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Open `https://baby.yourdomain.com`, log in with `APP_SECRET_PHRASE`, and use **Add to Home Screen** on both phones.

### 3. Updates

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Data persists in the `pgdata` Docker volume.

### Notes

- Only the **frontend** is exposed via Traefik. The API is proxied internally (`/api/*` → backend container).
- Set a strong `APP_SECRET_PHRASE` — it is the only login for both parents.
- `docker-compose.prod.yml` sets `COOKIE_SECURE=true` on the backend since Traefik terminates HTTPS — don't flip this on for the plain-HTTP local `docker-compose.yml`.
- Back up the Postgres volume periodically (`docker volume inspect baby_marks_pgdata`).
