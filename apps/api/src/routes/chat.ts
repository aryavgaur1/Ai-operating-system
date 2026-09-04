import { Router } from 'express';
import multer from 'multer';
import { streamNexoraTurn, runNexoraTurn, wantsProductKnowledge, type AttachmentMeta } from '@enterprise-ai-os/agent-core';
import { getStores } from '../ingestion/pipeline';
import { persistChatTurn, ensureConversation } from './conversations';
import { requireVerified } from '../middleware/auth';
import { AppError, asyncHandler, ok } from '../lib/errors';
import { withUserConnectorContext } from '../lib/withUserConnectors';
import { retrieveMarketingContext } from '../chatbot/indexer';
import { SUPPORTED_EXTENSIONS, extname } from '../lib/documentIntelligence';
import {
  bindAttachmentsToConversation,
  ensureAttachmentSchema,
  loadAuthorizedAttachments,
  processUploadedFile,
  retrieveAttachmentContext,
} from '../lib/attachmentStore';
import { query } from '@enterprise-ai-os/stores';
import { assertConversationAccess } from '../lib/conversationAccess';

export const chatRouter = Router();

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname || '');
    const mime = String(file.mimetype || '').toLowerCase();
    const allowedMime =
      mime.startsWith('image/') ||
      mime.startsWith('text/') ||
      mime === 'application/pdf' ||
      mime.includes('wordprocessingml') ||
      mime.includes('spreadsheet') ||
      mime.includes('presentation') ||
      mime === 'application/json' ||
      mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (!SUPPORTED_EXTENSIONS.has(ext) && !allowedMime) {
      cb(
        new Error(
          `File type isn't supported yet (${ext || mime || 'unknown'}). Allowed: PDF, DOCX, PPTX, XLSX, CSV, TXT, Markdown, JSON, images, code.`
        )
      );
      return;
    }
    cb(null, true);
  },
});

async function loadHistory(
  organizationId: string,
  userId: string,
  conversationId?: string
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  if (!conversationId) return [];
  try {
    await assertConversationAccess({ organizationId, userId, conversationId });
    const messages = await query<{ role: string; content: string }>(
      `select role, content from messages where conversation_id = $1 order by created_at desc limit 16`,
      [conversationId]
    );
    return messages.rows
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  } catch {
    return [];
  }
}

chatRouter.post(
  '/upload',
  requireVerified,
  (req, res, next) => {
    upload.single('file')(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError(`File too large. Max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`, 400));
        }
        return next(new AppError(err.message, 400));
      }
      return next(new AppError(err?.message || 'Upload failed', 400));
    });
  },
  asyncHandler(async (req, res) => {
    await ensureAttachmentSchema();
    const file = req.file;
    if (!file) throw new AppError('file is required', 400);
    if (!file.buffer?.length) throw new AppError('File is empty', 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError(`File too large. Max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`, 400);
    }

    const user = req.user!;
    const conversationId =
      typeof req.body?.conversationId === 'string' && req.body.conversationId.trim()
        ? req.body.conversationId.trim()
        : undefined;

    if (conversationId) {
      try {
        await assertConversationAccess({
          organizationId: user.organizationId,
          userId: user.id,
          conversationId,
        });
      } catch {
        throw new AppError('Conversation not found or inaccessible', 404);
      }
    }

    const result = await processUploadedFile({
      organizationId: user.organizationId,
      userId: user.id,
      filename: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
      conversationId,
    });

    ok(res, { attachment: result.attachment });
  })
);

chatRouter.get(
  '/attachments/:id',
  requireVerified,
  asyncHandler(async (req, res) => {
    await ensureAttachmentSchema();
    const user = req.user!;
    const rows = await loadAuthorizedAttachments({
      organizationId: user.organizationId,
      userId: user.id,
      ids: [req.params.id],
    });
    const attachment = rows[0];
    if (!attachment || attachment.error === 'attachment not found') {
      throw new AppError('Attachment not found', 404);
    }
    ok(res, { attachment });
  })
);

chatRouter.post(
  '/attachments/:id/retry',
  requireVerified,
  asyncHandler(async (req, res) => {
    await ensureAttachmentSchema();
    const user = req.user!;
    const { retryAttachmentProcessing } = await import('../lib/attachmentStore');
    const result = await retryAttachmentProcessing({
      organizationId: user.organizationId,
      userId: user.id,
      attachmentId: req.params.id,
    });
    if (!result) throw new AppError('Attachment not found', 404);
    ok(res, { attachment: result.attachment });
  })
);

