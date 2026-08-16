#!/usr/bin/env bash
# Executed ON THE VPS by the GitHub Actions deploy job (copied over, then run as
# a file — never piped into `bash -s`: `docker compose exec` forwards stdin to
# the container and would swallow the rest of this script, silently skipping
# everything below the backup while still exiting 0).
# NEVER add `docker compose down` here: `down -v` would destroy the pgdata volume.
set -euo pipefail

cd ~/baby-marks/baby_marks

mkdir -p ~/backups
# Custom format (-Fc), not plain SQL: photo rows are bytea, and a plain dump
# hex-encodes them at two characters per byte. -Fc is compressed binary, which
# keeps a dump of the 200 retained photos to a few MB instead of ~80 MB.
# Restore with: pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean <file>
# `< /dev/null` on every docker command: belt-and-braces against the stdin
# swallowing described at the top of this file.
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  < /dev/null > ~/backups/pre-deploy-"$(date +%F-%H%M%S)".dump
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

# Prove the checkout actually advanced before spending time on a build. A deploy
# that silently no-ops must fail the job, not report success (that is exactly
# what the stdin bug above did for weeks).
head_sha="$(git rev-parse HEAD)"
if [ "$head_sha" != "$DEPLOY_SHA" ]; then
  echo "deploy aborted: HEAD is $head_sha, expected $DEPLOY_SHA" >&2
  exit 1
fi

docker compose -f docker-compose.prod.yml up -d --build < /dev/null

echo "deployed $(git rev-parse --short HEAD)"
docker compose -f docker-compose.prod.yml ps < /dev/null
