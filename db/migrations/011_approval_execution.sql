-- Persist approval execution lifecycle + result (additive; safe to re-run).
alter table approvals add column if not exists execution_status text;
alter table approvals add column if not exists execution_result jsonb;
alter table approvals add column if not exists execution_verified boolean not null default false;
alter table approvals add column if not exists executed_at timestamptz;

create index if not exists idx_approvals_execution_status
  on approvals(organization_id, execution_status);
