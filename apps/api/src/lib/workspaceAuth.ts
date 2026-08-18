/**
 * P0.5 B2 — Server-authoritative organization membership.
 *
 * Frontend org IDs (URL/body/query/storage) are NEVER trusted as proof of access.
 * Access tokens may carry org; that claim is only accepted when an active
 * organization_memberships row exists for (user, org).
 */
import { query } from '@enterprise-ai-os/stores';

export type MembershipRole = 'owner' | 'admin' | 'member';
export type MembershipStatus = 'active' | 'inactive' | 'removed';

export interface OrganizationMembership {
  organizationId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
}

export type MembershipAuthError =
  | 'organization_not_found'
  | 'membership_not_found'
  | 'membership_inactive'
  | 'membership_removed'
  | 'membership_required';

export class MembershipAuthorizationError extends Error {
  readonly code: MembershipAuthError;
  constructor(code: MembershipAuthError, message: string) {
    super(message);
    this.code = code;
    this.name = 'MembershipAuthorizationError';
  }
}

const ROLE_SET = new Set<MembershipRole>(['owner', 'admin', 'member']);

function asMembershipRole(raw: string | null | undefined): MembershipRole | null {
  const v = String(raw || '').toLowerCase();
  return ROLE_SET.has(v as MembershipRole) ? (v as MembershipRole) : null;
}

/** Ensure personal home org membership + workspace state exist (signup / repair). */
export async function ensurePersonalMembership(opts: {
  userId: string;
  organizationId: string;
  role?: MembershipRole;
}): Promise<void> {
  const role = opts.role ?? 'owner';
  await query(
    `insert into organization_memberships (organization_id, user_id, role, status)
     values ($1, $2, $3, 'active')
     on conflict (organization_id, user_id) do nothing`,
    [opts.organizationId, opts.userId, role]
  );
  await query(
    `update users set active_organization_id = coalesce(active_organization_id, $1)
     where id = $2`,
    [opts.organizationId, opts.userId]
  );
  await query(
    `insert into user_workspace_state (user_id, organization_id, active_conversation_id)
     values ($1, $2, null)
     on conflict (user_id, organization_id) do nothing`,
    [opts.userId, opts.organizationId]
  );
  // Mark org personal if kind column exists and is null/unset path — default handles new rows.
  await query(
    `update organizations set kind = coalesce(kind, 'personal') where id = $1`,
    [opts.organizationId]
  ).catch(() => undefined);
}

export async function getMembership(
  userId: string,
  organizationId: string
): Promise<OrganizationMembership | null> {
  const { rows } = await query<{
    organization_id: string;
    user_id: string;
    role: string;
    status: string;
  }>(
    `select organization_id, user_id, role, status
     from organization_memberships
     where user_id = $1 and organization_id = $2`,
    [userId, organizationId]
  );
  const row = rows[0];
  if (!row) return null;
  const role = asMembershipRole(row.role);
  if (!role) return null;
  const status = row.status as MembershipStatus;
  if (status !== 'active' && status !== 'inactive' && status !== 'removed') return null;
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    role,
    status,
  };
}

export async function assertActiveMembership(
  userId: string,
  organizationId: string
): Promise<OrganizationMembership> {
  const org = await query(`select id from organizations where id = $1`, [organizationId]);
  if (!org.rows[0]) {
    throw new MembershipAuthorizationError('organization_not_found', 'Organization not found.');
  }
  const membership = await getMembership(userId, organizationId);
  if (!membership) {
    throw new MembershipAuthorizationError(
      'membership_not_found',
      'You are not a member of this organization.'
    );
  }
  if (membership.status === 'inactive') {
    throw new MembershipAuthorizationError(
      'membership_inactive',
      'Your membership in this organization is inactive.'
    );
  }
  if (membership.status === 'removed') {
    throw new MembershipAuthorizationError(
      'membership_removed',
      'Your membership in this organization was removed.'
    );
  }
  if (membership.status !== 'active') {
    throw new MembershipAuthorizationError(
      'membership_required',
      'Active membership required.'
    );
  }
  return membership;
}

/**
 * Resolve the organization this request is authorized for.
 *
 * Priority:
 * 1. JWT `org` claim when present — must have active membership (fail closed otherwise)
 * 2. users.active_organization_id when set — must have active membership
 * 3. users.organization_id (personal home) — must have active membership
 *
 * Never accepts org IDs from request body/query/headers other than the signed JWT.
 */
export async function resolveAuthorizedOrganization(opts: {
  userId: string;
  homeOrganizationId: string;
  activeOrganizationId?: string | null;
  jwtOrganizationId?: string | null;
}): Promise<{ organizationId: string; membership: OrganizationMembership }> {
  const jwtOrg = opts.jwtOrganizationId?.trim() || null;
  const activeOrg = opts.activeOrganizationId?.trim() || null;
  const homeOrg = opts.homeOrganizationId?.trim();
  if (!homeOrg) {
    throw new MembershipAuthorizationError('membership_required', 'Home organization missing.');
  }

  const candidate = jwtOrg || activeOrg || homeOrg;
  const membership = await assertActiveMembership(opts.userId, candidate);
  return { organizationId: membership.organizationId, membership };
}

export function membershipAllowsRole(
  membershipRole: MembershipRole,
  allowed: MembershipRole[]
): boolean {
  return allowed.includes(membershipRole);
}
