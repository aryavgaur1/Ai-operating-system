-- ============================================================
-- Migration 008 — SaaS look up inde xes + org isolation help ers
-- ============================================================

create index if not exists idx_oauth_connections_org_user_tool
  on oauth_connections (organization_id, user_id, tool);

create index if not exists idx_oauth_connections_status
  on oauth_connections (organization_id, status);

create index if not exists idx_conversations_org_user_updated
  on conversations (organization_id, user_id, updated_at desc);

create index if not exists idx_messages_conversation_created
  on messages (conversation_id, created_at);

create index if not exists idx_approvals_org_status
  on approvals (organization_id, status, created_at desc);

create index if not exists idx_approvals_requested_by
  on approvals (requested_by_user_id, created_at desc);

create index if not exists idx_audit_logs_org_created
  on audit_logs (organization_id, created_at desc);

create index if not exists idx_users_email_lower
  on users (lower(email));
