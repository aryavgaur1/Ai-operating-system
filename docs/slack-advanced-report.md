# Slack capability report — before vs after

Branch: `cursor/landing-premium-analysis`  
Focus: make Slack the **control plane** for Nexora (approve-in-Slack, slash NL, verify-after-write).

---

## Before (what Slack could do)

| Area | Capability | Notes |
|---|---|---|
| Messaging | `postMessage`, external channel post, reactions, pins, bookmarks | Live when `SLACK_MODE=live` |
| Channels | create, invite, topic/purpose, list, join-on-post fallback | Create/invite ran **without** high-consequence approval |
| Intelligence | war room, incident channel, digests, blockers, unanswered, semantic search, owner/decision, meeting notes | Strong read/analyze surface |
| Agent in Slack | `@nexora` app_mention → plan → execute → thread reply | Worked; approvals still pushed users to the **web Approvals** page |
| Approvals | Web UI Approve & Run only | No Block Kit buttons; no approvals channel notify |
| Slash | Scopes included `commands` | **No** `/nexora` handler wired |
| Verify | Message `ts` + channel `conversations.info` for create/post | Missing for update/delete/DM/join/war-room depth |
| Writes gated | Only `postMessageExternalChannel`, `deleteMessage` | Channel creates / war rooms / invites auto-ran |

**Typical loop before:** Chat or `@nexora` → pending approval → open web app → Approve & Run.

---

## After (what Slack can do now)

| Area | Capability | Notes |
|---|---|---|
| Control plane | **Approve & Run / Reject in Slack** (Block Kit) | Posted to `SLACK_APPROVALS_CHANNEL` when any high-consequence action is queued |
| Slash | **`/nexora <NL>`** | Same agent path as chat; ephemeral ack + in-channel reply |
| Interactions | `POST /integrations/slack/interactions` | Claim → execute → external verify → thread outcome |
| Commands | `POST /integrations/slack/commands` | Slash entrypoint |
| New actions | `updateMessage`, `deleteMessage`, `getPermalink`, `joinChannel`, `openDm` | NL wired in planner |
| Governance | High-consequence now includes: createChannel, inviteUsers, createWarRoom, createIncident, uploadFile, createCanvas, updateMessage, openDm (+ existing external post / delete) | Safer default for ops-changing writes |
| Verify | Expanded for war room / incident / update / delete / invite / DM / join | Refuse “ok but missing object” |
| Chat copy | Approval note points at Slack channel when configured | Dual path: web + Slack |

**Typical loop after:** Chat / `@nexora` / `/nexora` → approval card in `#approvals` → **Approve & Run** in Slack → verified external object → outcome in thread.

---

## Action matrix (live)

| Action | Live | Approval | External verify |
|---|---|---|---|
| `postMessage` | Yes | Low | Yes (`ts` in history) |
| `postMessageExternalChannel` | Yes | High | Yes |
| `createChannel` | Yes | **High (new)** | Yes (`conversations.info`) |
| `inviteUsers` | Yes | **High (new)** | Structural |
| `createWarRoom` / `createIncident` | Yes | **High (new)** | Yes (channel info) |
| `uploadFile` / `createCanvas` | Yes | **High (new)** | Structural |
| `updateMessage` / `deleteMessage` | Yes (**new** / wired) | High | Yes |
| `openDm` / `joinChannel` / `getPermalink` | Yes (**new**) | DM high / join low | Yes where applicable |
| Digests / search / summarize / blockers | Yes | Low | N/A |
| Slack Approve & Run buttons | Yes (**new**) | — | Uses same `executeApprovedAction` engine |
| `/nexora` slash | Yes (**new**) | Via planner policy | Same as agent |

---

## NL examples (new / stronger)

- `/nexora create a launch war room for Project Atlas`
- `/nexora create incident workspace for checkout outage` (still multi-tool with Jira/Notion)
- `@nexora invite @arya to #incident-abc`
- `edit message 1712345678.000100 in #general to "updated ETA 4pm"`
- `open dm to @arya saying standup moved to 10:30`
- `join #engineering on slack`
- Pending approval → click **Approve & Run** in `#approvals` (no web hop required)

---

## What you need to configure (Railway + Slack app)

1. **Env (Railway API)**
   ```
   SLACK_MODE=live
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   SLACK_APPROVALS_CHANNEL=#approvals
   WEB_APP_URL=https://try-nexora.netlify.app
   ```
2. **Slack app → Slash Commands**  
   - Command: `/nexora`  
   - Request URL: `https://nexora-api.up.railway.app/integrations/slack/commands`
3. **Slack app → Interactivity & Shortcuts**  
   - Request URL: `https://nexora-api.up.railway.app/integrations/slack/interactions`
4. **Create `#approvals`** (or your chosen channel) and invite `@nexora-agent`.
5. Reinstall / reconnect OAuth if scopes changed (existing app already requests `commands` + `chat:write`).

See also: [slack-advanced-setup.md](./slack-advanced-setup.md).
