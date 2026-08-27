import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { streamNexoraTurn, runNexoraTurn, wantsProductKnowledge, type AttachmentMeta } from '@enterprise-ai-os/agent-core';
import { query } from '@enterprise-ai-os/stores';
import { getStores } from '../ingestion/pipeline';
import { persistChatTurn, ensureConversation } from './conversations';
import { assertConversationAccess } from '../lib/conversationAccess';
import { requireVerified } from '../middleware/auth';
import { AppError, asyncHandler, ok } from '../lib/errors';
import { withUserConnectorContext } from '../lib/withUserConnectors';
import { retrieveMarketingContext } from '../chatbot/indexer';

export const chatRouter = Router();

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_EXT = new Set([
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.tsv',
  '.xlsx',
  '.xls',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.sql',
  '.html',
  '.css',
  '.yaml',
  '.yml',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = (() => {
      const n = file.originalname || '';
      const i = n.lastIndexOf('.');
      return i >= 0 ? n.slice(i).toLowerCase() : '';
    })();
    if (!ALLOWED_EXT.has(ext)) {
      cb(new Error(`File type not allowed (${ext || 'unknown'}). Allowed: PDF, DOCX, TXT, CSV, JSON, XLSX, images, code.`));
      return;
    }
    cb(null, true);
  },
});

function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

async function extractText(file: { originalname?: string; mimetype?: string; buffer: Buffer }): Promise<{
  text?: string;
  error?: string;
}> {
  const name = file.originalname || 'file';
  const mime = file.mimetype || '';
  const ext = extname(name);
  try {
    if (!ALLOWED_EXT.has(ext)) {
      return { error: `Unsupported extension ${ext}` };
    }
    if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
      return {
        error:
          'Image uploaded and stored, but OCR/vision is not enabled for this model path. Describe the image or paste text — do not claim pixel contents were read.',
      };
    }
    if (mime.startsWith('text/') || ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.ts', '.tsx', '.js', '.jsx', '.py', '.sql', '.html', '.css', '.yaml', '.yml'].includes(ext)) {
      const text = file.buffer.toString('utf8');
      if (!text.trim()) return { error: 'File is empty' };
      // Cap extract size for context (chunking boundary for large docs)
      return { text: text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n[Truncated — first 120k chars indexed for this turn]` : text };
    }
    if (ext === '.docx' || mime.includes('wordprocessingml')) {
      const mammoth = await import('mammoth');
      const out = await mammoth.extractRawText({ buffer: file.buffer });
      const text = String(out.value || '').trim();
      return text
        ? { text: text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n[Truncated]` : text }
        : { error: 'DOCX contained no extractable text' };
    }
    if (ext === '.pdf' || mime === 'application/pdf') {
      const mod: any = await import('pdf-parse');
      const parse = mod.default || mod;
      const out = await parse(file.buffer);
      const text = String(out?.text || '').trim();
      return text
        ? { text: text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n[Truncated — first 120k chars for this turn]` : text }
        : { error: 'PDF contained no extractable text' };
    }
    if (ext === '.xlsx' || ext === '.xls' || mime.includes('spreadsheet')) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      const sheets = wb.SheetNames.slice(0, 5).map((sheetName) => {
        const sheet = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return `## Sheet: ${sheetName}\n${csv.slice(0, 40_000)}`;
      });
      const text = sheets.join('\n\n').trim();
      return text ? { text: text.slice(0, 120_000) } : { error: 'Spreadsheet had no readable cells' };
    }
    return { error: `Unsupported file type for extract (${mime || name})` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

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

async function loadAttachments(
  organizationId: string,
  userId: string,
  ids: string[] | undefined
): Promise<AttachmentMeta[]> {
  if (!ids?.length) return [];
  const out: AttachmentMeta[] = [];
  for (const id of ids.slice(0, 5)) {
    try {
      const res = await query<{
        id: string;
        filename: string;
        mime_type: string | null;
        extracted_text: string | null;
        extract_error: string | null;
      }>(
        `select id, filename, mime_type, extracted_text, extract_error from chat_attachments
         where id = $1 and organization_id = $2 and user_id = $3`,
        [id, organizationId, userId]
      );
      const row = res.rows[0];
      if (!row) {
        out.push({ id, filename: id, error: 'attachment not found' });
        continue;
      }
      out.push({
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type ?? undefined,
        text: row.extracted_text ?? undefined,
        error: row.extract_error ?? undefined,
      });
    } catch {
      out.push({ id, filename: id, error: 'attachment store unavailable' });
    }
  }
  return out;
}

async function ensureAttachmentSchema(): Promise<void> {
  try {
    await query(`
      create table if not exists chat_attachments (
        id text primary key,
        organization_id text not null,
        user_id text not null,
        filename text not null,
        mime_type text,
        extracted_text text,
        extract_error text,
        created_at timestamptz not null default now()
      )
    `);
  } catch (err) {
    console.warn('[chat] attachment schema ensure skipped:', err instanceof Error ? err.message : err);
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
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError(`File too large. Max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`, 400);
    }
    const user = req.user!;
    const id = randomUUID();
    const extracted = await extractText(file);
    await query(
      `insert into chat_attachments (id, organization_id, user_id, filename, mime_type, extracted_text, extract_error)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        user.organizationId,
        user.id,
        file.originalname,
        file.mimetype,
        extracted.text ?? null,
        extracted.error ?? null,
      ]
    );
    ok(res, {
      attachment: {
        id,
        filename: file.originalname,
        mimeType: file.mimetype,
        hasText: Boolean(extracted.text),
        error: extracted.error,
      },
    });
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

    // Ensure conversation exists BEFORE agent turn so approvals can link conversation_id
    const activeConversationId = await ensureConversation({
      organizationId: user.organizationId,
      userId: user.id,
      conversationId: typeof conversationId === 'string' ? conversationId : undefined,
      titleHint: String(message).slice(0, 80),
    });

    const history = await loadHistory(user.organizationId, user.id, activeConversationId);
    const attachments = await loadAttachments(
      user.organizationId,
      user.id,
      Array.isArray(attachmentIds) ? attachmentIds.map(String) : undefined
    );

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

          // Emit conversation id immediately so the client can lock the URL
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
            attachments,
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
          attachments,
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
