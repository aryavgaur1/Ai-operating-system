import { Router } from 'express';
import { query } from '@enterprise-ai-os/stores';
import { AppError, ok, asyncHandler } from '../lib/errors';
import {
  assertConversationAccess,
  findRecentAccessibleConversation,
  getOrganizationKind,
  listAccessibleConversations,
} from '../lib/conversationAccess';
import { assertActiveMembership } from '../lib/workspaceAuth';

export const conversationsRouter = Router();

conversationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const conversations = await listAccessibleConversations({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
    });
    ok(res, { conversations });
  })
);

/**
 * Authoritative resume target for Chat navigation / bare /app/chat.
 * Order: user_workspace_state → users.active_conversation_id (personal) → recent accessible.
 * Never creates a conversation.
 */
conversationsRouter.get(
  '/resume',
  asyncHandler(async (req, res) => {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;
    await assertActiveMembership(userId, orgId);

    // Per-(user, org) workspace state (migration 014)
    try {
      const state = await query<{ active_conversation_id: string | null }>(
        `select active_conversation_id from user_workspace_state
         where user_id = $1 and organization_id = $2`,
        [userId, orgId]
      );
      const preferred = state.rows[0]?.active_conversation_id || null;
      if (preferred) {
        try {
          await assertConversationAccess({
            organizationId: orgId,
            userId,
            conversationId: preferred,
          });
          ok(res, { conversationId: preferred, source: 'workspace_state' });
          return;
        } catch {
          // stale pointer — fall through
        }
      }
    } catch (err: any) {
      if (err?.code !== '42P01') throw err; // undefined_table before migrate
    }

    // Legacy users.active_conversation_id (personal home path)
    try {
      const active = await query<{ active_conversation_id: string | null }>(
        `select active_conversation_id from users where id = $1`,
        [userId]
      );
      const preferred = active.rows[0]?.active_conversation_id || null;
      if (preferred) {
        try {
          await assertConversationAccess({
            organizationId: orgId,
            userId,
            conversationId: preferred,
          });
          ok(res, { conversationId: preferred, source: 'active' });
          return;
        } catch {
          // not accessible in this org
        }
      }
    } catch (err: any) {
      if (err?.code !== '42703') throw err;
    }

    const recent = await findRecentAccessibleConversation({ organizationId: orgId, userId });
    if (recent) {
      ok(res, { conversationId: recent, source: 'recent' });
      return;
    }

    ok(res, { conversationId: null, source: 'none' });
  })
);

/** Explicit create — used by New Chat / first message. Also marks active. */
conversationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const titleHint = typeof req.body?.title === 'string' ? req.body.title : 'New conversation';
    const id = await ensureConversation({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      titleHint,
    });
    await activateConversationForUser({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      conversationId: id,
    });
    const { rows } = await query(
      `select id, title, pinned, created_at, updated_at from conversations where id = $1`,
      [id]
    );
    ok(res, { conversation: rows[0] }, 'Conversation created');
  })
);

conversationsRouter.post(
  '/:id/activate',
  asyncHandler(async (req, res) => {
    await activateConversationForUser({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      conversationId: req.params.id,
    });
    ok(res, { conversationId: req.params.id });
  })
);

conversationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    await assertConversationAccess({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      conversationId: req.params.id,
    });
    const conv = await query(
      `select id, title, pinned, created_at, updated_at from conversations where id = $1`,
      [req.params.id]
    );
    if (!conv.rows[0]) throw new AppError('Conversation not found', 404);
    await activateConversationForUser({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      conversationId: req.params.id,
    });
    const messages = await query(
      `select id, role, content, tool_calls, created_at from messages
       where conversation_id = $1 order by created_at asc`,
      [req.params.id]
    );
    ok(res, { conversation: conv.rows[0], messages: messages.rows });
  })
);

conversationsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    await assertConversationAccess({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      conversationId: req.params.id,
    });
    const { title, pinned } = req.body ?? {};
    const { rows } = await query(
      `update conversations set
         title = coalesce($1, title),
         pinned = coalesce($2, pinned),
         updated_at = now()
       where id = $3 and organization_id = $4
       returning id, title, pinned, created_at, updated_at`,
      [title ?? null, pinned ?? null, req.params.id, req.user!.organizationId]
    );
    if (!rows[0]) throw new AppError('Conversation not found', 404);
    ok(res, { conversation: rows[0] });
  })
);

conversationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await assertConversationAccess({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      conversationId: req.params.id,
    });
    // Personal: only creator can delete (access already requires user_id).
    // Team: any active member may delete a shared thread (org-scoped).
    const kind = await getOrganizationKind(req.user!.organizationId);
    const result =
      kind === 'team'
        ? await query(`delete from conversations where id = $1 and organization_id = $2`, [
            req.params.id,
            req.user!.organizationId,
          ])
        : await query(
            `delete from conversations where id = $1 and organization_id = $2 and user_id = $3`,
            [req.params.id, req.user!.organizationId, req.user!.id]
          );
    if (result.rowCount === 0) throw new AppError('Conversation not found', 404);
    ok(res, null, 'Conversation deleted');
  })
);

