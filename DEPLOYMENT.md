# Deployment Guide: TBS Web Analysis Platform

This guide provides step-by-step instructions for deploying the Web Analysis Platform to a production environment.

## 🚀 Recommended Architecture

For a modern, scalable deployment, we recommend:
1.  **Backend**: [Railway](https://railway.app/) or [Render](https://render.com/) (FastAPI + PostgreSQL)
2.  **Frontend**: [Vercel](https://vercel.com/) or [Netlify](https://netlify.com/) (React/Vite)
3.  **Database**: [Managed PostgreSQL](https://railway.app/template/postgresql)

---

## 1. Backend Deployment (Railway/Render)

### Step 1: Environment Variables
Create a new project and add the following Environment Variables:

| Variable | Description |
| :--- | :--- |
| `DATABASE_URL` | Your production PostgreSQL connection string. |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console. |
| `SECRET_KEY` | A long, random string for JWT signing. |
| `OPENAI_API_KEY` | (Optional) For AI analysis. |
| `ANTHROPIC_API_KEY` | (Optional) For AI analysis. |
| `ENVIRONMENT` | Set to `production`. |
| `ALLOWED_ORIGINS` | `https://your-frontend.vercel.app` (Your actual frontend URL). |

### Step 2: Build Command
If your provider doesn't detect the build automatically:
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:$PORT`
  *(Note: You may need to add `gunicorn` to `requirements.txt` if not already there)*

---

## 2. Frontend Deployment (Vercel)

### Step 1: Build Configuration
Connect your GitHub repository and point to the `frontend/` directory.
- **Framework Preset**: Vite
- **Root Directory**: `frontend`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`

### Step 2: Environment Variables
Add the following variable:
- `VITE_GOOGLE_CLIENT_ID`: Your Google OAuth Client ID.
- `VITE_API_BASE_URL`: (Recommended) Set this to your **Backend URL** (e.g., `https://tbs-backend.up.railway.app`).

---

## 3. Google OAuth Configuration (CRITICAL)

Once you have your production URLs, you **MUST** update your Google Cloud Console settings:

1.  **Authorized JavaScript Origins**:
    - `http://localhost:5173` (Keep for development)
    - `https://your-frontend.vercel.app` (Production)
2.  **Authorized Redirect URIs**:
    - `http://localhost:5173/auth/callback`
    - `https://your-frontend.vercel.app/auth/callback`

---

## 🛠️ Unified (Single Server) Deployment via Docker

If you prefer to deploy everything as a single container (e.g., on a VPS or AWS EC2), you can use the provided Dockerfile.

### Build and Run locally:
```bash
docker build -t tbs-web-platform .
docker run -p 8000:8000 --env-file .env tbs-web-platform
```

---

## ✅ Deployment Checklist
- [ ] DATABASE_URL is pointing to a persistent PostgreSQL instance.
- [ ] ALLOWED_ORIGINS includes your production frontend URL.
- [ ] Google OAuth origins and redirects are updated in Cloud Console.
- [ ] `npm run build` succeeds locally before pushing.
- [ ] Tokens and API keys are stored in "Secrets" (not `.env` files in git).
