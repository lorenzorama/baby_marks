#!/usr/bin/env bash
# Executed ON THE VPS by the GitHub Actions deploy job (streamed over ssh).
# NEVER add `docker compose down` here: `down -v` would destroy the pgdata volume.
set -euo pipefail

cd ~/baby-marks/baby_marks

mkdir -p ~/backups
# Custom format (-Fc), not plain SQL: photo rows are bytea, and a plain dump
# hex-encodes them at two characters per byte. -Fc is compressed binary, which
# keeps a dump of the 200 retained photos to a few MB instead of ~80 MB.
# Restore with: pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean <file>
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > ~/backups/pre-deploy-"$(date +%F-%H%M%S)".dump
# Keep the 10 newest dumps. Age-based pruning does not bound disk use when
# deploys are frequent, and a full volume makes `set -e` abort the deploy with
# Postgres sitting on a full disk. `find` exits 0 when nothing matches and
# `xargs -r` skips an empty list, so an empty ~/backups is not a failure.
find ~/backups -maxdepth 1 -type f -name 'pre-deploy-*.dump' -printf '%T@ %p\n' \
  | sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -f
# One-time transition: the plain-SQL dumps written before this script switched
# to -Fc are the very files that were filling the disk, and the prune above no
# longer matches them. Drop them on the first deploy after the switch; harmless
# once none are left.
find ~/backups -maxdepth 1 -type f -name 'pre-deploy-*.sql' -delete

git fetch origin
git merge --ff-only "${DEPLOY_SHA:?DEPLOY_SHA not set}"
docker compose -f docker-compose.prod.yml up -d --build

docker compose -f docker-compose.prod.yml ps
