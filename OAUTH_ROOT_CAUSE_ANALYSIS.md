# OAUTH_ROOT_CAUSE_ANALYSIS.md

**Product:** Nexora AI OS  
**Scope:** Notion Connect OAuth (multi-tenant SaaS)  
**Date:** 2026-08-05  
**Status:** Root cause identified — **do not treat as a random code bug**

---

## 1. Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Browser (apps/web — Next.js :3000)                                      │
│  • localStorage: nexora_access_token (15m JWT)                          │
│  • cookie: nexora_refresh (httpOnly)                                    │
│  • Integrations / Onboarding → window.location = connectUrl             │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ GET /integrations (Bearer)
                                │ GET /oauth/notion/start?token=<accessJwt>
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ API (apps/api — Express :4000)                                          │
│  Mount order:                                                           │
│    /auth → /oauth/notion → /oauth/slack → /health                       │
│    then global authenticate → /chat /integrations /admin …              │
│  Packages: stores (Postgres), connectors, agent-core                    │
└───────────────┬─────────────────────────────┬───────────────────────────┘
                │                             │
                │ authorize redirect          │ callback + token exchange
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────────────────┐
│ Notion (api.notion.com /  │   │ Postgres                                │
│ app.notion.com install)   │   │  oauth_connections                      │
│  page picker → Allow      │   │  (org_id, user_id, tool) UNIQUE         │
└───────────────────────────┘   │  AES-GCM encrypted tokens               │
                                └─────────────────────────────────────────┘
```

**Dual mode**

| Mode | `SAAS_MODE` | Integrations | Chat Notion token |
|------|-------------|--------------|-------------------|
| Customer SaaS | `true` | Per-user OAuth only | `oauth_connections` only (`saasStrict`) |
| Admin demo | `false` | Fake “connected”; Connect hidden | `.env` `NOTION_API_KEY` |

---

## 2. Current OAuth Flow (as implemented)

1. User logged in → `GET /integrations` builds  
   `http://localhost:4000/oauth/notion/start?token=<accessJwt>`
2. Browser navigates to `/oauth/notion/start`
3. API verifies access JWT via `getJwtSecret()`
4. API creates **opaque** 32-hex `state` in an **in-memory `Map`** (30m TTL)  
   *(legacy JWT state still accepted if `state` contains `.`)*
5. If `NOTION_OAUTH_REDIRECT_URI` is `https://…`, API **preflights** `{origin}/health` (8s)
6. API redirects to  
   `https://api.notion.com/v1/oauth/authorize?client_id&redirect_uri&response_type=code&owner=user&state`
7. User picks pages → **Allow access**
8. Notion should redirect browser to  
   `{redirect_uri}?code=…&state=…`
9. API `/oauth/notion/callback` verifies state → `POST /v1/oauth/token` → `storeConnection` → redirect to `/app/integrations?connected=notion`

**Secondary path (dev only):** `POST /integrations/notion/connect-token` (paste Internal Integration secret). Not acceptable as customer UX.

---

## 3. Expected OAuth Flow (product)

```text
Signup → Integrations → Connect Notion
  → Official Notion authorize / page picker
  → Allow
  → Browser returns to Nexora callback with code+state
  → Token exchange
  → Encrypted row in oauth_connections for THAT user/org
  → UI “Connected”
  → Chat uses THAT user’s Notion token (never another tenant’s / never admin .env in SaaS)
```

No paste. No internal secret. No mock.

---

## 4. Exact Failure Point

### Primary failure (production symptom)

**Execution stops on Notion’s install page during “Authorizing…”, before any redirect to Nexora.**

| Step | Status | Evidence |
|------|--------|----------|
| Nexora `/oauth/notion/start` | ✅ Works | Terminal logs: `[oauth/notion] start → redirect { redirectUri, clientIdSuffix }` |
| Notion authorize page loads | ✅ Works | Screenshots with correct `client_id` + `redirect_uri` in URL bar |
| User clicks Allow | ⚠️ Starts | “Authorizing…” spinner |
| Notion completes Allow → browser redirect | ❌ **FAILS** | Modal: **“Integration appears to have timed out”** |
| Nexora `/callback?code&state` | ❌ Never reached with code | **Zero** `hasCode: true` across all terminal history |
| Token exchange / DB write | ❌ Never runs | No `success →` logs |

