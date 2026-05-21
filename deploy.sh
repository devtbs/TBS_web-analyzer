#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

# Define directory paths
PROJECT_DIR="/home/clawdbot/web_analyzer"

echo "🚀 Starting Deployment under $PROJECT_DIR..."

cd "$PROJECT_DIR"

# 1. Pull latest code
echo "📦 Pulling latest changes from Git..."
git pull origin main

# 2. Update Backend
echo "🐍 Updating Backend dependencies..."
cd backend
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ..

# 3. Restart PM2 Process
echo "🔄 Restarting Backend Service via PM2..."
pm2 restart tbs-backend || pm2 start "venv/bin/gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 127.0.0.1:8000 --timeout 120" --name tbs-backend

# 4. Update Frontend
echo "⚛️ Installing Frontend dependencies and building..."
cd frontend
npm install
npm run build
cd ..

echo "✅ Deployment completed successfully!"
