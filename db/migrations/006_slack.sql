-- Slack live integration tables (Postgres).
-- organization_id is text so demo orgs (e.g. "org-demo") work without UUID FK.

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
