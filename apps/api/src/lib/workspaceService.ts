/**
 * P0.5 B3 — Workspace discovery / team creation / active selection.
 * Uses B2 membership authorization. Does not touch chat continuity.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '@enterprise-ai-os/stores';
import { AppError } from './errors';
import { slugify } from './authTokens';
import {
  assertActiveMembership,
  MembershipAuthorizationError,
  type MembershipRole,
  type MembershipStatus,
} from './workspaceAuth';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(id: string, label = 'organizationId'): string {
  const v = String(id || '').trim();
  if (!UUID_RE.test(v)) throw new AppError(`Invalid ${label}`, 422);
  return v;
}

export interface WorkspaceListItem {
  id: string;
  name: string;
  slug: string;
  kind: 'personal' | 'team';
  role: MembershipRole;
  status: MembershipStatus;
  isPersonalHome: boolean;
  isActive: boolean;
}

export interface WorkspaceContext {
  organizationId: string;
  name: string;
  slug: string;
  kind: 'personal' | 'team';
  role: MembershipRole;
  status: MembershipStatus;
  isPersonalHome: boolean;
}

async function loadUserHome(userId: string): Promise<{
  homeOrganizationId: string;
  activeOrganizationId: string | null;
}> {
  const { rows } = await query<{
    organization_id: string;
    active_organization_id: string | null;
  }>(`select organization_id, active_organization_id from users where id = $1`, [userId]);
  if (!rows[0]?.organization_id) throw new AppError('User not found', 404);
  return {
    homeOrganizationId: rows[0].organization_id,
    activeOrganizationId: rows[0].active_organization_id,
  };
}

/**
 * Resolve the user's active workspace with membership validation.
 * If active_organization_id is stale (no active membership), fall back to
 * personal home (explicit server rule) and repair the pointer.
 */
export async function resolveWorkspaceContext(userId: string): Promise<WorkspaceContext> {
  const { homeOrganizationId, activeOrganizationId } = await loadUserHome(userId);
  const candidate = activeOrganizationId || homeOrganizationId;

  let membership;
  let organizationId = candidate;
  try {
    membership = await assertActiveMembership(userId, candidate);
  } catch (err) {
    if (!(err instanceof MembershipAuthorizationError)) throw err;
    // Explicit fail-closed fallback to permanent personal home only.
    membership = await assertActiveMembership(userId, homeOrganizationId);
    organizationId = homeOrganizationId;
    if (activeOrganizationId && activeOrganizationId !== homeOrganizationId) {
      await query(`update users set active_organization_id = $1 where id = $2`, [
        homeOrganizationId,
        userId,
      ]);
    }
  }

  const org = await query<{ id: string; name: string; slug: string; kind: string }>(
    `select id, name, slug, kind from organizations where id = $1`,
    [organizationId]
  );
  if (!org.rows[0]) throw new AppError('Organization not found', 404);
  const kind = org.rows[0].kind === 'team' ? 'team' : 'personal';

  return {
    organizationId: org.rows[0].id,
    name: org.rows[0].name,
    slug: org.rows[0].slug,
    kind,
    role: membership.role,
    status: membership.status,
    isPersonalHome: org.rows[0].id === homeOrganizationId,
  };
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceListItem[]> {
  const { homeOrganizationId } = await loadUserHome(userId);
  // Ensure context is valid (repairs stale active if needed).
  const ctx = await resolveWorkspaceContext(userId);
  const activeId = ctx.organizationId;

  const { rows } = await query<{
    id: string;
    name: string;
    slug: string;
    kind: string;
    role: string;
    status: string;
  }>(
    `select o.id, o.name, o.slug, o.kind, m.role, m.status
     from organization_memberships m
     join organizations o on o.id = m.organization_id
     where m.user_id = $1 and m.status = 'active'
     order by case when o.id = $2 then 0 else 1 end, o.kind asc, o.name asc`,
    [userId, homeOrganizationId]
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    kind: (r.kind === 'team' ? 'team' : 'personal') as 'personal' | 'team',
    role: r.role as MembershipRole,
    status: r.status as MembershipStatus,
    isPersonalHome: r.id === homeOrganizationId,
    isActive: r.id === activeId,
  }));
}

