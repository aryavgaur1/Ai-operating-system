-- ============================================================
-- Migration 005 — Profile and admin management fields
-- Adds explicit verification and suspension state for user-facing
-- dashboards and admin controls.
-- ============================================================

alter table users add column if not exists is_verified boolean not null default true;
alter table users add column if not exists is_suspended boolean not null default false;
