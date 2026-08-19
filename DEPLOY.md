# Deploy Nexora — Vercel (web) + Railway (API + Postgres)

## 0) Push code to GitHub
Repo: https://github.com/aryavgaur1/Ai-operating-system

```powershell
cd C:\Users\aryav\Desktop\apps
git add -A
git status
# commit when ready, then:
git push -u origin HEAD
```

Do **not** commit `.env`.

---

## 1) Railway — Postgres + API

1. Go to https://railway.app → login with GitHub  
2. **New Project** → **Deploy from GitHub repo** → `Ai-operating-system`  
3. Add plugin: **PostgreSQL** (Railway will inject `DATABASE_URL`)  
4. Open the **API service** (the GitHub-connected service) → **Settings**:
   - Root Directory: leave **empty** (repo root — uses `railway.toml`)
5. **Variables** tab — set at least:

| Variable | Value |
|----------|--------|
| `SAAS_MODE` | `true` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | long random string |
| `TOKEN_ENCRYPTION_KEY` | 64 hex chars (32 bytes) |
| `WEB_APP_URL` | `https://YOUR-APP.vercel.app` (set after Vercel) |
| `CORS_ORIGINS` | same as WEB_APP_URL (comma-separated if multiple) |
| `LLM_PROVIDER` | `anthropic` or `openai` or `mock` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | your key |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://YOUR-RAILWAY-API.up.railway.app/auth/google/callback` |
| `NOTION_OAUTH_CLIENT_ID` / `NOTION_OAUTH_CLIENT_SECRET` | optional |
| `NOTION_OAUTH_REDIRECT_URI` | `https://YOUR-RAILWAY-API.up.railway.app/oauth/notion/callback` |
| `ALLOW_NOTION_TOKEN_PASTE` | `true` for early testing |
| `SLACK_*` | optional for live Slack |
| `EMAIL_USER` / `EMAIL_PASS` | optional — **not usable on Railway** (Gmail SMTP times out) |
| `RESEND_API_KEY` | **required for invite email** — HTTPS mail via Resend |
| `EMAIL_FROM` | `Nexora OS <invites@your-verified-domain.com>` after verifying a domain at [resend.com/domains](https://resend.com/domains). Default `onboarding@resend.dev` only delivers to the Resend account owner. |
| `AUTO_VERIFY_SIGNUP` | `true` until email works |

Also set `RESEND_API_KEY` + the same `EMAIL_FROM` on **Vercel** (web) so the invite relay at `/api/internal/deliver-invite` can send.

`DATABASE_URL` should already be linked from Postgres.

6. Generate a public domain: Service → **Settings** → **Networking** → **Generate Domain**  
   Example: `https://nexora-api-production.up.railway.app`  
7. Redeploy. Hit `https://YOUR-API/health` → should show `{"ok":true,...}`  
8. Migrations run via `releaseCommand` in `railway.toml`. If needed, Railway → shell:
   `node db/migrate.js`

---

## 2) Vercel — Next.js web

1. Go to https://vercel.com → Import GitHub repo `Ai-operating-system`  
2. **Root Directory**: `apps/web`  
3. Framework: Next.js (auto)  
4. **Environment variables**:

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_API_URL` | `https://YOUR-RAILWAY-API.up.railway.app` |
| `NEXT_PUBLIC_DEMO_MODE` | `false` |
| `RESEND_API_KEY` | same as Railway (invite email relay) |
| `EMAIL_FROM` | same verified-domain sender as Railway |

5. Deploy → copy URL e.g. `https://ai-operating-system.vercel.app`  
6. Go back to Railway and set `WEB_APP_URL` + `CORS_ORIGINS` to that Vercel URL → redeploy API  

---

## 3) Update OAuth consoles (required for Google / Notion)

### Google Cloud → Credentials → your Web client
- Authorized JavaScript origins: `https://YOUR.vercel.app`  
- Authorized redirect URIs: `https://YOUR-API.up.railway.app/auth/google/callback`

### Notion Public integration (if using OAuth)
- Redirect URI: `https://YOUR-API.up.railway.app/oauth/notion/callback`  
(Local Internal token paste still works if `ALLOW_NOTION_TOKEN_PASTE=true`)

### Slack (if using)
- Redirect: `https://YOUR-API.up.railway.app/oauth/slack/callback`

---

## 4) Smoke test

1. Open Vercel URL → landing loads  
2. Register / Google login  
3. `/app/integrations` → connect Notion (token paste OK for now)  
4. Chat: `Create a Notion page called Live Test`  
5. Approvals: `Draft an email to the client about the new timeline`

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| CORS errors in browser | `WEB_APP_URL` must match Vercel URL exactly (https, no trailing slash) |
| `/health` down | Check Railway build logs; packages must build before `apps/api` |
| Login works, API 401 | `JWT_SECRET` must be stable (don’t change after users exist) |
| DB errors | Run `node db/migrate.js` on Railway; confirm `DATABASE_URL` |
| Google OAuth fail | Redirect URI must match Railway URL exactly |
| Invite email fails / “not delivered” | Resend test sender only emails the account owner. Verify a domain in Resend, set `EMAIL_FROM` + `RESEND_API_KEY` on Railway **and** Vercel. Gmail `EMAIL_USER`/`EMAIL_PASS` will not work on Railway (SMTP blocked). |
