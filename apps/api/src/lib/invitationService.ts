/**
 * P0.5 B4 — Team invitation lifecycle (backend only).
 * Reuses organization_invitations from B1. No seat limits (B5).
 */
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '@enterprise-ai-os/stores';
import { AppError } from './errors';
import { hashToken, randomToken } from './authTokens';
import { mailer, type EmailDeliveryResult } from './mailer';
import {
  assertActiveMembership,
  membershipAllowsRole,
  MembershipAuthorizationError,
  type MembershipRole,
} from './workspaceAuth';
import { assertUuid, membershipErrorToAppError } from './workspaceService';

const INVITE_ROLES = new Set<MembershipRole>(['member', 'admin']);
/** Explicit invitation TTL (server clock is authority). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InvitationPublic {
  id: string;
  organizationId: string;
  email: string;
  role: MembershipRole;
  status: InvitationStatus;
  expiresAt: string;
  invitedByUserId: string;
  invitedByEmail?: string | null;
  invitedByDisplayName?: string | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdAt: string;
}

export interface InvitationCreateResult {
  invitation: InvitationPublic;
  rawToken: string;
  email: EmailDeliveryResult;
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function serializeInvitation(row: {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: Date | string;
  invited_by_user_id: string;
  accepted_at: Date | string | null;
  accepted_by_user_id: string | null;
  created_at: Date | string;
  invited_by_email?: string | null;
  invited_by_display_name?: string | null;
}): InvitationPublic {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role as MembershipRole,
    status: row.status as InvitationStatus,
    expiresAt: new Date(row.expires_at).toISOString(),
    invitedByUserId: row.invited_by_user_id,
    invitedByEmail: row.invited_by_email ?? null,
    invitedByDisplayName: row.invited_by_display_name ?? null,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
    acceptedByUserId: row.accepted_by_user_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function requireInviteAdmin(userId: string, organizationId: string) {
  const membership = await assertActiveMembership(userId, organizationId);
  if (!membershipAllowsRole(membership.role, ['owner', 'admin'])) {
    throw new AppError('Only owners and admins can manage invitations.', 403);
  }
  return membership;
}

async function loadTeamOrganization(organizationId: string): Promise<{
  id: string;
  name: string;
  kind: string;
}> {
  const { rows } = await query<{ id: string; name: string; kind: string }>(
    `select id, name, kind from organizations where id = $1`,
    [organizationId]
  );
  if (!rows[0]) throw new AppError('Organization not found', 404);
  if (rows[0].kind !== 'team') {
    throw new AppError('Invitations are only allowed for team workspaces.', 403);
  }
  return rows[0];
}

async function dbQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  client: PoolClient | undefined,
  text: string,
  params: unknown[]
) {
  if (client) return client.query<T>(text, params);
  return query<T>(text, params);
}

async function findActiveMemberByEmail(
  organizationId: string,
  email: string,
  client?: PoolClient
): Promise<{ userId: string } | null> {
  const { rows } = await dbQuery<{ user_id: string }>(
    client,
    `select m.user_id
     from organization_memberships m
     join users u on u.id = m.user_id
     where m.organization_id = $1
       and m.status = 'active'
       and lower(u.email) = $2
     limit 1`,
    [organizationId, email]
  );
  return rows[0] ? { userId: rows[0].user_id } : null;
}

async function findPendingInvitation(
  organizationId: string,
  email: string,
  client?: PoolClient
): Promise<{ id: string } | null> {
  const { rows } = await dbQuery<{ id: string }>(
    client,
    `select id from organization_invitations
     where organization_id = $1
       and lower(email) = $2
       and status = 'pending'
       and expires_at > now()
     order by created_at desc
     limit 1`,
    [organizationId, email]
  );
  return rows[0] ?? null;
}

function parseInviteRole(raw: unknown): MembershipRole {
  const role = String(raw || 'member').trim().toLowerCase() as MembershipRole;
  if (role === 'owner') {
    throw new AppError('Owner role cannot be assigned through invitation.', 422);
  }
  if (!INVITE_ROLES.has(role)) {
    throw new AppError('Invitation role must be member or admin.', 422);
  }
  return role;
}

async function insertPendingInvitation(opts: {
  client: PoolClient;
  organizationId: string;
  email: string;
  role: MembershipRole;
  invitedByUserId: string;
  expiresAt: Date;
}): Promise<{ invitation: InvitationPublic; rawToken: string }> {
  const rawToken = randomToken(32);
  const tokenHash = hashToken(rawToken);
  const { rows } = await opts.client.query(
    `insert into organization_invitations
       (organization_id, email, role, token_hash, invited_by_user_id, status, expires_at)
     values ($1, $2, $3, $4, $5, 'pending', $6)
     returning id, organization_id, email, role, status, expires_at,
               invited_by_user_id, accepted_at, accepted_by_user_id, created_at`,
    [
      opts.organizationId,
      opts.email,
      opts.role,
      tokenHash,
      opts.invitedByUserId,
      opts.expiresAt.toISOString(),
    ]
  );
  return { invitation: serializeInvitation(rows[0]), rawToken };
}

async function deliverInvitationEmail(opts: {
  to: string;
  workspaceName: string;
  inviterUserId: string;
  role: MembershipRole;
  rawToken: string;
  expiresAt: Date;
}): Promise<EmailDeliveryResult> {
  const { rows } = await query<{ display_name: string | null }>(
    `select display_name from users where id = $1`,
    [opts.inviterUserId]
  );
  return mailer.sendWorkspaceInvitation({
    to: opts.to,
    workspaceName: opts.workspaceName,
    inviterName: rows[0]?.display_name ?? null,
    role: opts.role,
    rawToken: opts.rawToken,
    expiresAt: opts.expiresAt,
  });
}

/**
 * Create a pending team invitation. Raw token returned once for email/link;
 * only the hash is persisted.
 */
