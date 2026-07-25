# Baby Marks — GitHub Actions Deploy Workflow Spec

**Date:** 2026-07-25
**Status:** Approved by user (decisions: trigger = push main + manual button; full test gate incl. DB integration tests)

## Goal

Every push to `main` runs the full test suite (including the DB-gated backend integration tests that currently never run automatically) and, if green, deploys to the Hostinger VPS over SSH with a pre-deploy DB backup and a post-deploy health check. Manual re-deploy available via `workflow_dispatch`.

## Approach

Approach (a) — SSH from Actions (chosen over pull-based watchers and registry builds): a dedicated deploy SSH key stored in GitHub secrets; the runner executes the existing deploy routine on the VPS. No new software on the VPS, deploy logs live in the Actions tab.

## Workflow: `.github/workflows/deploy.yml`

- **Triggers:** `push: branches: [main]` + `workflow_dispatch`. `concurrency: group: deploy, cancel-in-progress: false` (queued, never interleaved).
- **Job `test`** (ubuntu-latest):
  - Frontend: setup-node (LTS, npm cache on `frontend/package-lock.json`) → `npm ci` → `npm run test` → `npx tsc --noEmit` (working dir `frontend/`).
  - Backend: `services: postgres:17-alpine` (health-checked) → astral-sh/setup-uv → `uv sync` → `uv run pytest` with `BM_TEST_DATABASE_URL` pointing at the service DB. **The URL/db-name convention must match what `backend/tests/test_api.py` expects — read it, don't guess.** Expected: full suite incl. integration (79 tests at time of writing) — zero skips of the DB suite.
- **Job `deploy`** (`needs: test`, `if: github.ref == 'refs/heads/main'`):
  1. SSH step (pinned action — appleboy/ssh-action or ssh-agent+script, implementer picks current best practice and pins the version) using secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. Remote script (`set -euo pipefail`): `mkdir -p ~/backups` → `docker compose -f docker-compose.prod.yml exec -T db pg_dump -U baby baby_marks > ~/backups/pre-deploy-$(date +%F-%H%M%S).sql` → `git pull --ff-only` → `docker compose -f docker-compose.prod.yml up -d --build`, from `~/baby-marks/baby_marks`.
  2. Health check step (from the runner, after SSH): retry loop (up to ~90 s) on `curl -fsS https://baby.canastrat.com/api/health` AND `curl -fsS https://baby.canastrat.com/.well-known/oauth-authorization-server`; any final failure fails the workflow (the pre-deploy backup is the recovery net).
- **Secrets (GitHub → Settings → Secrets and variables → Actions):** `VPS_HOST` (187.55.230.95), `VPS_USER` (root), `VPS_SSH_KEY` (dedicated ed25519 private key — NOT a personal key).

## Docs

README « Deploy » section gains: the automatic routine (push → Actions), the manual fallback (3 commands), and the one-time setup: generate `ssh-keygen -t ed25519 -f deploy_key -C github-actions`, append `deploy_key.pub` to VPS `~/.ssh/authorized_keys`, create the 3 GitHub secrets, delete the local private key after pasting.

## Constraints

- No app secrets transit through GitHub — the runner only triggers the routine; `.env` stays on the VPS.
- Domain hardcoded as `baby.canastrat.com` in the health check (single-deployment project; a variable would be YAGNI).
- Health endpoints used are already public by design (`/api/health` via frontend rewrite, well-known via Traefik) — no auth needed.

## Out of scope

Registry image builds, staging environment, automated rollback (manual rollback stays documented in README), backup rotation (backups accumulate in `~/backups`; a cleanup line `find ~/backups -mtime +30 -delete` is included in the remote script to cap growth).

## Verification

- `test` job green on a real push (incl. integration tests actually running — assert no "skipped" for the DB suite in logs).
- A push to main results in the VPS running the new commit (check `git log -1` on VPS) and health checks green.
- Workflow YAML validated locally (actionlint if available, else careful review) before push.
