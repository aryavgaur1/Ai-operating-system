-- Persist the user's active chat conversation (org-scoped via users.organization_id).
-- Used to resume /app/chat → /app/chat/:id without relying on browser storage.
alter table users
  add column if not exists active_conversation_id uuid references conversations(id) on delete set null;

create index if not exists idx_users_active_conversation
  on users (id, active_conversation_id);
