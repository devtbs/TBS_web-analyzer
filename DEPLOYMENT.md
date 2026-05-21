# Production Deployment Guide: Hostinger VPS

This guide provides step-by-step instructions for deploying and running the TBS Web Analysis & SEO Platform on your **Hostinger VPS** (`clawdbot@srv1307568`) under `/home/clawdbot/web_analyzer`.

It uses:
* **Backend**: FastAPI running via Gunicorn/Uvicorn, managed as a **Systemd service**.
* **Frontend**: React/Vite built static files served directly by **Nginx**.
* **Database**: Local **PostgreSQL** instance with database restoration.
* **SSL**: Encrypted connections managed via **Certbot (Let's Encrypt)**.

---

## 🛠️ Step 1: System Dependencies

Login to your VPS and ensure the required packages are installed:

```bash
sudo apt update
sudo apt install -y python3-pip python3-venv python3-dev postgresql postgresql-contrib nginx certbot python3-certbot-nginx curl
```

Ensure Node.js 18+ is installed (needed to build the frontend):
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 💾 Step 2: Database Setup & Restoration

1. **Create PostgreSQL User and Database:**
   Switch to the `postgres` user and create the database credentials match your `.env`:
   ```bash
   sudo -i -u postgres
   psql
   ```
   Run the following SQL commands:
   ```sql
   CREATE DATABASE tbs_marketing;
   CREATE USER tbs_user WITH PASSWORD 'tbs_secure_2024';
   GRANT ALL PRIVILEGES ON DATABASE tbs_marketing TO tbs_user;
   \q
   exit
   ```

2. **Restore Database from Backup:**
   Restore the `tbs_backup.sql` file located in your `/home/clawdbot/` directory:
   ```bash
   psql -U tbs_user -d tbs_marketing -h localhost -f /home/clawdbot/tbs_backup.sql
   ```
   *(Note: Enter the password `tbs_secure_2024` when prompted).*

---

## 🐍 Step 3: Backend Configuration & PM2

1. **Configure Environment Variables:**
   Create the production `.env` file in the backend directory:
   ```bash
   nano /home/clawdbot/web_analyzer/backend/.env
   ```
   Add the following values (replacing placeholders with actual keys):
   ```env
   ENVIRONMENT=production
   DATABASE_URL=postgresql://tbs_user:tbs_secure_2024@localhost:5432/tbs_marketing
   SECRET_KEY=09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7
   GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GROQ_API_KEY=your_groq_key
   DEEPSEEK_API_KEY=your_deepseek_key
   SERPAPI_KEY=your_serpapi_key
   FIRECRAWL_API_KEY=your_firecrawl_key
   ALLOWED_ORIGINS=https://yourdomain.com
   ```

2. **Build Virtual Environment:**
   ```bash
   cd /home/clawdbot/web_analyzer/backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   pip install gunicorn uvicorn
   deactivate
   ```

3. **Install PM2 globally (if not already installed):**
   ```bash
   sudo npm install -g pm2
   ```

4. **Start the Backend Service with PM2:**
   Start the app using Gunicorn and assign it the name `tbs-backend`:
   ```bash
   cd /home/clawdbot/web_analyzer/backend
   pm2 start "venv/bin/gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 127.0.0.1:8000 --timeout 120" --name tbs-backend
   ```

5. **Ensure PM2 starts on VPS boot:**
   Generate and configure the startup script for PM2 to persist processes across server reboots:
   ```bash
   pm2 startup
   ```
   *(Note: Copy and run the command printed by the output of `pm2 startup` in your terminal to enable startup hooks, then save the process list).*
   ```bash
   pm2 save
   ```

---

## ⚛️ Step 4: Frontend Configuration & Build

1. **Configure Production URL:**
   Create the production environment variables for the frontend:
   ```bash
   nano /home/clawdbot/web_analyzer/frontend/.env
   ```
   Add the API endpoint and client settings:
   ```env
   VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
   VITE_API_BASE_URL=https://yourdomain.com
   ```

2. **Build static assets:**
   ```bash
   cd /home/clawdbot/web_analyzer/frontend
   npm install
   npm run build
   ```
   This compiles your React application into optimized static assets under `/home/clawdbot/web_analyzer/frontend/dist`.

---

## 🌐 Step 5: Nginx Web Server Mapping

1. **Configure Web Block:**
   Your Nginx configuration file is located at `/etc/nginx/sites-enabled/analysis.phyominthein.com` and is configured to route traffic for `analysis.phyominthein.com`.

   Here is the configuration block for your reference:

   ```nginx
   server {
       server_name analysis.phyominthein.com;

       # 1. Serve the built React Frontend
       root /home/clawdbot/web_analyzer/frontend/dist;
       index index.html;

       location / {
           try_files $uri $uri/ /index.html;
       }

       # 2. Route API traffic to the Python Backend
       location /auth/ {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       location /api/ {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_buffering off;
           proxy_read_timeout 300s;
       }

       listen 443 ssl; # managed by Certbot
       ssl_certificate /etc/letsencrypt/live/analysis.phyominthein.com/fullchain.pem; # managed by Certbot
       ssl_certificate_key /etc/letsencrypt/live/analysis.phyominthein.com/privkey.pem; # managed by Certbot
       include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
       ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
   }

   server {
       if ($host = analysis.phyominthein.com) {
           return 301 https://$host$request_uri;
       } # managed by Certbot

       listen 80;
       server_name analysis.phyominthein.com;
       return 404; # managed by Certbot
   }
   ```
2. **Test & Restart Nginx:**
   After applying changes to Nginx, run:
   ```bash
   # Test configuration syntax
   sudo nginx -t
   # Reload Nginx server
   sudo systemctl restart nginx
   ```

---

## 🔒 Step 6: Secure with Let's Encrypt SSL

If you ever need to recreate or renew your SSL certificates:

```bash
sudo certbot --nginx -d analysis.phyominthein.com
```
Follow the interactive prompts. Certbot will handle the verification process, request the certificates, and automatically configure Nginx to use them.

---

## 🤖 Step 7: Automated Deployment & CI/CD

To make deployments easy and hands-free, we have configured a **GitHub Actions** workflow along with a local `/home/clawdbot/web_analyzer/deploy.sh` script.

Each time you push to the `main` branch, GitHub will automatically SSH into your Hostinger VPS and execute the update script to pull new code, update backend dependencies, restart PM2, and rebuild your frontend assets.

### 1. The Deployment Script (`deploy.sh`)
This script resides in your project root. When executed on your VPS, it automates:
* Git pulling the latest changes.
* Installing updated Python packages inside the backend virtual environment.
* Restarting your `tbs-backend` PM2 process.
* Running `npm install` and `npm run build` to generate the new frontend dist folder.

### 2. GitHub Actions Setup (via Tailscale)

The workflow in `.github/workflows/deploy.yml` connects to the VPS via your **Tailscale private network** before SSHing in — more secure than exposing SSH on the public IP.

**Add these secrets to GitHub:**  
Go to repo → **Settings** → **Secrets and variables** → **Actions**

| Secret | Value |
|---|---|
| `TS_AUTHKEY` | Tailscale auth key — see below how to generate |
| `VPS_TAILSCALE_IP` | Your VPS Tailscale IP (e.g. `100.x.x.x`) — find it in Tailscale Admin → Machines |
| `VPS_USERNAME` | `clawdbot` |
| `VPS_SSH_KEY` | Your deploy private key (`cat ~/.ssh/github_deploy`) |

**Generate a Tailscale Auth Key:**
1. Go to [tailscale.com/admin](https://tailscale.com/admin) → **Settings** → **Keys**
2. Click **Generate auth key**
3. Check ✅ **Reusable** and ✅ **Ephemeral**
4. Click **Generate key** and copy it into the `TS_AUTHKEY` GitHub Secret

Now every push to `main` automatically deploys through your secure Tailscale tunnel.

---

## 🛠️ Management Commands

* **Run Manual Deploy**: `/home/clawdbot/web_analyzer/deploy.sh`
* **Backend Status**: `pm2 status` or `pm2 info tbs-backend`
* **Backend Logs**: `pm2 logs tbs-backend`
* **Restart Backend**: `pm2 restart tbs-backend`
* **Stop Backend**: `pm2 stop tbs-backend`
* **Restart Nginx**: `sudo systemctl restart nginx`
* **Nginx Error Logs**: `tail -f /var/log/nginx/error.log`
