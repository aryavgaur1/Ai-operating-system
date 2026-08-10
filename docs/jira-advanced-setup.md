# Jira advanced mode — Atlassian setup

## What Nexora supports now

| Action | Live | Approval |
|---|---|---|
| `createIssue` (priority, due, labels, components, custom fields) | Yes | High |
| `updateIssue` (assign / priority / due / labels / components) | Yes | High |
| `transitionIssue` | Yes | High |
| `addComment` | Yes | High |
| `linkIssues` (Blocks / blocked by) | Yes | High |
| `addAttachment` | Yes (optional) | High |
| `searchIssues` (+ blocker JQL) | Yes | Low |
| `listBoards` / `listSprints` / `getSprintIssues` | Yes | Low |
| Status webhook → Slack notify | Yes (needs webhook URL + env) | — |

NL examples:

- “What’s blocking Project Y?” → `searchIssues`
- “Move KAN-42 to In Progress” → `transitionIssue`
- “Add a comment on KAN-42 …” → `addComment`
- “Create an incident workspace” → Slack channel + Jira + Notion + Slack notify (multi-approval)

## What we need from you

1. **Confirm project `KAN`** (or set `JIRA_DEFAULT_PROJECT`) has issue types you want: Task, Bug, Story, and ideally **Risk**.
2. **Re-connect Jira OAuth** in Integrations after any scope change (current scopes: `read:jira-work`, `write:jira-work`, `read:jira-user`, `offline_access`).
3. **Custom field IDs** (from Jira → Project settings → Fields), if you use them:
   - `JIRA_CUSTOM_SEV_FIELD=customfield_XXXXX`
   - `JIRA_CUSTOM_ENV_FIELD=customfield_XXXXX`
   - `JIRA_CUSTOM_DEPLOY_RISK_FIELD=customfield_XXXXX`
4. **Webhook (status → Slack)**  
   - In Jira: **Settings → System → Webhooks → Create**  
   - **URL:** `https://nexora-api.up.railway.app/webhooks/jira`  
   - **Events:** Issue → updated (include status changes)  
   - **Slack channel for pings (configured):** `#engineering`  
     Set on Railway API: `JIRA_STATUS_SLACK_CHANNEL=#engineering`  
     (change to another channel name/ID anytime)

5. **Discover custom field IDs (SEV / Environment / Deploy risk)**  
   After Jira is connected, call (while logged in):

   `GET https://nexora-api.up.railway.app/integrations/jira/fields`

   Response includes `suggested.JIRA_CUSTOM_SEV_FIELD`, `JIRA_CUSTOM_ENV_FIELD`, `JIRA_CUSTOM_DEPLOY_RISK_FIELD`.  
   Paste those into Railway env vars, then redeploy/restart the API.

   If no matching fields exist yet, create them in Jira project **KAN** first (Select List / Text), then call the endpoint again.


## Env checklist (Railway API)

```
JIRA_MODE=live
JIRA_DEFAULT_PROJECT=KAN
JIRA_CLIENT_ID=...
JIRA_CLIENT_SECRET=...
JIRA_OAUTH_REDIRECT_URI=https://nexora-api.up.railway.app/oauth/jira/callback
JIRA_CUSTOM_SEV_FIELD=          # optional
JIRA_CUSTOM_ENV_FIELD=          # optional
JIRA_CUSTOM_DEPLOY_RISK_FIELD=  # optional
JIRA_STATUS_SLACK_CHANNEL=      # optional #channel for status webhooks
```
