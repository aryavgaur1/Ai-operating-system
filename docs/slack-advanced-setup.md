# Slack advanced mode — setup

## Endpoints

| Purpose | Method | URL |
|---|---|---|
| Events (`app_mention`, messages) | POST | `https://nexora-api.up.railway.app/integrations/slack/events` |
| Slash `/nexora` | POST | `https://nexora-api.up.railway.app/integrations/slack/commands` |
| Approve & Run buttons | POST | `https://nexora-api.up.railway.app/integrations/slack/interactions` |

## Env checklist (Railway API)

```
SLACK_MODE=live
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APPROVALS_CHANNEL=#approvals
WEB_APP_URL=https://try-nexora.netlify.app
SLACK_TEAM_DOMAIN=your-workspace   # optional, for permalinks
```

## Slack app dashboard

1. **Event Subscriptions** → Request URL = `/integrations/slack/events` (already used).
2. **Slash Commands** → Create `/nexora` → Request URL = `/integrations/slack/commands`.
3. **Interactivity** → Enable → Request URL = `/integrations/slack/interactions`.
4. Invite the bot to `#approvals` and any channels it should post into.

## Smoke tests

1. In Slack: `/nexora list channels on slack` → ephemeral “Working…” then channel list reply.
2. In chat: `create new channel nexora-smoke-test` → approval card appears in `#approvals`.
3. Click **Approve & Run** → channel exists; thread says verified.
4. `@nexora what blocked engineering this week?` → intelligence reply in thread.
