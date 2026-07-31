-- ============================================================
-- Migration 002 — Real email/password authentication
-- Adds a password hash column to users, and relaxes the
-- oauth_connections unique constraint handling for per-user
-- connections (already supported by the base schema).
-- ============================================================

alter table users add column if not exists password_hash text;

-- Every signup creates (or joins) an organization by a slug the
-- user picks, e.g. their company name — this lets multiple people
-- from the same company share one workspace of connected tools.
create unique index if not exists idx_organizations_slug on organizations(slug);