export async function createTeamWorkspace(opts: {
  userId: string;
  name: string;
}): Promise<WorkspaceListItem> {
  const name = String(opts.name || '').trim();
  if (name.length < 2) throw new AppError('Workspace name must be at least 2 characters', 422);
  if (name.length > 80) throw new AppError('Workspace name must be at most 80 characters', 422);

  const { homeOrganizationId } = await loadUserHome(opts.userId);
  // Confirm personal membership still intact before creating team.
  await assertActiveMembership(opts.userId, homeOrganizationId);

  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;

  const created = await withTransaction(async (client: PoolClient) => {
    const org = await client.query<{ id: string; name: string; slug: string; kind: string }>(
      `insert into organizations (name, slug, kind)
       values ($1, $2, 'team')
       returning id, name, slug, kind`,
      [name, slug]
    );
    const organizationId = org.rows[0].id;

    await client.query(
      `insert into organization_memberships (organization_id, user_id, role, status)
       values ($1, $2, 'owner', 'active')`,
      [organizationId, opts.userId]
    );

    await client.query(
      `insert into user_workspace_state (user_id, organization_id, active_conversation_id)
       values ($1, $2, null)
       on conflict (user_id, organization_id) do nothing`,
      [opts.userId, organizationId]
    );

    // Hard guarantee: never mutate personal home pointer inside this transaction.
    const home = await client.query<{ organization_id: string }>(
      `select organization_id from users where id = $1 for update`,
      [opts.userId]
    );
    if (home.rows[0]?.organization_id !== homeOrganizationId) {
      throw new AppError('Personal organization changed unexpectedly — aborted', 500);
    }

    return org.rows[0];
  });

  // Post-condition: personal org unchanged
  const check = await query<{ organization_id: string }>(
    `select organization_id from users where id = $1`,
    [opts.userId]
  );
  if (check.rows[0]?.organization_id !== homeOrganizationId) {
    throw new AppError('Personal organization was altered — aborted', 500);
  }

  return {
    id: created.id,
    name: created.name,
    slug: created.slug,
    kind: 'team',
    role: 'owner',
    status: 'active',
    isPersonalHome: false,
    isActive: false,
  };
}

/**
 * Select active organization after membership check.
 * Does NOT create/modify conversations, messages, approvals, or integrations.
 * Returns the authorized context; caller should re-issue JWT with this org.
 */
export async function selectActiveWorkspace(opts: {
  userId: string;
  organizationId: string;
}): Promise<WorkspaceContext> {
  const organizationId = assertUuid(opts.organizationId);
  const membership = await assertActiveMembership(opts.userId, organizationId);
  const { homeOrganizationId } = await loadUserHome(opts.userId);

  await query(`update users set active_organization_id = $1 where id = $2`, [
    organizationId,
    opts.userId,
  ]);

  // Ensure per-workspace state row exists; do not invent a conversation.
  await query(
    `insert into user_workspace_state (user_id, organization_id, active_conversation_id)
     values ($1, $2, null)
     on conflict (user_id, organization_id) do nothing`,
    [opts.userId, organizationId]
  );

  const org = await query<{ id: string; name: string; slug: string; kind: string }>(
    `select id, name, slug, kind from organizations where id = $1`,
    [organizationId]
  );
  if (!org.rows[0]) throw new AppError('Organization not found', 404);

  return {
    organizationId: org.rows[0].id,
    name: org.rows[0].name,
    slug: org.rows[0].slug,
    kind: org.rows[0].kind === 'team' ? 'team' : 'personal',
    role: membership.role,
    status: membership.status,
    isPersonalHome: org.rows[0].id === homeOrganizationId,
  };
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: string;
}

/**
 * List active members of an organization the caller belongs to.
 * Required for Team settings UI — reads organization_memberships (no fake data).
 */
