#!/usr/bin/env bash
# Pull-based deploy poller — runs ON the prod server from clawdbot's crontab.
#
# Why this exists: the server's firewall drops inbound SSH from GitHub's runners, so CI cannot
# push a deploy in. Outbound to GitHub works fine, so the server polls for new commits instead.
# No root, no firewall change, no deploy key stored in CI.
#
# Install (as clawdbot, no sudo needed):
#   crontab -e
#   */2 * * * * /home/clawdbot/web_analyzer/scripts/auto_deploy.sh >> /home/clawdbot/auto_deploy.log 2>&1
set -euo pipefail

APP_DIR="/home/clawdbot/web_analyzer"
REPO_URL="https://github.com/devtbs/TBS_web-analyzer.git"
LOCK="/tmp/tbs_auto_deploy.lock"

# Never let a slow build overlap the next poll.
exec 9>"$LOCK"
flock -n 9 || exit 0

LOCAL=$(git -C "$APP_DIR" rev-parse HEAD)
REMOTE=$(git ls-remote "$REPO_URL" main | cut -f1)

[ -z "$REMOTE" ] && { echo "$(date -u +%FT%TZ) could not reach GitHub"; exit 0; }
[ "$LOCAL" = "$REMOTE" ] && exit 0   # nothing new — stay quiet

echo "$(date -u +%FT%TZ) new commit ${REMOTE:0:7} (was ${LOCAL:0:7}) — deploying"
bash "$APP_DIR/scripts/deploy.sh"
