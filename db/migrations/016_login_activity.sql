-- Migration 016 — Login activity metadata for platform security visibility
alter table login_history add column if not exists authentication_method text;

create index if not exists idx_login_history_created
  on login_history (created_at desc);

create index if not exists idx_login_history_success_created
  on login_history (success, created_at desc)
  where success = true;
