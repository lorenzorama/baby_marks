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
