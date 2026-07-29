# Enterprise AI OS — Code Scaffold

A runnable TypeScript scaffold for the architecture in `Architecture Codex: Enterprise AI Operating System`:
an active intelligence layer across Slack, Jira, Gmail, Salesforce and Notion, combining a hybrid vector +
knowledge-graph context store with an autonomous, human-gated tool execution engine.

**Status: structured, not wired to live APIs.** Every third-party integration, the LLM call, and both data
stores currently run against realistic in-memory mocks so the whole agent loop — ingest → retrieve → plan →
execute/approve — runs end-to-end with zero external infrastructure. Every mock is written behind the same
interface a real implementation would use, with `TODO(live)` comments marking exactly what to replace.

## Monorepo layout

```
apps/
  api/            Express API — auth/RBAC, ingestion pipeline, chat/approvals/integrations routes
  web/             Next.js (App Router) dashboard, chat, approvals inbox, integrations status
packages/
  shared/          Common TypeScript types + the high-consequence-action policy
  stores/          Postgres client, VectorStore interface (+ in-memory), GraphStore interface (+ in-memory)
  connectors/       ToolConnector interface + mocked Slack/Jira/Gmail/Salesforce/Notion connectors
  agent-core/       Intent classifier, hybrid retriever, LLM client, planner, tool execution engine, orchestrator
db/
  schema.sql        Postgres schema: orgs, users, RBAC, OAuth tokens, documents, jobs, approvals, audit log
  migrate.js        Minimal script to apply schema.sql to DATABASE_URL
```

## Request flow

```
User Input → Intent Classifier → Hybrid Retrieval (vector + graph) → LLM Planner → Tool Call
                                                                           │
                                              requiresApproval? ──yes──> Approvals inbox (human decides)
                                                       │no
                                                       ▼
                                              Tool Execution Engine → Connector.execute()
```

See `packages/agent-core/src/orchestrator.ts` for the entry point (`runAgentTurn`), which the API's
`POST /chat` route calls directly.

## Running it locally

```bash
npm install                      # installs all workspaces
cp .env.example .env             # defaults already run everything in mock mode
npm run dev:api                  # starts the API on :4000, seeds demo data + demo connections
npm run dev:web                  # starts the Next.js app on :3000
```

Open `http://localhost:3000/dashboard`. Try asking the agent (on the Chat page):

- *"Why is Project Phoenix delayed?"* — a read query; answered from the seeded Slack/Jira/Notion context and
  the knowledge graph (Person → ASSIGNED_TO → Project → PERTAINS_TO → Client).
- *"Draft an email to the client about the new timeline"* — an action query; `gmail.sendEmail` is high
  consequence, so it lands in **Approvals** instead of running immediately.
- *"Create a Jira ticket to track the vendor contract follow-up"* — `jira.createIssue` is low risk, so it
  executes immediately (mocked) and the result shows in the chat transcript.

## What's real vs. mocked right now

| Piece | Status |
|---|---|
| Express API, routing, RBAC middleware | Real |
| OAuth token encryption (AES-256-GCM) | Real encryption, in-memory storage (swap for `oauth_connections` table) |
| Postgres schema | Real, ready to migrate — but the demo doesn't require a DB to run |
| Intent classification | Rule-based mock — swap for a real LLM call in `intentClassifier.ts` |
| Vector store / embeddings | In-memory + hashed pseudo-embeddings — swap in Pinecone/Qdrant/pgvector + a real embedding model |
| Knowledge graph | In-memory — swap in Neo4j/Memgraph behind the same `GraphStore` interface |
| LLM planner | `MockLLMClient` — swap in the commented `AnthropicLLMClient` sketch in `llmClient.ts` |
| Slack / Jira / Gmail / Salesforce / Notion | All mocked with fixture data — each file has `TODO(live)` markers for the real SDK calls |
| Human-in-the-loop approvals | Real gating logic, in-memory storage (swap for the `approvals` table) |

## Going live, one piece at a time

1. **Pick one connector** (e.g. Slack) and replace the `TODO(live)` blocks in `packages/connectors/src/slack.ts`
   with real `@slack/web-api` calls, using a token from `apps/api/src/auth/oauth.ts`.
2. **Swap the vector store**: implement `VectorStore` (in `packages/stores/src/vectorStore.ts`) against
   Pinecone or Qdrant, and set `VECTOR_DB_PROVIDER` accordingly.
3. **Swap the graph store**: implement `GraphStore` against Neo4j/Memgraph, set `GRAPH_DB_PROVIDER=neo4j`.
4. **Wire a real LLM**: uncomment `AnthropicLLMClient` in `packages/agent-core/src/llmClient.ts`, install
   `@anthropic-ai/sdk` in `apps/api`, set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.
5. **Persist approvals & documents**: swap `InMemoryApprovalStore` for the commented `PostgresApprovalStore`
   sketch, and have the ingestion pipeline write into the `documents` table alongside the vector/graph stores.

Each of these is an isolated swap behind an existing interface — no other package needs to change.

## Notes on the human-in-the-loop policy

`packages/shared/src/index.ts` exports `HIGH_CONSEQUENCE_ACTIONS`, the single source of truth for which
tool actions require approval (sending/deleting email, deleting or updating CRM records, deleting or
transitioning Jira issues, posting to external Slack channels, deleting/publishing Notion pages). Both the
planner and the tool execution engine consult this — add an action here and every part of the system treats
it consistently.