**Exact failure point:**  
`Notion Allow (install-integration) → redirect to redirect_uri`  
**Not** Nexora token exchange. **Not** Postgres. **Not** the Connect button.

### Secondary / misleading symptom (must not be confused)

Opening or probing:

`http://localhost:4000/oauth/notion/callback`  
**(no query string)**

returns:

`Missing code or state from Notion callback`

with log:

`callback hit { hasCode: false, hasState: false }`

That only proves the **route is mounted**. It is **not** evidence that Notion redirected after Allow. Agent health probes and manual tab opens produce this message.

---

## 5. Evidence

### 5.1 Logs (terminals + transcript)

- Repeated: `start → redirect` with localhost, `127.0.0.1`, and multiple `*.trycloudflare.com` callbacks.
- **Never observed:** `hasCode: true` or `[oauth/notion] success →`.
- Observed bare callbacks: `hasCode: false, hasState: false`.
- Tunnel periods: `Unable to reach the origin service … dial tcp 127.0.0.1:4000: connection refused` (API down while tunnel up).

### 5.2 Screenshots / URLs

- Timeout modal on `app.notion.com/install-integration` while Allow is in progress.
- Authorize URL contained correct new client `…ca3d918a` and  
  `redirect_uri=http://localhost:4000/oauth/notion/callback` (and earlier trycloudflare variants).
- Stale tabs reused old JWT `state=` after opaque-state change.

### 5.3 Network / DNS (this machine)

- Wi‑Fi DNS: Reliance `192.168.29.1`.
- `grammar-ones-membrane-diesel.trycloudflare.com` → **NXDOMAIN** on Reliance.
- Same hostname resolves via `1.1.1.1` / `8.8.8.8`.
- `api.notion.com` resolves fine on Reliance.
- Ethernet interface already had `8.8.8.8` — Wi‑Fi did not.

### 5.4 Redirect URIs tried (churn)

1. `http://localhost:4000/oauth/notion/callback`
2. `http://127.0.0.1:4000/oauth/notion/callback` (Notion portal rejects IP redirects)
3. `https://birth-without-housewares-curriculum.trycloudflare.com/oauth/notion/callback`
4. `https://purse-dame-packs-titles.trycloudflare.com/oauth/notion/callback`
5. `https://grammar-ones-membrane-diesel.trycloudflare.com/oauth/notion/callback`

Also observed intermittent Notion error: **“Missing or invalid redirect_uri”** when portal URI ≠ authorize URL.

---

## 6. Files Responsible

| File | Role | Relevance to failure |
|------|------|----------------------|
| `apps/api/src/routes/oauth-notion.ts` | start / callback / state / preflight | Start works; callback never gets `code` |
| `apps/api/src/routes/integrations.ts` | builds `connectUrl`; token paste bypass | Connect wiring OK |
| `apps/api/src/routes/oauth-slack.ts` | Slack OAuth (JWT state, no HTTPS preflight) | Comparison baseline |
| `apps/api/src/middleware/auth.ts` | `getJwtSecret`, access JWT | Shared secret OK after earlier fix |
| `apps/api/src/index.ts` | mounts `/oauth/notion` **before** global auth | Correct for browser redirect |
| `packages/stores/src/oauthStore.ts` | encrypted per-user tokens | Never reached on failed Allow |
| `apps/web/.../integrations/page.tsx` | navigates to `connectUrl` | OK |
| `apps/web/.../onboarding/page.tsx` | Connect Notion UX | OK |
| `.env` | `NOTION_OAUTH_*`, `SAAS_MODE` | Must match Notion portal exactly |
| Notion Developer Portal | Redirect URI allowlist + capabilities | External config; mismatch breaks Allow |

