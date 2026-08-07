-- Enterprise AI OS — workflow runs + agent memory
create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  user_id uuid,
  query text not null,
  intent_kind text,
  intent jsonb not null default '{}'::jsonb,
  reasoning jsonb not null default '[]'::jsonb,
  plan_steps jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  retries int not null default 0,
  duration_ms int,
  success boolean not null default false,
  reply_preview text,
  created_at timestamptz not null default now()
);

create index if not exists workflow_runs_org_created_idx
  on workflow_runs (organization_id, created_at desc);

create table if not exists agent_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid,
  memory_key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (organization_id, memory_key)
);

create index if not exists agent_memory_org_key_idx
  on agent_memory (organization_id, memory_key);
