-- ============================================================
-- Migration 014 — P0.5 B1: Personal + Team tenancy foundation
-- ============================================================
-- Additive / idempotent. Does NOT drop or rewrite legacy columns.
-- Preserves: users.organization_id, users.role, users.active_conversation_id
--
-- Adds:
--   organizations.kind (personal | team)
--   organization_memberships
--   organization_invitations (schema only; unused until B4)
--   user_workspace_state
--   users.active_organization_id (nullable; unused by auth until B2)
--
-- Backfill:
--   all existing orgs → kind=personal
--   each user → owner membership on their organization_id
--   active_conversation_id → user_workspace_state for that pair
-- ============================================================

-- ---------- organizations.kind ----------
alter table organizations
  add column if not exists kind text;

-- Default existing + new rows without kind to personal (safe for current 1:1 product).
update organizations
set kind = 'personal'
where kind is null;

alter table organizations
  alter column kind set default 'personal';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_kind_check'
  ) then
    alter table organizations
      add constraint organizations_kind_check
      check (kind in ('personal', 'team'));
  end if;
end $$;

alter table organizations
  alter column kind set not null;

create index if not exists idx_organizations_kind
  on organizations (kind);

-- ---------- users.active_organization_id (legacy org_id retained) ----------
alter table users
  add column if not exists active_organization_id uuid references organizations(id) on delete set null;

update users
set active_organization_id = organization_id
where active_organization_id is null
  and organization_id is not null;

create index if not exists idx_users_active_organization
  on users (active_organization_id);

-- ---------- organization_memberships ----------
create table if not exists organization_memberships (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  role             text not null default 'member',
  status           text not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_memberships_role_check'
  ) then
    alter table organization_memberships
      add constraint organization_memberships_role_check
      check (role in ('owner', 'admin', 'member'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_memberships_status_check'
  ) then
    alter table organization_memberships
      add constraint organization_memberships_status_check
      check (status in ('active', 'inactive', 'removed'));
  end if;
end $$;

create index if not exists idx_org_memberships_user
  on organization_memberships (user_id);

create index if not exists idx_org_memberships_org_status
  on organization_memberships (organization_id, status);

create index if not exists idx_org_memberships_org_role
  on organization_memberships (organization_id, role);

-- Backfill: every existing user is owner of their current organization (personal home).
-- Map legacy users.role conservatively: only owner/admin/member allowed; else owner for home org.
insert into organization_memberships (organization_id, user_id, role, status, created_at, updated_at)
select
  u.organization_id,
  u.id,
  case
    when lower(coalesce(u.role, 'owner')) in ('owner', 'admin', 'member') then lower(u.role)
    when lower(coalesce(u.role, '')) in ('super_admin') then 'owner'
    else 'owner'
  end,
  'active',
  coalesce(u.created_at, now()),
  now()
from users u
where u.organization_id is not null
on conflict (organization_id, user_id) do nothing;

-- ---------- organization_invitations (schema only; B4 will use) ----------
create table if not exists organization_invitations (
  id                   uuid primary key default uuid_generate_v4(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  email                text not null,
  role                 text not null default 'member',
  token_hash           text not null,
  invited_by_user_id   uuid not null references users(id) on delete cascade,
  status               text not null default 'pending',
  expires_at           timestamptz not null,
  accepted_at          timestamptz,
  accepted_by_user_id  uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (token_hash)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_invitations_role_check'
  ) then
    alter table organization_invitations
      add constraint organization_invitations_role_check
      check (role in ('owner', 'admin', 'member'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_invitations_status_check'
  ) then
    alter table organization_invitations
      add constraint organization_invitations_status_check
      check (status in ('pending', 'accepted', 'revoked', 'expired'));
  end if;
end $$;

create index if not exists idx_org_invitations_org_status
  on organization_invitations (organization_id, status);

create index if not exists idx_org_invitations_email_status
  on organization_invitations (lower(email), status);

-- ---------- user_workspace_state (per-user, per-org active conversation) ----------
create table if not exists user_workspace_state (
  user_id                 uuid not null references users(id) on delete cascade,
  organization_id         uuid not null references organizations(id) on delete cascade,
  active_conversation_id  uuid references conversations(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create index if not exists idx_user_workspace_state_org
  on user_workspace_state (organization_id);

create index if not exists idx_user_workspace_state_conversation
  on user_workspace_state (active_conversation_id)
  where active_conversation_id is not null;

-- Backfill continuity pointer into per-workspace state (home org only).
-- Only copy when conversation still belongs to that user+org (or is null).
insert into user_workspace_state (user_id, organization_id, active_conversation_id, created_at, updated_at)
select
  u.id,
  u.organization_id,
  case
    when u.active_conversation_id is null then null
    when exists (
      select 1 from conversations c
      where c.id = u.active_conversation_id
        and c.organization_id = u.organization_id
        and c.user_id = u.id
    ) then u.active_conversation_id
    else null
  end,
  now(),
  now()
from users u
where u.organization_id is not null
on conflict (user_id, organization_id) do update
set
  active_conversation_id = coalesce(
    user_workspace_state.active_conversation_id,
    excluded.active_conversation_id
  ),
  updated_at = now();
