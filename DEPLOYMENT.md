# Deployment Guide — TBS Web Analysis Platform

Live at **[analysis.phyominthein.com](https://analysis.phyominthein.com)**  
Hosted on **Hostinger VPS** (`clawdbot@72.62.253.53`)  
Project path: `/home/clawdbot/web_analyzer`

---

## 🏗️ Stack Overview

| Layer | Technology |
|---|---|
| **Backend** | FastAPI + Gunicorn/Uvicorn, managed by **PM2** |
| **Frontend** | React/Vite — static files served by **Nginx** |
| **Database** | **PostgreSQL** (local on VPS) |
| **SSL** | **Certbot** (Let's Encrypt) |
| **CI/CD** | **GitHub Actions** (auto-deploy on push to `main`) |

---

## 🚀 CI/CD — Automated Deployment

Every push to `main` automatically deploys to the VPS via GitHub Actions.

### How it works
`.github/workflows/deploy.yml` SSHs into the VPS and runs:
1. `git pull origin main` — pulls latest code
2. `npm install && npm run build` — rebuilds the frontend
3. `pm2 restart tbs-backend` — restarts the backend

### GitHub Secrets Required

Go to repo → **Settings** → **Secrets and variables** → **Actions**

| Secret | Value |
|---|---|
| `VPS_HOST` | `72.62.253.53` |
| `VPS_USERNAME` | `clawdbot` |
| `VPS_SSH_KEY` | Private SSH key (`cat ~/.ssh/github_deploy`) |

### SSH Key Setup (one-time)

```bash
# On your local machine
ssh-keygen -t rsa -b 4096 -C "github-deploy" -f ~/.ssh/github_deploy

# Copy public key to VPS
ssh-copy-id -i ~/.ssh/github_deploy.pub clawdbot@72.62.253.53

# Copy private key to clipboard → paste into VPS_SSH_KEY secret
cat ~/.ssh/github_deploy | pbcopy
```

---

## 🛠️ First-Time VPS Setup

Only needed when setting up from scratch on a new VPS.

### 1. System Dependencies

```bash
sudo apt update
sudo apt install -y python3-pip python3-venv python3-dev \
    postgresql postgresql-contrib nginx certbot python3-certbot-nginx curl git
```

### 2. Node.js via NVM

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24
npm install -g pm2
```

### 3. Clone the Repository

```bash
git clone https://github.com/YOUR_ORG/web_analyzer.git /home/clawdbot/web_analyzer
```

### 4. Database Setup

```bash
sudo -u postgres psql
```
```sql
CREATE DATABASE tbs_db;
CREATE USER tbs_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE tbs_db TO tbs_user;
\q
```

Restore from backup:
```bash
psql -U tbs_user -d tbs_db < /home/clawdbot/tbs_backup.sql
```

### 5. Backend Setup

```bash
cd /home/clawdbot/web_analyzer/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn uvicorn
cp .env.example .env
# Edit .env with your actual API keys
nano .env
```

Start with PM2:
```bash
cd /home/clawdbot/web_analyzer/backend
pm2 start "source venv/bin/activate && gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000" --name tbs-backend
pm2 save
pm2 startup
```

### 6. Frontend Build

```bash
cd /home/clawdbot/web_analyzer/frontend
cp .env.example .env
# Set VITE_API_BASE_URL= (leave empty — Nginx handles routing)
npm install
npm run build
```

### 7. Nginx Configuration

Your config file is at `/etc/nginx/sites-enabled/analysis.phyominthein.com`:

```nginx
server {
    server_name analysis.phyominthein.com;

    # Serve React frontend static files
    root /home/clawdbot/web_analyzer/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy auth routes to FastAPI backend
    location /auth/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proxy API routes to FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/analysis.phyominthein.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analysis.phyominthein.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = analysis.phyominthein.com) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name analysis.phyominthein.com;
    return 404;
}
```

Test and reload:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

### 8. SSL Certificate

```bash
sudo certbot --nginx -d analysis.phyominthein.com
```

---

## 🛠️ Management Commands

```bash
# Backend
pm2 status                    # Check backend status
pm2 logs tbs-backend          # View backend logs
pm2 restart tbs-backend       # Restart backend
pm2 stop tbs-backend          # Stop backend

# Nginx
sudo nginx -t                 # Test Nginx config
sudo systemctl restart nginx  # Reload Nginx
tail -f /var/log/nginx/error.log  # Nginx error logs

# Database backup
pg_dump -U tbs_user tbs_db > ~/tbs_backup_$(date +%Y%m%d).sql
```
