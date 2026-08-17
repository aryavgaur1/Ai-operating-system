import { Router } from 'express';
import { query } from '@enterprise-ai-os/stores';
import { AppError, ok, asyncHandler } from '../lib/errors';

export const conversationsRouter = Router();

conversationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `select id, title, pinned, created_at, updated_at
       from conversations
       where organization_id = $1 and user_id = $2
       order by pinned desc, updated_at desc
       limit 100`,
      [req.user!.organizationId, req.user!.id]
    );
    ok(res, { conversations: rows });
  })
);

/** Explicit create — used so the client can navigate to /app/chat/:id BEFORE the first turn. */
conversationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const titleHint = typeof req.body?.title === 'string' ? req.body.title : 'New conversation';
    const id = await ensureConversation({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      titleHint,
    });
    const { rows } = await query(
      `select id, title, pinned, created_at, updated_at from conversations where id = $1`,
      [id]
    );
    ok(res, { conversation: rows[0] }, 'Conversation created');
  })
);

conversationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const conv = await query(
      `select id, title, pinned, created_at, updated_at from conversations
       where id = $1 and organization_id = $2 and user_id = $3`,
      [req.params.id, req.user!.organizationId, req.user!.id]
    );
    if (!conv.rows[0]) throw new AppError('Conversation not found', 404);
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
    const { title, pinned } = req.body ?? {};
    const { rows } = await query(
      `update conversations set
         title = coalesce($1, title),
         pinned = coalesce($2, pinned),
         updated_at = now()
       where id = $3 and organization_id = $4 and user_id = $5
       returning id, title, pinned, created_at, updated_at`,
      [title ?? null, pinned ?? null, req.params.id, req.user!.organizationId, req.user!.id]
    );
    if (!rows[0]) throw new AppError('Conversation not found', 404);
    ok(res, { conversation: rows[0] });
  })
);

conversationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await query(
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
  return conversationId;
}

/** Ensure a conversation row exists before the agent turn (so approvals can link). */
export async function ensureConversation(opts: {
  organizationId: string;
  userId: string;
  conversationId?: string;
  titleHint?: string;
}): Promise<string> {
  if (opts.conversationId) {
    const { rows } = await query(
      `select id from conversations
       where id = $1 and organization_id = $2 and user_id = $3`,
      [opts.conversationId, opts.organizationId, opts.userId]
    );
    if (!rows[0]) throw new AppError('Conversation not found', 404);
    await query(`update conversations set updated_at = now() where id = $1`, [opts.conversationId]);
    return opts.conversationId;
  }
  const title = (opts.titleHint || 'New conversation').slice(0, 80) || 'New conversation';
  const created = await query<{ id: string }>(
    `insert into conversations (organization_id, user_id, title)
     values ($1, $2, $3) returning id`,
    [opts.organizationId, opts.userId, title]
  );
  return created.rows[0].id;
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
    const owned = await query(
      `select id from conversations
       where id = $1 and organization_id = $2 and user_id = $3`,
      [opts.conversationId, opts.organizationId, opts.userId]
    );
    if (!owned.rows[0]) throw new AppError('Conversation not found', 404);
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