export async function createInvitation(opts: {
  actorUserId: string;
  organizationId: string;
  email: string;
  role?: unknown;
}): Promise<InvitationCreateResult> {
  const organizationId = assertUuid(opts.organizationId);
  try {
    await requireInviteAdmin(opts.actorUserId, organizationId);
  } catch (err) {
    membershipErrorToAppError(err);
  }

  const org = await loadTeamOrganization(organizationId);
  const email = normalizeEmail(opts.email);
  if (!email || !isValidEmail(email)) {
    throw new AppError('Please enter a valid email address', 422);
  }
  const role = parseInviteRole(opts.role);

  const existingMember = await findActiveMemberByEmail(organizationId, email);
  if (existingMember) {
    throw new AppError('This user is already an active member of this workspace.', 409);
  }

  // Pending invite for same email → resend (new token + re-email). Do not block owners
  // with a dead-end "already pending" error when they click Invite again.
  const pending = await findPendingInvitation(organizationId, email);
  if (pending) {
    return resendInvitation({
      actorUserId: opts.actorUserId,
      organizationId,
      invitationId: pending.id,
    });
  }

  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const created = await withTransaction(async (client) => {
    // Re-check inside transaction for races
    const memberAgain = await findActiveMemberByEmail(organizationId, email, client);
    if (memberAgain) {
      throw new AppError('This user is already an active member of this workspace.', 409);
    }
    const pendingAgain = await findPendingInvitation(organizationId, email, client);
    if (pendingAgain) {
      // Race: another create landed first — resend that invite instead of failing.
      return null;
    }
    return insertPendingInvitation({
      client,
      organizationId,
      email,
      role,
      invitedByUserId: opts.actorUserId,
      expiresAt,
    });
  });

  if (!created) {
    const again = await findPendingInvitation(organizationId, email);
    if (!again) {
      throw new AppError('Could not create invitation. Try again.', 409);
    }
    return resendInvitation({
      actorUserId: opts.actorUserId,
      organizationId,
      invitationId: again.id,
    });
  }

  const emailResult = await deliverInvitationEmail({
    to: email,
    workspaceName: org.name,
    inviterUserId: opts.actorUserId,
    role,
    rawToken: created.rawToken,
    expiresAt,
  });

  return {
    invitation: created.invitation,
    rawToken: created.rawToken,
    email: emailResult,
  };
}

