import { randomUUID } from 'crypto';
import { query } from '@enterprise-ai-os/stores';
import { embedBatch, embedText } from '@enterprise-ai-os/agent-core';
import { createVectorStore } from '@enterprise-ai-os/stores';
import {
  chunkDocumentText,
  detectDocumentKind,
  extractDocument,
  saveUploadBinary,
  type ExtractResult,
} from './documentIntelligence';

export type AttachmentStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export type StoredAttachment = {
  id: string;
  filename: string;
  mimeType: string | null;
  status: AttachmentStatus;
  extractedText: string | null;
  extractError: string | null;
  kind: string | null;
  conversationId: string | null;
  metadata: Record<string, unknown> | null;
};

const vectorStore = createVectorStore();

export async function ensureAttachmentSchema(): Promise<void> {
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
  // Additive columns for document intelligence (idempotent)
  await query(`alter table chat_attachments add column if not exists status text`);
  await query(`alter table chat_attachments add column if not exists conversation_id text`);
  await query(`alter table chat_attachments add column if not exists file_size integer`);
  await query(`alter table chat_attachments add column if not exists content_kind text`);
  await query(`alter table chat_attachments add column if not exists metadata jsonb`);
  await query(`alter table chat_attachments add column if not exists storage_path text`);
  await query(`alter table chat_attachments add column if not exists processed_at timestamptz`);
  await query(
    `create index if not exists chat_attachments_org_user_idx on chat_attachments (organization_id, user_id, created_at desc)`
  );
  await query(
    `create index if not exists chat_attachments_conversation_idx on chat_attachments (conversation_id)`
  );
}

export async function insertProcessingAttachment(input: {
  organizationId: string;
  userId: string;
  filename: string;
  mimeType?: string;
  fileSize: number;
  conversationId?: string;
}): Promise<string> {
  const id = randomUUID();
  await query(
    `insert into chat_attachments
      (id, organization_id, user_id, filename, mime_type, status, file_size, conversation_id, extracted_text, extract_error)
     values ($1,$2,$3,$4,$5,'processing',$6,$7,null,null)`,
    [
      id,
      input.organizationId,
      input.userId,
      input.filename,
      input.mimeType ?? null,
      input.fileSize,
      input.conversationId ?? null,
    ]
  );
  return id;
}

export async function finalizeAttachment(input: {
  id: string;
  organizationId: string;
  userId: string;
  extracted: ExtractResult;
  storagePath?: string | null;
}): Promise<StoredAttachment> {
  const status: AttachmentStatus = input.extracted.text?.trim()
    ? 'ready'
    : 'failed';
  const metadata = {
    ...(input.extracted.metadata || {}),
    usedVision: Boolean(input.extracted.usedVision),
  };
  await query(
    `update chat_attachments set
       status = $1,
       extracted_text = $2,
       extract_error = $3,
       content_kind = $4,
       metadata = $5::jsonb,
       storage_path = coalesce($6, storage_path),
       processed_at = now()
     where id = $7 and organization_id = $8 and user_id = $9`,
    [
      status,
      input.extracted.text ?? null,
      input.extracted.error ?? (status === 'failed' ? 'Document processing failed' : null),
      input.extracted.kind,
      JSON.stringify(metadata),
      input.storagePath ?? null,
      input.id,
      input.organizationId,
      input.userId,
    ]
  );

  return (await getAttachmentForOwner(
    input.organizationId,
    input.userId,
    input.id
  )) as StoredAttachment;
}

export async function getAttachmentForOwner(
  organizationId: string,
  userId: string,
  id: string
): Promise<StoredAttachment | null> {
  const res = await query<{
    id: string;
    filename: string;
    mime_type: string | null;
    status: string | null;
    extracted_text: string | null;
    extract_error: string | null;
    content_kind: string | null;
    conversation_id: string | null;
    metadata: Record<string, unknown> | null;
  }>(
    `select id, filename, mime_type, status, extracted_text, extract_error, content_kind, conversation_id, metadata
     from chat_attachments
     where id = $1 and organization_id = $2 and user_id = $3`,
    [id, organizationId, userId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    status: (row.status as AttachmentStatus) || (row.extracted_text ? 'ready' : row.extract_error ? 'failed' : 'processing'),
    extractedText: row.extracted_text,
    extractError: row.extract_error,
    kind: row.content_kind,
    conversationId: row.conversation_id,
    metadata: row.metadata,
  };
}

export async function bindAttachmentsToConversation(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  attachmentIds: string[];
}): Promise<void> {
  if (!input.attachmentIds.length) return;
  await query(
    `update chat_attachments
     set conversation_id = $1
     where organization_id = $2 and user_id = $3 and id = any($4::text[])`,
    [input.conversationId, input.organizationId, input.userId, input.attachmentIds]
  );
}

