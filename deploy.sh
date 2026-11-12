#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
APP_NAME=billkeeper
APP_PORT=3026
cd "$APP_DIR"
for command in git node npm pm2 curl; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
[[ -f .env.local ]] || { echo 'Copy .env.example to .env.local and configure APP_URL before deploying.' >&2; exit 1; }
git pull --ff-only
npm ci
npm run check
npm test
if node --env-file=.env.local -e "const fs=require('node:fs'); process.exit(fs.existsSync(process.env.DATABASE_PATH || './data/billkeeper.sqlite') ? 0 : 1)"; then npm run backup; fi
npm run build
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then pm2 delete "$APP_NAME"; fi
pm2 start npm --name "$APP_NAME" --cwd "$APP_DIR" -- start
for attempt in {1..20}; do
  if curl -fsS "http://127.0.0.1:$APP_PORT/" >/dev/null; then
    pm2 save
    echo "Billkeeper is responding on 127.0.0.1:$APP_PORT"
    exit 0
  fi
  sleep 1
done
pm2 logs "$APP_NAME" --lines 40 --nostream >&2
exit 1
