# GitHub Actions Deploy Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push to `main` → full test suite (incl. DB-gated integration tests) → SSH deploy to the Hostinger VPS with pre-deploy backup and post-deploy health check.

**Architecture:** One workflow file with two jobs: `test` (frontend vitest+tsc, backend pytest against a Postgres 17 service container) and `deploy` (`needs: test`, main-only) which streams a repo-tracked remote script over plain `ssh` (no third-party SSH action — zero supply-chain surface) and then health-checks the live domain from the runner.

**Tech Stack:** GitHub Actions (`actions/checkout@v4`, `actions/setup-node@v4`, `astral-sh/setup-uv@v5`, `services: postgres:17-alpine`), OpenSSH, curl.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-deploy-workflow-design.md`.
- Repo path on this Mac contains a space — always quote `"/Users/lorenzo/Desktop/Projects /baby_marks"`.
- Backend tests: `cd backend && uv run pytest` (NEVER bare `python3 -m pytest` — global 3.11 lacks deps). With `BM_TEST_DATABASE_URL` set: expect **79 passed** (zero DB-suite skips). Frontend: `cd frontend && npm run test` (9 tests) and `npx tsc --noEmit`.
- Test DB URL convention (from `backend/tests/test_api.py` docstring): `postgresql://baby:baby@localhost:5432/baby_marks`. Tests run migrations and wipe tables themselves — CI only provides an empty Postgres.
- The remote script must NEVER contain `docker compose down` (with or without `-v`) — `down -v` would destroy the production data volume.
- No app secrets in the repo or the workflow: only the three GitHub secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` are referenced.
- Health-check domain hardcoded: `https://baby.canastrat.com`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Workflow + remote deploy script

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `deploy/remote-deploy.sh`

**Interfaces:**
- Consumes: existing test suites; GitHub secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (configured later by the user — their absence must not break the `test` job).
- Produces: workflow named `Deploy`; remote script executed on the VPS via `ssh ... 'bash -s' < deploy/remote-deploy.sh` (the runner streams its own checked-out copy, so the script version deployed is the one from the triggering commit).

- [ ] **Step 1: Write `deploy/remote-deploy.sh`**

```bash
#!/usr/bin/env bash
# Executed ON THE VPS by the GitHub Actions deploy job (streamed over ssh).
# NEVER add `docker compose down` here: `down -v` would destroy the pgdata volume.
set -euo pipefail

cd ~/baby-marks/baby_marks

mkdir -p ~/backups
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U baby baby_marks > ~/backups/pre-deploy-"$(date +%F-%H%M%S)".sql
find ~/backups -name 'pre-deploy-*.sql' -mtime +30 -delete

git pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build

docker compose -f docker-compose.prod.yml ps
```

Make it executable: `chmod +x deploy/remote-deploy.sh`.

- [ ] **Step 2: Write `.github/workflows/deploy.yml`**

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: baby
          POSTGRES_PASSWORD: baby
          POSTGRES_DB: baby_marks
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U baby -d baby_marks"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4

      # ---- Frontend ----
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Frontend deps
        working-directory: frontend
        run: npm ci
      - name: Frontend tests
        working-directory: frontend
        run: npm run test
      - name: Frontend typecheck
        working-directory: frontend
        run: npx tsc --noEmit

      # ---- Backend (incl. DB integration tests) ----
      - uses: astral-sh/setup-uv@v5
      - name: Backend deps
        working-directory: backend
        run: uv sync
      - name: Backend tests
        working-directory: backend
        env:
          BM_TEST_DATABASE_URL: postgresql://baby:baby@localhost:5432/baby_marks
        run: uv run pytest -ra

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy over SSH
        env:
          VPS_HOST: ${{ secrets.VPS_HOST }}
          VPS_USER: ${{ secrets.VPS_USER }}
          VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "$VPS_SSH_KEY" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -H "$VPS_HOST" >> ~/.ssh/known_hosts 2>/dev/null
          ssh -i ~/.ssh/deploy_key "$VPS_USER@$VPS_HOST" 'bash -s' < deploy/remote-deploy.sh

      - name: Health check
        run: |
          for i in $(seq 1 18); do
            if curl -fsS --max-time 5 https://baby.canastrat.com/api/health > /dev/null \
               && curl -fsS --max-time 5 https://baby.canastrat.com/.well-known/oauth-authorization-server > /dev/null; then
              echo "Healthy."
              exit 0
            fi
            echo "Not healthy yet (attempt $i/18), retrying in 5s..."
            sleep 5
          done
          echo "Health check FAILED after 90s — check VPS logs; pre-deploy backup is in ~/backups on the VPS."
          exit 1