export async function persistChatTurn(opts: {
  organizationId: string;
  userId: string;
  conversationId?: string;
  userMessage: string;
  assistantReply: string;
  toolCalls?: unknown;
}): Promise<string> {
  let conversationId = opts.conversationId;
  if (!conversationId) {
    const title = opts.userMessage.slice(0, 80);
    const created = await query<{ id: string }>(
      `insert into conversations (organization_id, user_id, title)
       values ($1, $2, $3) returning id`,
      [opts.organizationId, opts.userId, title]
    );
    conversationId = created.rows[0].id;
  } else {
    await assertConversationAccess({
      organizationId: opts.organizationId,
      userId: opts.userId,
      conversationId,
    });
    await query(`update conversations set updated_at = now() where id = $1`, [conversationId]);
  }

  await query(
    `insert into messages (conversation_id, role, content) values ($1, 'user', $2)`,
    [conversationId, opts.userMessage]
  );
  await query(
    `insert into messages (conversation_id, role, content, tool_calls) values ($1, 'assistant', $2, $3)`,
    [conversationId, opts.assistantReply, opts.toolCalls ? JSON.stringify(opts.toolCalls) : null]
  );
  try {
    await activateConversationForUser({
      organizationId: opts.organizationId,
      userId: opts.userId,
      conversationId,
    });
  } catch {
    // ownership already validated via ensureConversation / insert path
  }
  return conversationId;
}

/** Ensure a conversation row exists before the agent turn (so approvals can link). */
export async function ensureConversation(opts: {
  organizationId: string;
  userId: string;
  conversationId?: string;
  titleHint?: string;
}): Promise<string> {
  await assertActiveMembership(opts.userId, opts.organizationId);
  if (opts.conversationId) {
    await assertConversationAccess({
      organizationId: opts.organizationId,
      userId: opts.userId,
      conversationId: opts.conversationId,
    });
    await query(`update conversations set updated_at = now() where id = $1`, [opts.conversationId]);
    await activateConversationForUser({
      organizationId: opts.organizationId,
      userId: opts.userId,
      conversationId: opts.conversationId,
    });
    return opts.conversationId;
  }
  const title = (opts.titleHint || 'New conversation').slice(0, 80) || 'New conversation';
  const created = await query<{ id: string }>(
    `insert into conversations (organization_id, user_id, title)
     values ($1, $2, $3) returning id`,
    [opts.organizationId, opts.userId, title]
  );
  const id = created.rows[0].id;
  await activateConversationForUser({
    organizationId: opts.organizationId,
    userId: opts.userId,
    conversationId: id,
  });
  return id;
}

/** Mark conversation as the user's active resume target for this workspace (DB authority). */
export async function activateConversationForUser(opts: {
  organizationId: string;
  userId: string;
  conversationId: string;
}): Promise<void> {
  await assertConversationAccess({
    organizationId: opts.organizationId,
    userId: opts.userId,
    conversationId: opts.conversationId,
  });
  await query(`update conversations set updated_at = now() where id = $1`, [opts.conversationId]);

  await query(
    `insert into user_workspace_state (user_id, organization_id, active_conversation_id, updated_at)
     values ($1, $2, $3, now())
     on conflict (user_id, organization_id) do update
       set active_conversation_id = excluded.active_conversation_id,
           updated_at = now()`,
    [opts.userId, opts.organizationId, opts.conversationId]
  ).catch((err: any) => {
    if (err?.code !== '42P01') throw err;
  });

  // Legacy personal pointer — only when this org is the user's personal home
  try {
    await query(
      `update users set active_conversation_id = $1
       where id = $2 and organization_id = $3`,
      [opts.conversationId, opts.userId, opts.organizationId]
    );
  } catch (err: any) {
    if (err?.code !== '42703') throw err;
  }
}

/** Append a durable assistant message (e.g. verified Approve & Run result). */
export async function appendAssistantMessage(opts: {
  conversationId: string;
  organizationId: string;
  userId?: string;
  content: string;
  toolCalls?: unknown;
}): Promise<void> {
  if (opts.userId) {
    await assertConversationAccess({
      organizationId: opts.organizationId,
      userId: opts.userId,
      conversationId: opts.conversationId,
    });
  } else {
    const owned = await query(
      `select id from conversations where id = $1 and organization_id = $2`,
      [opts.conversationId, opts.organizationId]
    );
    if (!owned.rows[0]) throw new AppError('Conversation not found', 404);
  }
  await query(
    `insert into messages (conversation_id, role, content, tool_calls) values ($1, 'assistant', $2, $3)`,
    [opts.conversationId, opts.content, opts.toolCalls ? JSON.stringify(opts.toolCalls) : null]
  );
  await query(`update conversations set updated_at = now() where id = $1`, [opts.conversationId]);
}