export async function listInvitations(opts: {
  actorUserId: string;
  organizationId: string;
}): Promise<InvitationPublic[]> {
  const organizationId = assertUuid(opts.organizationId);
  try {
    await requireInviteAdmin(opts.actorUserId, organizationId);
  } catch (err) {
    membershipErrorToAppError(err);
  }
  await loadTeamOrganization(organizationId);

  const { rows } = await query(
    `select i.id, i.organization_id, i.email, i.role, i.status, i.expires_at,
            i.invited_by_user_id, i.accepted_at, i.accepted_by_user_id, i.created_at,
            u.email as invited_by_email, u.display_name as invited_by_display_name
     from organization_invitations i
     left join users u on u.id = i.invited_by_user_id
     where i.organization_id = $1
     order by i.created_at desc`,
    [organizationId]
  );
  return rows.map(serializeInvitation);
}

export async function revokeInvitation(opts: {
  actorUserId: string;
  organizationId: string;
  invitationId: string;
}): Promise<InvitationPublic> {
  const organizationId = assertUuid(opts.organizationId);
  const invitationId = assertUuid(opts.invitationId, 'invitationId');
  try {
    await requireInviteAdmin(opts.actorUserId, organizationId);
  } catch (err) {
    membershipErrorToAppError(err);
  }
  await loadTeamOrganization(organizationId);

  const { rows } = await query(
    `select id, organization_id, email, role, status, expires_at,
            invited_by_user_id, accepted_at, accepted_by_user_id, created_at
     from organization_invitations
     where id = $1`,
    [invitationId]
  );
  const row = rows[0];
  if (!row) throw new AppError('Invitation not found', 404);
  if (row.organization_id !== organizationId) {
    throw new AppError('Invitation does not belong to this organization.', 403);
  }
  if (row.status !== 'pending') {
    throw new AppError('Only pending invitations can be revoked.', 409);
  }

  const updated = await query(
    `update organization_invitations
     set status = 'revoked'
     where id = $1 and organization_id = $2 and status = 'pending'
     returning id, organization_id, email, role, status, expires_at,
               invited_by_user_id, accepted_at, accepted_by_user_id, created_at`,
    [invitationId, organizationId]
  );
  if (!updated.rows[0]) throw new AppError('Invitation could not be revoked.', 409);
  return serializeInvitation(updated.rows[0]);
}

/**
 * Invalidate prior pending token for same org+email and issue a new one.
 */
export async function resendInvitation(opts: {
  actorUserId: string;
  organizationId: string;
  invitationId: string;
}): Promise<InvitationCreateResult> {
  const organizationId = assertUuid(opts.organizationId);
  const invitationId = assertUuid(opts.invitationId, 'invitationId');
  try {
    await requireInviteAdmin(opts.actorUserId, organizationId);
  } catch (err) {
    membershipErrorToAppError(err);
  }
  const org = await loadTeamOrganization(organizationId);

  const created = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `select id, organization_id, email, role, status, expires_at
       from organization_invitations
       where id = $1
       for update`,
      [invitationId]
    );
    const row = rows[0];
    if (!row) throw new AppError('Invitation not found', 404);
    if (row.organization_id !== organizationId) {
      throw new AppError('Invitation does not belong to this organization.', 403);
    }
    if (row.status !== 'pending') {
      throw new AppError('Only pending invitations can be resent.', 409);
    }

    const email = normalizeEmail(row.email);
    const role = parseInviteRole(row.role);

    const member = await findActiveMemberByEmail(organizationId, email, client);
    if (member) {
      throw new AppError('This user is already an active member of this workspace.', 409);
    }

    // Invalidate this invitation and any other pending for same org+email
    await client.query(
      `update organization_invitations
       set status = 'revoked'
       where organization_id = $1
         and lower(email) = $2
         and status = 'pending'`,
      [organizationId, email]
    );

    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    return insertPendingInvitation({
      client,
      organizationId,
      email,
      role,
      invitedByUserId: opts.actorUserId,
      expiresAt,
    });
  });

  const emailResult = await deliverInvitationEmail({
    to: created.invitation.email,
    workspaceName: org.name,
    inviterUserId: opts.actorUserId,
    role: created.invitation.role,
    rawToken: created.rawToken,
    expiresAt: new Date(created.invitation.expiresAt),
  });

  return {
    invitation: created.invitation,
    rawToken: created.rawToken,
    email: emailResult,
  };
}

