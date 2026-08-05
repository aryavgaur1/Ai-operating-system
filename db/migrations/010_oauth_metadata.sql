-- Multi-tenant OAuth metadata + dedicated Slack user token column.
-- Additive only — preserves existing encrypted_access_token / refresh rows.

alter table oauth_connections
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table oauth_connections
  add column if not exists encrypted_user_token text;

alter table oauth_connections
  add column if not exists last_used_at timestamptz;

-- Backfill: legacy Slack user tokens lived in encrypted_refresh_token
update oauth_connections
set encrypted_user_token = encrypted_refresh_token
where tool = 'slack'
  and encrypted_user_token is null
  and encrypted_refresh_token is not null
  and encrypted_refresh_token like '%'; -- any non-null

create index if not exists idx_oauth_connections_metadata_team
  on oauth_connections ((metadata->>'teamId'))
  where tool = 'slack' and status = 'active';
