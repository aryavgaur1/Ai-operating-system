-- Migration 015: workspace management enhancements
-- Adds description and updated_at to organizations for rename/settings UI.

alter table organizations
  add column if not exists description text,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill updated_at for existing rows
update organizations set updated_at = now() where updated_at is null;
