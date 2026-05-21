#!/bin/bash
set -e

echo "📦 Pulling latest code..."
cd /home/clawdbot/web_analyzer
git pull origin main

echo "⚛️ Building frontend..."
cd frontend
npm install
npm run build

echo "🔄 Restarting backend..."
pm2 restart tbs-backend

echo "✅ Deploy complete!"