export async function listWorkspaceMembers(opts: {
  actorUserId: string;
  organizationId: string;
}): Promise<WorkspaceMember[]> {
  const organizationId = assertUuid(opts.organizationId);
  await assertActiveMembership(opts.actorUserId, organizationId);

  const { rows } = await query<{
    user_id: string;
    email: string;
    display_name: string | null;
    role: string;
    status: string;
    created_at: Date | string;
  }>(
    `select m.user_id, u.email, u.display_name, m.role, m.status, m.created_at
     from organization_memberships m
     join users u on u.id = m.user_id
     where m.organization_id = $1 and m.status = 'active'
     order by
       case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
       lower(coalesce(u.display_name, u.email))`,
    [organizationId]
  );

  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    role: r.role as MembershipRole,
    status: r.status as MembershipStatus,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * Rename a TEAM workspace. Only owner (or admin, per policy) may rename.
 * Personal home workspace cannot be renamed through this path.
 */
export async function renameWorkspace(opts: {
  actorUserId: string;
  organizationId: string;
  name: string;
}): Promise<{ id: string; name: string; slug: string; kind: string }> {
  const organizationId = assertUuid(opts.organizationId);
  const name = String(opts.name || '').trim();
  if (name.length < 2) throw new AppError('Workspace name must be at least 2 characters', 422);
  if (name.length > 80) throw new AppError('Workspace name must be at most 80 characters', 422);

  const membership = await assertActiveMembership(opts.actorUserId, organizationId);
  if (!['owner', 'admin'].includes(membership.role)) {
    throw new AppError('Only owners and admins can rename this workspace', 403);
  }

  // Block renaming personal home org via this path
  const { homeOrganizationId } = await loadUserHome(opts.actorUserId);
  if (organizationId === homeOrganizationId) {
    throw new AppError('Personal workspace cannot be renamed here', 403);
  }

  const { rows } = await query<{ id: string; name: string; slug: string; kind: string }>(
    `update organizations set name = $1 where id = $2 and kind = 'team'
     returning id, name, slug, kind`,
    [name, organizationId]
  );
  if (!rows[0]) throw new AppError('Workspace not found or not a team workspace', 404);
  return rows[0];
}

/**
 * Update a member's role. Only owner can change roles.
 * Cannot change own role. Cannot demote the last owner.
 */
export async function updateMemberRole(opts: {
  actorUserId: string;
  organizationId: string;
  targetUserId: string;
  role: string;
}): Promise<{ userId: string; role: string }> {
  const organizationId = assertUuid(opts.organizationId);
  const targetUserId = assertUuid(opts.targetUserId, 'userId');
  const allowedRoles = ['owner', 'admin', 'member'];
  const newRole = String(opts.role || '').toLowerCase();
  if (!allowedRoles.includes(newRole)) throw new AppError('Invalid role', 422);

  const actor = await assertActiveMembership(opts.actorUserId, organizationId);
  if (actor.role !== 'owner') throw new AppError('Only owners can change member roles', 403);
  if (opts.actorUserId === targetUserId) throw new AppError('Cannot change your own role', 422);

  // Verify target is a member
  const target = await assertActiveMembership(targetUserId, organizationId);

  // If demoting an owner, ensure at least one owner remains
  if (target.role === 'owner' && newRole !== 'owner') {
    const { rows } = await query<{ cnt: string }>(
      `select count(*) as cnt from organization_memberships
       where organization_id = $1 and role = 'owner' and status = 'active'`,
      [organizationId]
    );
    if (parseInt(rows[0]?.cnt ?? '0') <= 1) {
      throw new AppError('Cannot demote the last owner', 422);
    }
  }

  await query(
    `update organization_memberships set role = $1, updated_at = now()
     where organization_id = $2 and user_id = $3 and status = 'active'`,
    [newRole, organizationId, targetUserId]
  );
  return { userId: targetUserId, role: newRole };
}

/**
 * Remove a member from a workspace. Only owner/admin can remove.
 * Cannot remove yourself. Cannot remove the last owner.
 */
export async function removeMember(opts: {
  actorUserId: string;
  organizationId: string;
  targetUserId: string;
}): Promise<void> {
  const organizationId = assertUuid(opts.organizationId);
  const targetUserId = assertUuid(opts.targetUserId, 'userId');

  const actor = await assertActiveMembership(opts.actorUserId, organizationId);
  if (!['owner', 'admin'].includes(actor.role)) {
    throw new AppError('Only owners and admins can remove members', 403);
  }
  if (opts.actorUserId === targetUserId) throw new AppError('Cannot remove yourself', 422);

  const target = await assertActiveMembership(targetUserId, organizationId);

  // Block removing an owner unless another owner exists
  if (target.role === 'owner') {
    const { rows } = await query<{ cnt: string }>(
      `select count(*) as cnt from organization_memberships
       where organization_id = $1 and role = 'owner' and status = 'active'`,
      [organizationId]
    );
    if (parseInt(rows[0]?.cnt ?? '0') <= 1) {
      throw new AppError('Cannot remove the last owner', 422);
    }
  }

  // Admin cannot remove another admin or owner
  if (actor.role === 'admin' && ['owner', 'admin'].includes(target.role)) {
    throw new AppError('Admins can only remove members', 403);
  }

  await query(
    `update organization_memberships set status = 'removed', updated_at = now()
     where organization_id = $1 and user_id = $2`,
    [organizationId, targetUserId]
  );

  // Reset active workspace if the removed user had this as active
  await query(
    `update users set active_organization_id = organization_id
     where id = $1 and active_organization_id = $2`,
    [targetUserId, organizationId]
  );
}

export function membershipErrorToAppError(err: unknown): never {
  if (err instanceof MembershipAuthorizationError) {
    const status =
      err.code === 'organization_not_found' ? 404 : err.code === 'membership_not_found' ? 403 : 403;
    throw new AppError(err.message, status);
  }
  throw err;
}