**Not the primary culprit for Allow timeout:** chat connectors, agent-core, Notion block builders (`packages/connectors/src/notion.ts` type warnings).

---

## 7. Why Previous Fixes Failed

| Attempt | Why it failed |
|---------|----------------|
| “API was down” restart | Sometimes true (race); did not explain timeouts when `/health` was OK |
| Trim JWT / shared `getJwtSecret` | Fixed Connect **start** auth; Allow still timed out |
| New Public connection / new client id | Start still worked; Allow still timed out |
| Cloudflare quick tunnel | Unstable URL + API restart races + **Reliance DNS NXDOMAIN** for some hostnames |
| Switch back to localhost | Notion Allow still timed out; no `hasCode: true` |
| Opaque short `state` | Good hardening; user’s failing URL still showed **old JWT state** (stale tab) |
| Paste Internal Integration token | Sidesteps OAuth; not customer UX |
| Preflight `/health` on HTTPS redirect | Prevents starting when tunnel dead; does not fix Notion Allow itself |
| Treating “Missing code or state” as OAuth failure | **Misdiagnosis** — bare callback probe |

**Pattern:** We repeatedly patched Nexora **after** a step that never runs. The IdP never returns.

---

## 8. Recommended Fix

### 8.1 Verdict

**True multi-tenant Notion OAuth is implementable and mostly already coded.**  
The day was lost because the failure is **before Nexora’s callback**, amplified by **local networking / tunnel / DNS / config churn**, not because `storeConnection` or chat is wrong.

Code alone **cannot** force Notion’s Allow UI to finish if:

1. `redirect_uri` in the authorize URL is not **exactly** allowlisted in the Notion connection, or  
2. After Allow, the browser cannot reach the callback host (DNS NXDOMAIN, API down, tunnel origin refused), or  
3. Notion’s install session errors internally (capabilities / account / extensions) — still manifests as their timeout modal.

### 8.2 Minimum infrastructure (required for reliable OAuth)

| Environment | Requirement |
|-------------|-------------|
| **Local dev** | Stable callback host that **resolves on the developer’s DNS** and reaches `:4000` for the whole Allow window. Prefer: Chrome **Secure DNS → Cloudflare**, **or** Wi‑Fi DNS `1.1.1.1`/`8.8.8.8`, **plus** one stable tunnel URL registered in Notion — **or** `http://localhost:4000/...` if Allow completes in that environment. |
| **Production (customers)** | **Fixed HTTPS domain**, e.g. `https://api.yourdomain.com/oauth/notion/callback`. No `trycloudflare` quick tunnels. Single redirect URI in Notion portal. |

Without a stable, resolvable, reachable `redirect_uri`, **Connect Notion cannot meet the success criteria** no matter how many times we rewrite `oauth-notion.ts`.

### 8.3 Code / platform hardening (necessary, not sufficient alone)

1. **Durable OAuth state** in Postgres/Redis (not process `Map`) — survives `ts-node-dev` restart; align with Slack’s durable JWT **or** shared DB state for both.  
2. **OAuth debug mode** (`OAUTH_DEBUG=true`): log start, authorize URL (redacted), state id, callback query keys, token exchange status, redirect dest — never log secrets/codes.  
3. **Single source of truth for redirect URI**: reject start if env URI ≠ expected path `/oauth/notion/callback`; surface mismatch in UI.  
4. **Remove/hide paste-token** from primary customer UX (keep behind admin/dev flag only).  
5. **Capabilities checklist** in runbook: Public connection must have read/update/insert (as needed) enabled in Notion portal.  
6. Production: document one Client ID / Secret / Redirect for the environment; ban quick-tunnel URLs in prod config.

### 8.4 Slack vs Notion (why Slack “works”)

| | Slack | Notion |
|--|-------|--------|
| State | JWT (survives restart) | In-memory Map (fragile) |
| HTTPS preflight | No | Yes (blocks start if tunnel dead) |
| Local callback | `http://localhost:4000/...` typically fine | Allow UI frequently times out before redirect in this project’s evidence |
| Failure mode seen | Scope/config errors on Slack’s page | Timeout **before** redirect; no callback code |

