-- ============================================================
-- Enterprise AI OS — Core Relational Schema (PostgreSQL)
-- Phase 1: Data Layer & Basic Integration
-- ============================================================
-- This schema covers organizational state, auth, RBAC, audit,
-- job queues, human-in-the-loop approvals, and metadata for
-- documents whose embeddings live in the vector DB and whose
-- relationships live in the graph DB. Vector/graph stores are
-- NOT relational — this is the "system of record" layer only.

create extension if not exists "uuid-ossp";

-- ---------- Organizations & Users ----------

create table if not exists organizations (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  slug          text unique not null,
  created_at    timestamptz not null default now()
);

create table if not exists users (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email           text not null,
  display_name    text,
  role            text not null default 'member', -- 'owner' | 'admin' | 'member'
  created_at      timestamptz not null default now(),
  unique (organization_id, email)
);

-- ---------- RBAC: per-user, per-tool scoped permissions ----------
-- Mirrors what a user is *actually* permitted to see/do in the
-- native tool (Slack channel membership, Jira project role, etc.)
-- so the agent never surfaces or acts on data the user couldn't
-- already reach themselves.

create table if not exists tool_permissions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references users(id) on delete cascade,
  tool            text not null,           -- 'slack' | 'jira' | 'gmail' | 'salesforce' | 'notion'
  resource_type   text not null,           -- 'channel' | 'project' | 'mailbox' | 'object' | 'page'
  resource_id     text not null,           -- native ID in the third-party tool
  access_level    text not null default 'read', -- 'read' | 'write' | 'admin'
  synced_at       timestamptz not null default now()
);
create index if not exists idx_tool_permissions_user on tool_permissions(user_id, tool);

-- ---------- OAuth / Access Token Manager ----------

create table if not exists oauth_connections (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid references users(id) on delete cascade,
  tool            text not null,           -- 'slack' | 'jira' | 'gmail' | 'salesforce' | 'notion'
  scope           text,
  -- Tokens are encrypted at rest by the application layer (see
  -- apps/api/src/auth/oauth.ts) using an envelope-encryption key
  -- from the secrets manager. Never store plaintext tokens.
  encrypted_access_token  text not null,
  encrypted_refresh_token text,
  expires_at              timestamptz,
  status                  text not null default 'active', -- 'active' | 'revoked' | 'error'
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (organization_id, user_id, tool)
);

-- ---------- Ingestion state (webhooks + batch polling cursors) ----------

create table if not exists ingestion_state (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tool            text not null,
  cursor          text,                 -- opaque pagination/sync cursor for batch polling
  last_synced_at  timestamptz,
  status          text not null default 'idle', -- 'idle' | 'syncing' | 'error'
  last_error      text,
  unique (organization_id, tool)
);

-- ---------- Document metadata (embeddings live in the vector DB) ----------

create table if not exists documents (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tool            text not null,           -- source system
  external_id     text not null,           -- native ID (message ts, issue key, etc.)
  resource_type   text not null,           -- 'message' | 'issue' | 'email' | 'record' | 'page'
  title           text,
  url             text,                    -- deep link back into the native tool
  vector_id       text,                    -- ID of the corresponding vector in Pinecone/Qdrant
  graph_node_id   text,                    -- ID of the corresponding node in Neo4j/Memgraph
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, tool, external_id)
);
create index if not exists idx_documents_org_tool on documents(organization_id, tool);

-- ---------- Conversation / agent sessions ----------

create table if not exists conversations (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  title           text,
  created_at      timestamptz not null default now()
);

create table if not exists messages (
  id              uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null,           -- 'user' | 'assistant' | 'system' | 'tool'
  content         text not null,
  tool_calls      jsonb,                   -- planned/executed tool calls for this turn
  created_at      timestamptz not null default now()
);
create index if not exists idx_messages_conversation on messages(conversation_id);

-- ---------- Job queue (mirrors Redis/BullMQ jobs for durability/audit) ----------

create table if not exists jobs (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type            text not null,           -- 'ingestion' | 'tool_execution' | 'reindex'
  status          text not null default 'queued', -- 'queued' | 'running' | 'succeeded' | 'failed'
  payload         jsonb not null default '{}'::jsonb,
  result          jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
create index if not exists idx_jobs_org_status on jobs(organization_id, status);

-- ---------- Human-in-the-loop approvals for high-consequence actions ----------

create table if not exists approvals (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  requested_by_user_id uuid references users(id),
  conversation_id uuid references conversations(id),
  tool            text not null,
  action          text not null,           -- e.g. 'gmail.sendEmail', 'salesforce.deleteRecord'
  risk_level      text not null,           -- 'low' | 'medium' | 'high'
  input           jsonb not null,          -- the exact tool-call arguments awaiting approval
  status          text not null default 'pending', -- 'pending' | 'approved' | 'rejected' | 'expired'
  decided_by_user_id uuid references users(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_approvals_org_status on approvals(organization_id, status);

-- ---------- Audit log (immutable trail of every read/action the agent performs) ----------

create table if not exists audit_logs (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid references users(id),
  event_type      text not null,           -- 'query' | 'tool_call' | 'approval_decision' | 'auth'
  tool            text,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_audit_logs_org_time on audit_logs(organization_id, created_at desc);

-- ---------- Vector store (pgvector) — real semantic search ----------
-- Requires the pgvector extension. The docker-compose Postgres image
-- (pgvector/pgvector:pg16) ships it already; a managed Postgres (RDS,
-- Supabase, Neon) needs it enabled once per database.
-- Dimension 1536 matches OpenAI's text-embedding-3-small — change both
-- here and in packages/agent-core/src/embeddings.ts together if you
-- switch embedding models.

create extension if not exists vector;

create table if not exists document_embeddings (
  id              text primary key,        -- "<tool>:<externalId>", matches VectorRecord.id
  text            text not null,
  embedding       vector(1536) not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- IVFFlat approximate-nearest-neighbor index for cosine distance (<=>).
-- `lists` is a rough starting point — for real workloads, size it near
-- sqrt(row_count) and re-ANALYZE after large ingests.
create index if not exists idx_document_embeddings_cosine
  on document_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ---------- Slack live integration ----------

create table if not exists slack_installations (
  id              uuid primary key default uuid_generate_v4(),
  organization_id text not null,
  team_id         text,
  team_name       text,
  bot_user_id     text,
  app_id          text,
  scopes          text,
  status          text not null default 'active',
  installed_at    timestamptz not null default now(),
  last_synced_at  timestamptz,
  metadata        jsonb not null default '{}'::jsonb
);
create unique index if not exists idx_slack_installations_org_team
  on slack_installations (organization_id, team_id);

create table if not exists slack_events (
  id              uuid primary key default uuid_generate_v4(),
  organization_id text,
  event_id        text,
  event_type      text not null,
  team_id         text,
  channel_id      text,
  user_id         text,
  payload         jsonb not null default '{}'::jsonb,
  received_at     timestamptz not null default now()
);
create index if not exists idx_slack_events_received on slack_events(received_at desc);
create index if not exists idx_slack_events_type on slack_events(event_type);

create table if not exists slack_action_logs (
  id                uuid primary key default uuid_generate_v4(),
  organization_id   text,
  user_id           text,
  workspace         text,
  action            text not null,
  payload           jsonb not null default '{}'::jsonb,
  status            text not null,
  error             text,
  execution_time_ms integer,
  created_at        timestamptz not null default now()
);
create index if not exists idx_slack_action_logs_created on slack_action_logs(created_at desc);
create index if not exists idx_slack_action_logs_action on slack_action_logs(action);
