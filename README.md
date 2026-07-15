# Baby Marks 🍼

Mobile-first tracker for a baby's feedings, sleep, diapers, pumping, medicine and growth.
Built for two parents sharing one database — timers sync between phones.

## Local dev

```bash
cp .env.example .env.local   # defaults to a local PGlite database, no Postgres needed
npm install
npm run dev                  # http://localhost:3000 — log in with APP_SECRET_PHRASE
```

Tests: `npm run test`

## Deploy (Vercel + Neon)

1. Push this repo to GitHub and import it in Vercel.
2. In Vercel: Storage → create a Postgres (Neon) database, or set `DATABASE_URL` manually.
3. Set env vars in Vercel: `DATABASE_URL` (pooled connection string) and `APP_SECRET_PHRASE`.
4. Apply the schema once from your machine:
   `DATABASE_URL="<neon-url>" npm run db:migrate`
5. Deploy. Open the URL on both phones, log in with the secret phrase, and
   "Add to Home Screen" to install it like an app.

## Stack

Next.js (App Router) · TanStack Query · Drizzle ORM · Postgres (PGlite in dev) · next-intl (fr/en) · Tailwind