```

- [ ] **Step 3: Validate**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
# YAML parses:
cd backend && uv run python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('../.github/workflows/deploy.yml').read_text()); print('YAML OK')" && cd ..
# (if pyyaml is not in the backend env, use: uv run --with pyyaml python -c "...")
# actionlint if available (do not install if missing — skip):
command -v actionlint >/dev/null && actionlint || echo "actionlint not installed, skipped"
# Shell script syntax:
bash -n deploy/remote-deploy.sh && echo "sh OK"
grep -q "docker compose down" deploy/remote-deploy.sh && echo "FORBIDDEN COMMAND PRESENT" || echo "no down: OK"
```

Expected: `YAML OK`, `sh OK`, `no down: OK` (and actionlint clean if present).

- [ ] **Step 4: Prove the CI test commands locally** (same commands the workflow runs)

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npm run test && npx tsc --noEmit
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks uv run pytest -ra
```

Expected: 9 vitest passed; tsc silent; pytest **79 passed** with the dev docker Postgres up (`docker compose up -d db` first if needed; if the local dev DB uses a different password, use the value from `docker-compose.yml`). If the DB cannot run locally, run `uv run pytest` without the env var (52 passed + 27 skipped) and note it.

- [ ] **Step 5: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add .github/workflows/deploy.yml deploy/remote-deploy.sh
git commit -m "feat(ci): deploy workflow — test gate (incl. DB integration) + SSH deploy + health check

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: README — automatic deploy routine + one-time setup

**Files:**
- Modify: `README.md` (the `## Deploy on Hostinger VPS` area — add a new subsection after the existing deploy content; do not delete the manual instructions, reframe them as fallback)

**Interfaces:**
- Consumes: workflow + script from Task 1 (names/paths must match exactly: `.github/workflows/deploy.yml`, `deploy/remote-deploy.sh`, secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`).
- Produces: user-facing runbook.

- [ ] **Step 1: Add the CI/CD subsection to README.md**

Insert a subsection (placement: inside `## Deploy on Hostinger VPS`, after the existing manual-deploy steps) with exactly this content:

```markdown
### Continuous deployment (GitHub Actions)

Every push to `main` runs the full test suite (frontend vitest + typecheck, backend pytest
including the DB integration tests against a throwaway Postgres 17) and, if green, deploys to
the VPS over SSH: pre-deploy `pg_dump` backup (kept 30 days in `~/backups`), `git pull`,
`docker compose up -d --build`, then a health check on `https://baby.canastrat.com`.
Re-deploy manually anytime from GitHub → Actions → Deploy → **Run workflow**.

One-time setup (already done for this repo — repeat only if rotating the deploy key):

1. Generate a dedicated key (on your machine, no passphrase):
   `ssh-keygen -t ed25519 -f deploy_key -C github-actions -N ""`
2. Authorize it on the VPS:
   `ssh-copy-id -f -i deploy_key.pub root@<VPS_IP>`
   (or append `deploy_key.pub` to `~/.ssh/authorized_keys` on the VPS)
3. In GitHub → Settings → Secrets and variables → Actions, create:
   - `VPS_HOST` = the VPS IP
   - `VPS_USER` = `root`
   - `VPS_SSH_KEY` = the full contents of the private `deploy_key` file
4. Delete the local `deploy_key` / `deploy_key.pub` files.

Manual fallback (if Actions is down or for a hotfix):

    ssh root@<VPS_IP>
    cd ~/baby-marks/baby_marks
    git pull && docker compose -f docker-compose.prod.yml up -d --build

Never run `docker compose down -v` on the VPS — it destroys the database volume.
```

Adjust the surrounding prose minimally so the old manual steps read as the fallback/first-install path, not the routine.

- [ ] **Step 2: Verify**

Read the modified README section top to bottom: paths and secret names match Task 1 exactly; no contradiction with the pre-existing install instructions.

- [ ] **Step 3: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add README.md
git commit -m "docs: continuous deployment routine + deploy-key setup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Post-plan (session controller, not a subagent)

1. Guide the user through the one-time key setup (README steps) BEFORE pushing to main, so the first run goes green end-to-end.
2. Push to `origin main`, watch the run (`gh run watch` if `gh` is authenticated, else the Actions tab), confirm: test job green with **0 skips** in the pytest `-ra` summary, deploy green, VPS on the new commit — this also finally ships the sleep-stats fix (4fbb385) to production.
