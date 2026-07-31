-- ============================================================
-- Migration 003 — Track last login time (used by the dashboard
-- and admin panel to show "Last Login").
-- ============================================================

alter table users add column if not exists last_login timestamptz;