export interface InvitationPreview {
  invitationId: string;
  organizationId: string;
  organizationName: string;
  organizationKind: string;
  email: string;
  role: MembershipRole;
  status: InvitationStatus;
  expiresAt: string;
  expired: boolean;
  acceptable: boolean;
}

async function loadInvitationByRawToken(rawToken: string, client?: PoolClient) {
  const token = String(rawToken || '').trim();
  if (!token || token.length < 16) {
    throw new AppError('Invalid invitation token', 422);
  }
  const tokenHash = hashToken(token);
  const { rows } = await dbQuery<{
    id: string;
    organization_id: string;
    email: string;
    role: string;
    status: string;
    expires_at: Date | string;
    invited_by_user_id: string;
    accepted_at: Date | string | null;
    accepted_by_user_id: string | null;
    created_at: Date | string;
    token_hash: string;
    organization_name: string;
    organization_kind: string;
  }>(
    client,
    `select i.id, i.organization_id, i.email, i.role, i.status, i.expires_at,
            i.invited_by_user_id, i.accepted_at, i.accepted_by_user_id, i.created_at,
            i.token_hash,
            o.name as organization_name, o.kind as organization_kind
     from organization_invitations i
     join organizations o on o.id = i.organization_id
     where i.token_hash = $1`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

export async function previewInvitation(rawToken: string): Promise<InvitationPreview> {
  const row = await loadInvitationByRawToken(rawToken);
  if (!row) throw new AppError('Invitation not found', 404);

  const expiresAt = new Date(row.expires_at);
  const expired = expiresAt.getTime() <= Date.now() || row.status === 'expired';
  const acceptable =
    row.status === 'pending' &&
    !expired &&
    row.organization_kind === 'team';

  return {
    invitationId: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationKind: row.organization_kind,
    email: row.email,
    role: row.role as MembershipRole,
    status: expired && row.status === 'pending' ? 'expired' : (row.status as InvitationStatus),
    expiresAt: expiresAt.toISOString(),
    expired,
    acceptable,
  };
}

/**
 * Accept invitation: email-bound, single-use, team-only.
 * Does not create conversations or change personal workspace data.
 * Does NOT enforce seat limits (B5).
 */
export async function acceptInvitation(opts: {
  actorUserId: string;
  rawToken: string;
}): Promise<{
  invitation: InvitationPublic;
  membership: { organizationId: string; userId: string; role: MembershipRole; status: 'active' };
  alreadyMember: boolean;
}> {
  const { rows: userRows } = await query<{ id: string; email: string }>(
    `select id, email from users where id = $1`,
    [opts.actorUserId]
  );
  if (!userRows[0]) throw new AppError('User not found', 404);
  const actorEmail = normalizeEmail(userRows[0].email);

  // Pre-checks outside the accept transaction so expiry marking commits even when rejected.
  const pre = await loadInvitationByRawToken(opts.rawToken);
  if (!pre) throw new AppError('Invitation not found', 404);

  if (pre.status === 'revoked') {
    throw new AppError('This invitation has been revoked.', 409);
  }
  if (pre.status === 'accepted') {
    throw new AppError('This invitation has already been accepted.', 409);
  }
  if (pre.status === 'expired') {
    throw new AppError('This invitation has expired.', 409);
  }

  const preExpires = new Date(pre.expires_at);
  if (preExpires.getTime() <= Date.now() || pre.status !== 'pending') {
    if (pre.status === 'pending') {
      await query(
        `update organization_invitations set status = 'expired' where id = $1 and status = 'pending'`,
        [pre.id]
      );
    }
    throw new AppError('This invitation has expired.', 409);
  }

  if (normalizeEmail(pre.email) !== actorEmail) {
    throw new AppError('This invitation was sent to a different email address.', 403);
  }

  if (pre.organization_kind !== 'team') {
    throw new AppError('Invitations are only valid for team workspaces.', 403);
  }

  return withTransaction(async (client) => {
    const locked = await loadInvitationByRawToken(opts.rawToken, client);
    if (!locked) throw new AppError('Invitation not found', 404);

    await client.query(`select id from organization_invitations where id = $1 for update`, [
      locked.id,
    ]);
    const row = await loadInvitationByRawToken(opts.rawToken, client);
    if (!row) throw new AppError('Invitation not found', 404);

    if (row.status === 'revoked') {
      throw new AppError('This invitation has been revoked.', 409);
    }
    if (row.status === 'accepted') {
      throw new AppError('This invitation has already been accepted.', 409);
    }
    if (row.status === 'expired') {
      throw new AppError('This invitation has expired.', 409);
    }

    const expiresAt = new Date(row.expires_at);
    if (expiresAt.getTime() <= Date.now()) {
      await client.query(
        `update organization_invitations set status = 'expired' where id = $1 and status = 'pending'`,
        [row.id]
      );
      throw new AppError('This invitation has expired.', 409);
    }

    if (row.status !== 'pending') {
      throw new AppError('This invitation cannot be accepted.', 409);
    }

    if (normalizeEmail(row.email) !== actorEmail) {
      throw new AppError('This invitation was sent to a different email address.', 403);
    }

    if (row.organization_kind !== 'team') {
      throw new AppError('Invitations are only valid for team workspaces.', 403);
    }

    const role = parseInviteRole(row.role);

    const existing = await client.query<{ role: string; status: string }>(
      `select role, status from organization_memberships
       where organization_id = $1 and user_id = $2
       for update`,
      [row.organization_id, opts.actorUserId]
    );

    let alreadyMember = false;
    if (existing.rows[0]?.status === 'active') {
      alreadyMember = true;
    } else if (existing.rows[0]) {
      await client.query(
        `update organization_memberships
         set role = $3, status = 'active', updated_at = now()
         where organization_id = $1 and user_id = $2`,
        [row.organization_id, opts.actorUserId, role]
      );
    } else {
      await client.query(
        `insert into organization_memberships (organization_id, user_id, role, status)
         values ($1, $2, $3, 'active')`,
        [row.organization_id, opts.actorUserId, role]
      );
    }

    await client.query(
      `insert into user_workspace_state (user_id, organization_id, active_conversation_id)
       values ($1, $2, null)
       on conflict (user_id, organization_id) do nothing`,
      [opts.actorUserId, row.organization_id]
    );

    const accepted = await client.query(
      `update organization_invitations
       set status = 'accepted',
           accepted_at = now(),
           accepted_by_user_id = $2
       where id = $1 and status = 'pending'
       returning id, organization_id, email, role, status, expires_at,
                 invited_by_user_id, accepted_at, accepted_by_user_id, created_at`,
      [row.id, opts.actorUserId]
    );
    if (!accepted.rows[0]) {
      throw new AppError('This invitation has already been accepted.', 409);
    }

    const mem = await client.query<{ role: string }>(
      `select role from organization_memberships
       where organization_id = $1 and user_id = $2 and status = 'active'`,
      [row.organization_id, opts.actorUserId]
    );

    return {
      invitation: serializeInvitation(accepted.rows[0]),
      membership: {
        organizationId: row.organization_id,
        userId: opts.actorUserId,
        role: (mem.rows[0]?.role as MembershipRole) || role,
        status: 'active' as const,
      },
      alreadyMember,
    };
  });
}

/** Test helper: hash a raw token the same way production does. */
export function hashInvitationToken(raw: string): string {
  return hashToken(raw);
}

/** Test helper: generate invitation token material. */
export function generateInvitationTokenMaterial(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashToken(rawToken) };
}

export function wrapInvitationMembershipError(err: unknown): never {
  if (err instanceof MembershipAuthorizationError) {
    membershipErrorToAppError(err);
  }
  throw err;
}
