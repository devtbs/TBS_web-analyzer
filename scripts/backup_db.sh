#!/usr/bin/env bash
# Nightly Postgres backup — runs ON the prod server from clawdbot's crontab.
#
# Everything the agency has built lives in this database: analyses, topical maps, clustering runs,
# tracked keywords and their rank history, chat sessions. Most of it cost real API credits to
# produce and cannot be cheaply recreated, so it is backed up daily and kept for two weeks.
#
# Install (as clawdbot, no sudo needed):
#   crontab -e
#   30 2 * * * /home/clawdbot/web_analyzer/scripts/backup_db.sh >> /home/clawdbot/backup_db.log 2>&1
#
# Restore a dump:
#   pg_restore --clean --if-exists -d "$DATABASE_URL" /home/clawdbot/backups/tbs-YYYY-MM-DD.dump
set -euo pipefail

APP_DIR="/home/clawdbot/web_analyzer"
DEST="/home/clawdbot/backups"
KEEP_DAYS=14
MIN_BYTES=10000        # a dump smaller than this means something went wrong

mkdir -p "$DEST"

# Read DATABASE_URL from the app's own env file — one source of truth, no duplicated credentials.
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$APP_DIR/backend/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'')
if [ -z "${DATABASE_URL:-}" ]; then
    echo "$(date -u +%FT%TZ) ERROR: DATABASE_URL not found in backend/.env"
    exit 1
fi

STAMP=$(date -u +%Y-%m-%d)
OUT="$DEST/tbs-$STAMP.dump"

# -Fc = custom format: compressed, and restorable table-by-table with pg_restore.
# Write to .part first so an interrupted run never leaves a half-file that looks like a backup.
pg_dump -Fc --no-owner --no-acl -d "$DATABASE_URL" -f "$OUT.part"

SIZE=$(stat -c %s "$OUT.part")
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
    echo "$(date -u +%FT%TZ) ERROR: dump only ${SIZE}B — refusing to keep it"
    rm -f "$OUT.part"
    exit 1
fi

# Prove the dump is readable before it replaces yesterday's good one.
if ! pg_restore --list "$OUT.part" > /dev/null 2>&1; then
    echo "$(date -u +%FT%TZ) ERROR: dump failed its integrity check"
    rm -f "$OUT.part"
    exit 1
fi

mv "$OUT.part" "$OUT"
find "$DEST" -name 'tbs-*.dump' -mtime +$KEEP_DAYS -delete
find "$DEST" -name '*.part' -mtime +1 -delete

echo "$(date -u +%FT%TZ) ok $(basename "$OUT") $(du -h "$OUT" | cut -f1) | $(ls "$DEST"/tbs-*.dump | wc -l) kept"
