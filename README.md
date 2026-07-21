# Baby Marks 🍼

Mobile-first tracker for a baby's feedings, sleep, diapers, pumping, medicine and growth.
Built for two parents sharing one database — timers live in the backend and sync across phones.

## Stack

Next.js (frontend) · FastAPI + uv (backend) · PostgreSQL · Docker · next-intl (fr/en) · Tailwind

## Local dev (Docker)

```bash
cp .env.example .env
# edit APP_SECRET_PHRASE if you like

docker compose up --build
# → http://localhost:3000
```

Log in with `APP_SECRET_PHRASE`, create a baby in Settings, then start a timer — it survives page refresh because it is stored in Postgres.

Backend tests (unit, no Postgres needed):

```bash
cd backend && uv run pytest
```

Frontend tests:

```bash
cd frontend && npm test
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
- Back up the Postgres volume periodically (`docker volume inspect baby_marks_pgdata`).