Reusable: Connect URL pattern, `storeConnection`, encrypted tokens, per-user chat binding.  
Do **not** assume Slack’s localhost success proves Notion Allow→localhost always works on this network/account.

---

## 9. Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ship “fixed OAuth” without stable HTTPS in prod | Customers hit same timeout | Gate Connect on configured public HTTPS redirect |
| In-memory state + API restart mid-Allow | Callback 401 | Persist state |
| Quick tunnel URL rotation | Permanent redirect mismatch | Named tunnel or real domain |
| ISP DNS breaking `*.trycloudflare.com` | Browser never reaches callback | Secure DNS / custom domain |
| Multiple Notion connections / wrong client in `.env` | Invalid redirect / timeout | One connection per env; verify client suffix in logs |
| Leaving paste-token as primary UX | Not SaaS-grade | Hide; OAuth only for customers |
| Weak `JWT_SECRET` / `TOKEN_ENCRYPTION_KEY` defaults | Token forge / decrypt in shared deploys | Require strong secrets in prod |

---

## 10. Implementation Plan

### Phase A — Stop thrashing (ops) ✅ identified

1. Pick **one** Notion Public connection (client ending `ca3d918a` or the single prod client).  
2. Pick **one** redirect URI and freeze it.  
3. For local: enable Chrome Secure DNS (Cloudflare) **or** set Wi‑Fi DNS to `1.1.1.1`.  
4. Keep API + tunnel (if used) up for the entire Allow click; close stale install tabs.  
5. Confirm Notion portal Redirect URI **character-for-character** matches `.env`.

### Phase B — Code (after this report)

1. Add `OAUTH_DEBUG` structured logging on Notion (and Slack) OAuth.  
2. Persist Notion `state` in Postgres (table `oauth_pending_states` or Redis).  
3. On callback: distinguish bare hit vs Notion error vs success in logs and HTML.  
4. Gate customer UI: Connect Notion only; paste behind `ALLOW_NOTION_TOKEN_PASTE=true`.  
5. E2E checklist script: health → start (expects 302 to notion) → simulate callback reject without code → document manual Allow.

### Phase C — Production

1. Deploy API under `https://api.<domain>`.  
2. Set `NOTION_OAUTH_REDIRECT_URI=https://api.<domain>/oauth/notion/callback`.  
3. Register that URI once in Notion.  
4. Verify Connect → Allow → Connected → chat creates page in **that user’s** workspace.

### Success criteria (unchanged)

New account → Connect Notion → Allow → return Connected →  
“Create a Product Roadmap” uses **that user’s** OAuth token in Postgres — not admin `.env`, not paste.

---

## Appendix A — Multi-tenant SaaS review (Pass 6)

| Area | Assessment |
|------|------------|
| Workspace isolation | Orgs + users in Postgres; chat scopes by `organizationId` + `userId` |
| OAuth isolation | `UNIQUE (organization_id, user_id, tool)` — correct model |
| Token storage | AES-GCM at rest; API returns flags not plaintext — good |
| Per-user integrations | SaaS path loads tokens by user; `saasStrict` blocks env fallback — good |
| Session management | Access JWT 15m + refresh cookie rotate — OK; OAuth start depends on non-expired access JWT in query |
| Security gaps | Access JWT in query string (leak via logs/history); weak default secrets; in-memory OAuth state |
| Scalability | In-memory Notion state **not** multi-instance safe; must move to shared store before horizontal scale |
| Production readiness of OAuth UX | **Blocked by stable HTTPS callback + Notion portal discipline**, not by missing `storeConnection` |

---

## Appendix B — One-line root cause

**Nexora successfully starts Notion OAuth; Notion’s Allow step never redirects back with `code`, so callback/token/DB never run. Local DNS/tunnel/API races and redirect-URI churn made this look like an app bug; the failure point is the Notion→browser redirect boundary, which requires a stable, resolvable, reachable redirect URI and matching portal config—not more speculative patches to the callback handler.**