export async function loadAuthorizedAttachments(input: {
  organizationId: string;
  userId: string;
  ids?: string[];
  conversationId?: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    filename: string;
    mimeType?: string;
    text?: string;
    error?: string;
    status?: string;
    kind?: string;
  }>
> {
  const limit = Math.min(8, Math.max(1, input.limit ?? 5));
  const out: Array<{
    id: string;
    filename: string;
    mimeType?: string;
    text?: string;
    error?: string;
    status?: string;
    kind?: string;
  }> = [];

  const ids = (input.ids || []).filter(Boolean).slice(0, limit);
  if (ids.length) {
    for (const id of ids) {
      const row = await getAttachmentForOwner(input.organizationId, input.userId, id);
      if (!row) {
        out.push({ id, filename: id, error: 'attachment not found' });
        continue;
      }
      out.push({
        id: row.id,
        filename: row.filename,
        mimeType: row.mimeType ?? undefined,
        text: row.extractedText ?? undefined,
        error: row.extractError ?? undefined,
        status: row.status,
        kind: row.kind ?? undefined,
      });
    }
    return out;
  }

  if (input.conversationId) {
    const res = await query<{
      id: string;
      filename: string;
      mime_type: string | null;
      extracted_text: string | null;
      extract_error: string | null;
      status: string | null;
      content_kind: string | null;
    }>(
      `select id, filename, mime_type, extracted_text, extract_error, status, content_kind
       from chat_attachments
       where organization_id = $1 and user_id = $2 and conversation_id = $3
       order by created_at desc
       limit $4`,
      [input.organizationId, input.userId, input.conversationId, limit]
    );
    for (const row of res.rows) {
      out.push({
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type ?? undefined,
        text: row.extracted_text ?? undefined,
        error: row.extract_error ?? undefined,
        status: row.status ?? undefined,
        kind: row.content_kind ?? undefined,
      });
    }
  }

  return out;
}

export async function indexAttachmentChunks(input: {
  attachmentId: string;
  organizationId: string;
  userId: string;
  filename: string;
  text: string;
  kind: string;
  conversationId?: string;
}): Promise<number> {
  // Refresh filename if empty
  let filename = input.filename;
  if (!filename) {
    const row = await getAttachmentForOwner(input.organizationId, input.userId, input.attachmentId);
    filename = row?.filename || input.attachmentId;
  }

  const chunks = chunkDocumentText(input.text, { sourceLabel: filename });
  if (!chunks.length) return 0;

  const embeddings = await embedBatch(chunks.map((c) => c.text));
  await vectorStore.upsert(
    chunks.map((c, i) => ({
      id: `chat-att:${input.organizationId}:${input.attachmentId}:${c.index}`,
      text: c.text,
      embedding: embeddings[i],
      metadata: {
        organizationId: input.organizationId,
        userId: input.userId,
        attachmentId: input.attachmentId,
        filename,
        kind: input.kind,
        conversationId: input.conversationId,
        section: c.label,
        source: 'chat_attachment',
      },
    }))
  );
  return chunks.length;
}

/** Retrieve relevant chunks for this org+user only (hard isolation). */
export async function retrieveAttachmentContext(input: {
  organizationId: string;
  userId: string;
  query: string;
  attachmentIds?: string[];
  topK?: number;
}): Promise<Array<{ text: string; filename?: string; section?: string; score: number }>> {
  // Hard require attachment scope — never scan unrelated user docs by accident.
  if (!input.attachmentIds?.length) return [];

  const topK = input.topK ?? 6;
  const embedding = await embedText(input.query);
  const matches = await vectorStore.query(embedding, Math.max(topK * 4, 12), {
    organizationId: input.organizationId,
  });

  return matches
    .filter((m) => {
      const meta = m.metadata || {};
      if (meta.source !== 'chat_attachment') return false;
      if (meta.organizationId !== input.organizationId) return false;
      if (meta.userId !== input.userId) return false;
      if (!input.attachmentIds!.includes(String(meta.attachmentId))) return false;
      return true;
    })
    .slice(0, topK)
    .map((m) => ({
      text: m.text,
      filename: typeof m.metadata?.filename === 'string' ? m.metadata.filename : undefined,
      section: typeof m.metadata?.section === 'string' ? m.metadata.section : undefined,
      score: m.score,
    }));
}

async function finalizeAndIndex(input: {
  id: string;
  organizationId: string;
  userId: string;
  filename: string;
  mimeType?: string;
  buffer: Buffer;
  conversationId?: string;
  storagePath: string;
}): Promise<StoredAttachment> {
  let extracted: ExtractResult;
  try {
    extracted = await extractDocument({
      originalname: input.filename,
      mimetype: input.mimeType,
      buffer: input.buffer,
    });
  } catch (err) {
    extracted = {
      kind: 'unsupported',
      error: err instanceof Error ? err.message : 'Document processing failed',
    };
  }

  const stored = await finalizeAttachment({
    id: input.id,
    organizationId: input.organizationId,
    userId: input.userId,
    extracted,
    storagePath: input.storagePath,
  });

  if (stored.status === 'ready' && stored.extractedText) {
    void indexAttachmentChunks({
      attachmentId: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
      filename: input.filename,
      text: stored.extractedText,
      kind: extracted.kind,
      conversationId: input.conversationId,
    }).catch(() => undefined);
  }

  return stored;
}

export async function processUploadedFile(input: {
  organizationId: string;
  userId: string;
  filename: string;
  mimeType?: string;
  buffer: Buffer;
  conversationId?: string;
}): Promise<{
  attachment: {
    id: string;
    filename: string;
    mimeType?: string;
    hasText: boolean;
    status: AttachmentStatus;
    kind?: string;
    error?: string;
  };
}> {
  const kind = detectDocumentKind({ filename: input.filename, mimeType: input.mimeType });

  const id = await insertProcessingAttachment({
    organizationId: input.organizationId,
    userId: input.userId,
    filename: input.filename,
    mimeType: input.mimeType,
    fileSize: input.buffer.length,
    conversationId: input.conversationId,
  });

  const storagePath = saveUploadBinary(input.organizationId, id, input.buffer);
  await query(`update chat_attachments set storage_path = $1, content_kind = $2 where id = $3`, [
    storagePath,
    kind,
    id,
  ]);

  // Images (vision) and larger files process in background so chat UI stays responsive.
  const asyncProcess = kind === 'image' || input.buffer.length > 1_500_000;
  if (asyncProcess) {
    void finalizeAndIndex({
      id,
      organizationId: input.organizationId,
      userId: input.userId,
      filename: input.filename,
      mimeType: input.mimeType,
      buffer: input.buffer,
      conversationId: input.conversationId,
      storagePath,
    }).catch(async (err) => {
      await finalizeAttachment({
        id,
        organizationId: input.organizationId,
        userId: input.userId,
        extracted: {
          kind,
          error: err instanceof Error ? err.message : 'Document processing failed',
        },
        storagePath,
      }).catch(() => undefined);
    });

    return {
      attachment: {
        id,
        filename: input.filename,
        mimeType: input.mimeType,
        hasText: false,
        status: 'processing',
        kind,
      },
    };
  }

  const stored = await finalizeAndIndex({
    id,
    organizationId: input.organizationId,
    userId: input.userId,
    filename: input.filename,
    mimeType: input.mimeType,
    buffer: input.buffer,
    conversationId: input.conversationId,
    storagePath,
  });

  return {
    attachment: {
      id,
      filename: input.filename,
      mimeType: input.mimeType,
      hasText: Boolean(stored.extractedText?.trim()),
      status: stored.status,
      kind: stored.kind ?? kind,
      error: stored.extractError ?? undefined,
    },
  };
}

export async function retryAttachmentProcessing(input: {
  organizationId: string;
  userId: string;
  attachmentId: string;
}): Promise<{
  attachment: {
    id: string;
    filename: string;
    mimeType?: string;
    hasText: boolean;
    status: AttachmentStatus;
    kind?: string;
    error?: string;
  };
} | null> {
  const row = await getAttachmentForOwner(input.organizationId, input.userId, input.attachmentId);
  if (!row) return null;

  const { readUploadBinary } = await import('./documentIntelligence');
  const buffer = readUploadBinary(input.organizationId, input.attachmentId);
  if (!buffer?.length) {
    await finalizeAttachment({
      id: input.attachmentId,
      organizationId: input.organizationId,
      userId: input.userId,
      extracted: { kind: (row.kind as any) || 'unsupported', error: 'Original file bytes are no longer available for retry.' },
    });
    return {
      attachment: {
        id: row.id,
        filename: row.filename,
        mimeType: row.mimeType ?? undefined,
        hasText: false,
        status: 'failed',
        kind: row.kind ?? undefined,
        error: 'Original file bytes are no longer available for retry.',
      },
    };
  }

  await query(
    `update chat_attachments set status = 'processing', extract_error = null, extracted_text = null, processed_at = null
     where id = $1 and organization_id = $2 and user_id = $3`,
    [input.attachmentId, input.organizationId, input.userId]
  );

  const storagePath = saveUploadBinary(input.organizationId, input.attachmentId, buffer);
  const stored = await finalizeAndIndex({
    id: input.attachmentId,
    organizationId: input.organizationId,
    userId: input.userId,
    filename: row.filename,
    mimeType: row.mimeType ?? undefined,
    buffer,
    conversationId: row.conversationId ?? undefined,
    storagePath,
  });

  return {
    attachment: {
      id: stored.id,
      filename: stored.filename,
      mimeType: stored.mimeType ?? undefined,
      hasText: Boolean(stored.extractedText?.trim()),
      status: stored.status,
      kind: stored.kind ?? undefined,
      error: stored.extractError ?? undefined,
    },
  };
}
