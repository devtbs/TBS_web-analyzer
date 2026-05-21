# Repository Handover Guide

This guide outlines the steps to hand over ownership and management of the **TBS Web Analysis & SEO Platform** to another developer.

---

## 🔑 1. GitHub Access Transfer

### Option A: Add as Collaborator (recommended first step)
1. Go to your GitHub repo → **Settings** → **Collaborators**
2. Click **Add people** → enter their GitHub username
3. Set permission to **Admin**

### Option B: Transfer Ownership
1. Go to **Settings** → **General** → scroll to **Danger Zone**
2. Click **Transfer ownership** → enter their GitHub username

---

## 🌐 2. VPS Access via Tailscale (No SSH Keys Needed)

The VPS uses **Tailscale SSH** — no keys required. Just invite the new developer to your Tailscale network.

1. Go to [tailscale.com](https://tailscale.com) → **Admin** → **Invite users**
2. Enter their email
3. Once they accept and install Tailscale, they can SSH directly:
   ```bash
   ssh clawdbot@YOUR-VPS-TAILSCALE-IP
   ```
   No keys, no passwords — Tailscale handles auth.

> To find the VPS Tailscale IP: open Tailscale Admin → **Machines** → find your VPS hostname.

---

## 🤖 3. CI/CD GitHub Secrets

The auto-deploy workflow needs these secrets under:  
`Settings` → `Secrets and variables` → `Actions`

| Secret | Description |
|---|---|
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID (from Tailscale Admin → Settings → OAuth clients) |
| `TS_OAUTH_SECRET` | Tailscale OAuth secret |
| `VPS_TAILSCALE_IP` | VPS IP on the Tailscale network (e.g. `100.x.x.x`) |
| `VPS_USERNAME` | `clawdbot` |
| `VPS_SSH_KEY` | Private SSH key for the deploy user (from `~/.ssh/github_deploy`) |

### How to create a Tailscale OAuth client:
1. Go to [tailscale.com/admin](https://tailscale.com/admin) → **Settings** → **OAuth clients**
2. Click **Generate OAuth client**
3. Scope: `devices` — Tag: `tag:ci`
4. Copy the **Client ID** and **Secret** into GitHub Secrets

---

## 💾 4. Credentials to Deliver Securely

Send these to the new developer via an encrypted channel (1Password, Signal, etc.):

| Key | Where Used |
|---|---|
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Backend `.env` + Frontend `.env` |
| `DEEPSEEK_API_KEY` | Backend `.env` (AI article writing) |
| `SERPAPI_KEY` | Backend `.env` (SERP competitor analysis) |
| `FIRECRAWL_API_KEY` | Backend `.env` (website crawling) |
| `SECRET_KEY` | Backend `.env` (JWT signing) |

---

## 📘 5. Reference Guides
* **Local Dev Setup**: [QUICKSTART.md](./QUICKSTART.md)
* **Production Deployment**: [DEPLOYMENT.md](./DEPLOYMENT.md)
* **Writing Custom Prompts**: See [README.md](./README.md#✍️-ai-content--custom-writing-prompts)
