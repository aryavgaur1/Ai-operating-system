# FAQ, security, privacy, enterprise, docs

## FAQ (landing)

**What is Nexora?** An AI Operating System that connects your tools, reasons over context, and executes real work — not just answers questions.

**How does the AI work?** Intent classification, retrieval, planning, then tool execution against live APIs like Slack and Notion.

**How are integrations connected?** In demo mode via secure .env credentials; SaaS mode supports per-user OAuth when enabled.

**Can I use my own Slack?** Yes — your workspace bot token powers live channel and message actions.

**Can I connect my own Notion?** Yes — pages are created in your Notion workspace via your integration token.

**How secure is my data?** Encrypted tokens, JWT sessions, org isolation, and approval gates for high-impact actions.

**Does Nexora remember conversations?** Yes — chat history and workspace preferences persist in Postgres.

**Can multiple people collaborate?** Multi-user SaaS is built in and can be enabled when you are ready to scale.

## Enterprise

Enterprise page / posture: operate like a platform team — workspace management, organizations, teams, permissions, analytics, API keys, automation, developer APIs, admin console, audit logs. Enterprise plan adds SSO/SAML, custom SLAs, private deployment options.

## Privacy & Terms

Marketing pages at `/privacy` and `/terms` cover how workspace data is handled and terms of use. Tokens are encrypted; org isolation applies.

## Documentation

`/docs` — APIs, connectors, and operator guides. Product surface includes dashboard analytics, approvals, integrations health.

## Contact / About / Demo

- About: We build the operating layer between AI and the tools teams already use.
- Contact / Book Demo CTAs route to contact and auth flows.
- Start Free → `/register`; Login → `/login`; product home → `/app/dashboard`.

## Architecture (high level)

User prompt → Reasoning → Planning → Tool selection → Slack/Notion APIs → Execution → Success, with memory writes and optional approval gates. Observable timeline of steps. Analytics control plane shows live KPIs and activity.
