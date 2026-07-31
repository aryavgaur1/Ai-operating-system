-- ============================================================
-- Migration 007 — SaaS auth: tokens, profiles, login history
-- ============================================================

alter table users add column if not exists password_hash text;
alter table users add column if not exists last_login timestamptz;
alter table users add column if not exists is_verified boolean not null default false;
alter table users add column if not exists is_suspended boolean not null default false;
alter table users add column if not exists auth_provider text not null default 'email';
alter table users add column if not exists google_sub text;

create table if not exists user_profiles (
  user_id         uuid primary key references users(id) on delete cascade,
  avatar_url      text,
  timezone        text not null default 'UTC',
  language        text not null default 'en',
  preferences     jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

create table if not exists refresh_tokens (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references users(id) on delete cascade,
  token_hash      text not null unique,
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  user_agent      text,
  ip              text
);
create index if not exists idx_refresh_tokens_user on refresh_tokens(user_id);

create table if not exists email_verification_tokens (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references users(id) on delete cascade,
  token_hash      text not null unique,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists password_reset_tokens (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references users(id) on delete cascade,
  token_hash      text not null unique,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists login_history (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  ip              text,
  user_agent      text,
  device          text,
  browser         text,
  location        text,
  success         boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_login_history_user on login_history(user_id, created_at desc);

alter table conversations add column if not exists pinned boolean not null default false;
alter table conversations add column if not exists updated_at timestamptz not null default now();
