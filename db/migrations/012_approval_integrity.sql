-- P0.3 approval integrity: immutable action fingerprint + expiration
alter table approvals add column if not exists payload_fingerprint text;
alter table approvals add column if not exists expires_at timestamptz;

create index if not exists idx_approvals_expires_at
  on approvals (status, expires_at)
  where status = 'pending';