chatRouter.post(
  '/',
  requireVerified,
  asyncHandler(async (req, res) => {
    const { message, conversationId, attachmentIds, stream: streamBody } = req.body ?? {};
    if (!message || typeof message !== 'string') {
      throw new AppError('Request body must include a string `message`.', 400);
    }

    const user = req.user!;
    const { vectorStore, graphStore } = getStores();
    const wantStream =
      Boolean(streamBody) ||
      String(req.query.stream ?? '') === '1' ||
      String(req.headers.accept ?? '').includes('text/event-stream');

    const activeConversationId = await ensureConversation({
      organizationId: user.organizationId,
      userId: user.id,
      conversationId: typeof conversationId === 'string' ? conversationId : undefined,
      titleHint: String(message).slice(0, 80),
    });

    const history = await loadHistory(user.organizationId, user.id, activeConversationId);

    // Document intelligence must never take down plain chat.
    // Ensure schema first (new columns), then load attachments — soft-fail on any doc error.
    const explicitIds = Array.isArray(attachmentIds) ? attachmentIds.map(String) : [];
    let attachments: Awaited<ReturnType<typeof loadAuthorizedAttachments>> = [];
    let retrievedDocContext = '';
    try {
      await ensureAttachmentSchema();
      attachments = await loadAuthorizedAttachments({
        organizationId: user.organizationId,
        userId: user.id,
        ids: explicitIds.length ? explicitIds : undefined,
        conversationId: explicitIds.length ? undefined : activeConversationId,
        limit: 6,
      });

      if (explicitIds.length) {
        await bindAttachmentsToConversation({
          organizationId: user.organizationId,
          userId: user.id,
          conversationId: activeConversationId,
          attachmentIds: explicitIds,
        });
      }

      if (attachments.length) {
        try {
          const hits = await retrieveAttachmentContext({
            organizationId: user.organizationId,
            userId: user.id,
            query: message,
            attachmentIds: attachments.map((a) => a.id),
            topK: 6,
          });
          if (hits.length) {
            retrievedDocContext = hits
              .map(
                (h, i) =>
                  `[Doc ${i + 1}] ${h.filename || 'attachment'}${h.section ? ` · ${h.section}` : ''} (score ${h.score.toFixed(3)}):\n${h.text}`
              )
              .join('\n\n');
          }
        } catch (err) {
          console.warn('[chat] attachment retrieval skipped:', err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.warn(
        '[chat] attachment context skipped — continuing without documents:',
        err instanceof Error ? err.message : err
      );
      attachments = [];
      retrievedDocContext = '';
    }

    const attachmentMetas: AttachmentMeta[] = attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      text: a.text,
      error: a.error,
      status: a.status,
      kind: a.kind,
    }));

    let productKnowledge: string | undefined;
    if (wantsProductKnowledge(message, 'authenticated')) {
      try {
        const matches = await retrieveMarketingContext(message, 4);
        if (matches.length) {
          productKnowledge = matches
            .map((m, i) => `[${i + 1}] (${String(m.metadata?.title ?? 'Source')}) ${m.text}`)
            .join('\n\n');
        }
      } catch {
        // knowledge index may be cold
      }
    }

    const run = async () =>
      withUserConnectorContext({ id: user.id, organizationId: user.organizationId }, async () => {
        if (wantStream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

          res.write(`data: ${JSON.stringify({ type: 'conversation', conversationId: activeConversationId })}\n\n`);

          let finalReply = '';
          let finalResult: any = null;

          for await (const event of streamNexoraTurn({
            message,
            organizationId: user.organizationId,
            userId: user.id,
            conversationId: activeConversationId,
            mode: 'authenticated',
            history,
            attachments: attachmentMetas,
            documentRetrieval: retrievedDocContext || undefined,
            productKnowledge,
            vectorStore,
            graphStore,
            stream: true,
          })) {
            if (event.type === 'token') finalReply += event.text;
            if (event.type === 'done') {
              finalResult = event.result;
              finalReply = event.result.reply || finalReply;
            }
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          }

          let savedConversationId: string | undefined = activeConversationId;
          try {
            if (finalResult) {
              savedConversationId = await persistChatTurn({
                organizationId: user.organizationId,
                userId: user.id,
                conversationId: activeConversationId,
                userMessage: message,
                assistantReply: finalReply,
                toolCalls: {
                  plan: finalResult.plan,
                  executedCalls: finalResult.executedCalls,
                  pendingApprovalIds: finalResult.pendingApprovalIds,
                  sources: finalResult.sources,
                  actionOutcomes: finalResult.actionOutcomes,
                },
              });
              res.write(`data: ${JSON.stringify({ type: 'conversation', conversationId: savedConversationId })}\n\n`);
            }
          } catch (err) {
            console.warn('[chat] persist failed:', err instanceof Error ? err.message : err);
          }

          res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
          res.end();
          return;
        }

        const result = await runNexoraTurn({
          message,
          organizationId: user.organizationId,
          userId: user.id,
          conversationId: activeConversationId,
          mode: 'authenticated',
          history,
          attachments: attachmentMetas,
          documentRetrieval: retrievedDocContext || undefined,
          productKnowledge,
          vectorStore,
          graphStore,
        });

        let savedConversationId: string | undefined = activeConversationId;
        try {
          savedConversationId = await persistChatTurn({
            organizationId: user.organizationId,
            userId: user.id,
            conversationId: activeConversationId,
            userMessage: message,
            assistantReply: result.reply,
            toolCalls: {
              plan: result.plan,
              executedCalls: result.executedCalls,
              pendingApprovalIds: result.pendingApprovalIds,
              sources: result.sources,
              actionOutcomes: result.actionOutcomes,
            },
          });
        } catch (err) {
          console.warn('[chat] persist failed:', err instanceof Error ? err.message : err);
        }

        res.json({ ...result, conversationId: savedConversationId });
      });

    await run();
  })
);
