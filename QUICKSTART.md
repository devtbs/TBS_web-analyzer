# Quick Start — Local Development

The app is already live at [tool.tbs-dev.com](https://tool.tbs-dev.com). This guide is for running it locally on your machine.

---

## Prerequisites

- Python 3.9+
- Node.js 18+
- PostgreSQL (local instance)
- A Google account (for OAuth login)
- API keys from the project owner

---

## 1. Clone the Repo

```bash
git clone https://github.com/kweephyo-pmt/TBS_web-analyzer.git
cd TBS_web-analyzer
```

---

## 2. Backend Setup

```bash
cd backend
python -m venv venv
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` with your actual values:

```env
DATABASE_URL=postgresql://tbs_user:tbs_secure_2024@localhost:5432/tbs_marketing
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
SECRET_KEY=any-random-secret-string
DEEPSEEK_API_KEY=
SERPAPI_KEY=
FIRECRAWL_API_KEY=
ENVIRONMENT=development
ALLOWED_ORIGINS=http://localhost:5173
```

Start the backend:

```bash
source venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Backend runs at `http://localhost:8000` — API docs at `http://localhost:8000/docs`

---

## 3. Frontend Setup

Open a new terminal:

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env`:

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_API_BASE_URL=http://localhost:8000
```

Start the frontend:

```bash
npm run dev
```

Frontend runs at `http://localhost:5173`

---

## 4. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Open your existing OAuth client (or create a new **Web application** one)
3. Add to **Authorized JavaScript origins**: `http://localhost:5173`
4. Add to **Authorized redirect URIs**: `http://localhost:5173/auth/callback`
5. Copy **Client ID** and **Client Secret** into both `.env` files

---

## 5. Database (Local)

The production database backup is at `/home/clawdbot/tbs_backup.sql` on the VPS. To restore locally:

```bash
createdb tbs_marketing
psql tbs_marketing < tbs_backup.sql
```

---

## 6. Deploying Changes

Push to `main` — GitHub Actions automatically deploys to the live VPS:

```bash
git add .
git commit -m "your changes"
git push origin main
```

Watch the deploy at: `https://github.com/kweephyo-pmt/TBS_web-analyzer/actions`

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Backend won't start | Check `backend/.env` exists and `DATABASE_URL` is correct |
| Google login fails | Verify `VITE_GOOGLE_CLIENT_ID` matches Google Console and `localhost:5173` is in authorized origins |
| API calls fail | Make sure `VITE_API_BASE_URL=http://localhost:8000` is in `frontend/.env` |
| DB connection error | Ensure PostgreSQL is running: `brew services start postgresql` (Mac) |
| `pm2` not found (VPS) | Run: `export PATH="$HOME/.nvm/versions/node/v24.13.0/bin:$PATH"` |
