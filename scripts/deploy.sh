#!/usr/bin/env bash
# Production deploy — run ON the prod server (invoked by CI over SSH, or by hand).
# Makes the server an exact mirror of origin/main, rebuilds the frontend, restarts the backend.
set -euo pipefail

APP_DIR="/home/clawdbot/web_analyzer"
# Deploy from THIS repo explicitly. The server's `origin` remote points at a different
# fork (kweephyo-pmt), so `git fetch origin` would deploy the wrong code — always fetch by URL.
REPO_URL="https://github.com/devtbs/TBS_web-analyzer.git"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$APP_DIR"

echo "→ Syncing code to $REPO_URL main"
git fetch "$REPO_URL" main
git reset --hard FETCH_HEAD            # deterministic: discard any drift, match main exactly

echo "→ Backend deps (fast no-op when unchanged)"
cd "$APP_DIR/backend"
source venv/bin/activate
pip install -q -r requirements.txt

echo "→ Building frontend"
cd "$APP_DIR/frontend"
rm -rf dist
npm ci
npm run build

echo "→ Restarting backend"
pm2 restart tbs-backend

echo "✓ Deployed $(git -C "$APP_DIR" rev-parse --short HEAD)"
