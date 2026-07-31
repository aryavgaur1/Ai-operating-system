-- ============================================================
-- Migration 004 — Per-individual-user workspaces.
-- Every signup now creates its own organization, so a user's
-- email must be unique across the WHOLE system, not just within
-- one organization (the old unique(organization_id, email) still
-- exists and is harmless, this just adds the stronger guarantee).
-- ============================================================

update users
set email = concat(
  lower(split_part(email, '@', 1)),
  '+',
  substring(id::text from 1 for 8),
  '@',
  lower(split_part(email, '@', 2))
)
where id in (
  select id
  from (
    select id, row_number() over (partition by lower(email) order by created_at, id) as rn
    from users
  ) ranked
  where rn > 1
);

create unique index if not exists idx_users_email_global on users(lower(email));
