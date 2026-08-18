/**
 * P0.5 — Conversation authorization by organization kind.
 *
 * personal → creator-only (organization_id + user_id)
 * team     → shared among active members of that organization (organization_id + membership)
 *
 * Membership is already enforced via JWT / resolveAuthorizedOrganization.
 * This module never trusts a client-supplied organizationId alone for cross-org access:
 * callers must pass the authorized active organizationId from req.user.
 */
import { query } from '@enterprise-ai-os/stores';
import { AppError } from './errors';
import { assertActiveMembership } from './workspaceAuth';

export type OrganizationKind = 'personal' | 'team';

export async function getOrganizationKind(organizationId: string): Promise<OrganizationKind> {
  const { rows } = await query<{ kind: string | null }>(
    `select kind from organizations where id = $1`,
    [organizationId]
  );
  if (!rows[0]) throw new AppError('Organization not found', 404);
  return rows[0].kind === 'team' ? 'team' : 'personal';
}

/**
 * Assert the authenticated user may read/write messages in this conversation
 * within the authorized organization context.
 */
export async function assertConversationAccess(opts: {
  organizationId: string;
  userId: string;
  conversationId: string;
}): Promise<{ id: string; kind: OrganizationKind }> {
  await assertActiveMembership(opts.userId, opts.organizationId);
  const kind = await getOrganizationKind(opts.organizationId);

  if (kind === 'team') {
    const { rows } = await query<{ id: string }>(
      `select id from conversations
       where id = $1 and organization_id = $2`,
      [opts.conversationId, opts.organizationId]
    );
    if (!rows[0]) throw new AppError('Conversation not found', 404);
    return { id: rows[0].id, kind };
  }

  const { rows } = await query<{ id: string }>(
    `select id from conversations
     where id = $1 and organization_id = $2 and user_id = $3`,
    [opts.conversationId, opts.organizationId, opts.userId]
  );
  if (!rows[0]) throw new AppError('Conversation not found', 404);
  return { id: rows[0].id, kind };
}

/** List conversations visible in the authorized org. */
export async function listAccessibleConversations(opts: {
  organizationId: string;
  userId: string;
  limit?: number;
}): Promise<
  Array<{ id: string; title: string; pinned: boolean; created_at: Date; updated_at: Date }>
> {
  await assertActiveMembership(opts.userId, opts.organizationId);
  const kind = await getOrganizationKind(opts.organizationId);
  const limit = opts.limit ?? 100;

  if (kind === 'team') {
    const { rows } = await query(
      `select id, title, pinned, created_at, updated_at
       from conversations
       where organization_id = $1
       order by pinned desc, updated_at desc
       limit $2`,
      [opts.organizationId, limit]
    );
    return rows as any;
  }

  const { rows } = await query(
    `select id, title, pinned, created_at, updated_at
     from conversations
     where organization_id = $1 and user_id = $2
     order by pinned desc, updated_at desc
     limit $3`,
    [opts.organizationId, opts.userId, limit]
  );
  return rows as any;
}

/** Most recently updated conversation visible in this org for this user. */
export async function findRecentAccessibleConversation(opts: {
  organizationId: string;
  userId: string;
}): Promise<string | null> {
  await assertActiveMembership(opts.userId, opts.organizationId);
  const kind = await getOrganizationKind(opts.organizationId);

  if (kind === 'team') {
    const { rows } = await query<{ id: string }>(
      `select id from conversations
       where organization_id = $1
       order by updated_at desc
       limit 1`,
      [opts.organizationId]
    );
    return rows[0]?.id ?? null;
  }

  const { rows } = await query<{ id: string }>(
    `select id from conversations
     where organization_id = $1 and user_id = $2
     order by updated_at desc
     limit 1`,
    [opts.organizationId, opts.userId]
  );
  return rows[0]?.id ?? null;
}
