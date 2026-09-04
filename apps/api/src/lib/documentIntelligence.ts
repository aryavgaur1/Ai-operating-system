import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Universal document intelligence — extract + normalize business files.
 * Does NOT fine-tune models. Produces text (and image understanding) for grounding.
 */

export type DocumentKind =
  | 'text'
  | 'markdown'
  | 'csv'
  | 'json'
  | 'code'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'image'
  | 'unsupported';

export type ExtractResult = {
  kind: DocumentKind;
  text?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  /** When true, multimodal vision produced the text (not OCR-only). */
  usedVision?: boolean;
};

const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'));

export const MAX_EXTRACT_CHARS = 120_000;
export const MAX_CHUNK_CHARS = 2_400;
export const CHUNK_OVERLAP = 200;

const EXT_KIND: Record<string, DocumentKind> = {
  '.txt': 'text',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.csv': 'csv',
  '.tsv': 'csv',
  '.json': 'json',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.pptx': 'pptx',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.ts': 'code',
  '.tsx': 'code',
  '.js': 'code',
  '.jsx': 'code',
  '.py': 'code',
  '.sql': 'code',
  '.html': 'code',
  '.css': 'code',
  '.yaml': 'code',
  '.yml': 'code',
};

export const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_KIND));

const MIME_KIND: Array<{ test: (mime: string) => boolean; kind: DocumentKind }> = [
  { test: (m) => m.startsWith('image/'), kind: 'image' },
  { test: (m) => m === 'application/pdf', kind: 'pdf' },
  { test: (m) => m.includes('wordprocessingml') || m.includes('msword'), kind: 'docx' },
  { test: (m) => m.includes('spreadsheet') || m.includes('excel'), kind: 'xlsx' },
  { test: (m) => m.includes('presentation') || m.includes('powerpoint'), kind: 'pptx' },
  { test: (m) => m === 'text/csv' || m === 'text/tab-separated-values', kind: 'csv' },
  { test: (m) => m === 'text/markdown' || m === 'text/x-markdown', kind: 'markdown' },
  { test: (m) => m === 'application/json', kind: 'json' },
  { test: (m) => m.startsWith('text/'), kind: 'text' },
];

export function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

export function detectDocumentKind(input: {
  filename?: string;
  mimeType?: string;
}): DocumentKind {
  const mime = String(input.mimeType || '').toLowerCase().trim();
  const ext = extname(input.filename || '');
  // Prefer MIME when trustworthy; fall back to extension.
  for (const rule of MIME_KIND) {
    if (mime && rule.test(mime)) return rule.kind;
  }
  if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
  return 'unsupported';
}

function truncate(text: string, max = MAX_EXTRACT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[Truncated — first ${max} characters retained for grounding]`;
}

function isPlaceholderKey(value?: string): boolean {
  if (!value) return true;
  const n = value.trim().toLowerCase();
  return n === '' || n.startsWith('<') || n.includes('paste_your') || n.includes('your_') || n.includes('replace_me');
}

/** Split long documents into overlapping chunks for retrieval — not for dumping whole files into every turn. */
export function chunkDocumentText(
  text: string,
  opts?: { chunkSize?: number; overlap?: number; sourceLabel?: string }
): Array<{ index: number; text: string; label: string }> {
  const chunkSize = opts?.chunkSize ?? MAX_CHUNK_CHARS;
  const overlap = opts?.overlap ?? CHUNK_OVERLAP;
  const label = opts?.sourceLabel || 'Document';
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  if (cleaned.length <= chunkSize) {
    return [{ index: 0, text: cleaned, label: `${label} · section 1` }];
  }
  const chunks: Array<{ index: number; text: string; label: string }> = [];
  let start = 0;
  let index = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + chunkSize);
    let slice = cleaned.slice(start, end);
    // Prefer breaking on paragraph / line boundaries
    if (end < cleaned.length) {
      const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
      if (breakAt > chunkSize * 0.4) slice = slice.slice(0, breakAt);
    }
    const body = slice.trim();
    if (body) {
      chunks.push({ index, text: body, label: `${label} · section ${index + 1}` });
      index += 1;
    }
    if (end >= cleaned.length) break;
    start = Math.max(start + body.length - overlap, start + 1);
  }
  return chunks;
}

async function extractPlainText(buffer: Buffer): Promise<ExtractResult> {
  const text = buffer.toString('utf8');
  if (!text.trim()) return { kind: 'text', error: 'File is empty' };
  return { kind: 'text', text: truncate(text) };
}

async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const out = await mammoth.extractRawText({ buffer });
  const text = String(out.value || '').trim();
  if (!text) return { kind: 'docx', error: 'DOCX contained no extractable text' };
  return { kind: 'docx', text: truncate(text), metadata: { format: 'docx' } };
}

async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  const mod: any = await import('pdf-parse');
  // pdf-parse v2: class PDFParse; older v1: default function(buffer)
  let text = '';
  let pages: number | undefined;

  if (typeof mod.PDFParse === 'function') {
    const parser = new mod.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = String(result?.text || '').trim();
      pages = Number(result?.total || result?.pages || 0) || undefined;
      if (typeof parser.destroy === 'function') await parser.destroy();
    } catch (err) {
      if (typeof parser.destroy === 'function') await parser.destroy().catch(() => undefined);
      throw err;
    }
  } else {
    const parse = mod.default || mod;
    if (typeof parse !== 'function') {
      return { kind: 'pdf', error: 'PDF parser is not available in this environment' };
    }
    const out = await parse(buffer);
    text = String(out?.text || '').trim();
    pages = Number(out?.numpages || out?.numPages || 0) || undefined;
  }

  if (!text) return { kind: 'pdf', error: 'PDF contained no extractable text', metadata: { pages } };
  return { kind: 'pdf', text: truncate(text), metadata: { pages, format: 'pdf' } };
}

async function extractSpreadsheet(buffer: Buffer): Promise<ExtractResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetNames = wb.SheetNames || [];
  if (!sheetNames.length) return { kind: 'xlsx', error: 'Spreadsheet had no sheets' };

  const parts: string[] = [];
  let totalRows = 0;
  for (const sheetName of sheetNames.slice(0, 12)) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
    totalRows += rows.length;
    const header = (rows[0] || []).map((c) => String(c ?? '').trim()).filter(Boolean);
    const previewRows = rows.slice(0, 200);
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(
      [
        `## Sheet: ${sheetName}`,
        header.length ? `Columns: ${header.join(' | ')}` : '',
        `Rows (including header): ${rows.length}`,
        csv.slice(0, 40_000),
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  const text = parts.join('\n\n').trim();
  if (!text) return { kind: 'xlsx', error: 'Spreadsheet had no readable cells' };
  return {
    kind: 'xlsx',
    text: truncate(text),
    metadata: { sheetCount: sheetNames.length, sheetNames, totalRows, format: 'xlsx' },
  };
}

/**
 * PPTX is a ZIP of XML slides. Extract text nodes without adding a heavy parser dependency.
 */
async function extractPptx(buffer: Buffer): Promise<ExtractResult> {
  // Prefer jszip if present; otherwise use Node zlib + manual zip local-file scan is brittle.
  // Use dynamic require so builds don't hard-fail when optional.
  let JSZip: any;
  try {
    JSZip = requireFromCwd('jszip');
  } catch {
    try {
      JSZip = (await import('jszip')).default;
    } catch {
      return {
        kind: 'pptx',
        error:
          'PPTX support requires the jszip package. Install jszip, or export slides to PDF/DOCX/TXT.',
      };
    }
  }

  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] || 0);
      return na - nb;
    });

  if (!slideFiles.length) {
    return { kind: 'pptx', error: 'PPTX contained no slides' };
  }

  const parts: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string');
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g) as IterableIterator<RegExpExecArray>)
      .map((m) => String(m[1] || ''))
      .filter(Boolean);
    const notesName = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    let notes = '';
    if (zip.files[notesName]) {
      const notesXml = await zip.files[notesName].async('string');
      notes = Array.from(notesXml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g) as IterableIterator<RegExpExecArray>)
        .map((m) => String(m[1] || ''))
        .filter(Boolean)
        .join(' ');
    }
    const body = texts.join(' ').replace(/\s+/g, ' ').trim();
    if (body || notes) {
      parts.push(
        [`## Slide ${i + 1}`, body || '(no title text)', notes ? `Notes: ${notes}` : '']
          .filter(Boolean)
          .join('\n')
      );
    }
  }

  const text = parts.join('\n\n').trim();
  if (!text) return { kind: 'pptx', error: 'PPTX contained no extractable text' };
  return {
    kind: 'pptx',
    text: truncate(text),
    metadata: { slides: slideFiles.length, format: 'pptx' },
  };
}

function imageMediaType(mimeType?: string, filename?: string): string {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return mime === 'image/jpg' ? 'image/jpeg' : mime;
  const ext = extname(filename || '');
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function extractImageWithVision(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<ExtractResult> {
  const mediaType = imageMediaType(mimeType, filename);
  const b64 = buffer.toString('base64');
  const prompt =
    'Analyze this screenshot/image for a business AI assistant. Extract ALL visible text (OCR), ' +
    'describe UI/layout/charts, and list any errors, warnings, or key values. ' +
    'Be factual. Do not invent text that is not visible.';

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!isPlaceholderKey(openaiKey)) {
    const client = new OpenAI({ apiKey: openaiKey });
    const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o';
    const res = await client.chat.completions.create({
      model,
      max_tokens: 2500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${b64}` } },
          ],
        },
      ],
    });
    const text = String(res.choices[0]?.message?.content || '').trim();
    if (!text) return { kind: 'image', error: 'Vision model returned empty image analysis' };
    return {
      kind: 'image',
      text: truncate(text),
      usedVision: true,
      metadata: { format: 'image', mediaType, provider: 'openai', model },
    };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!isPlaceholderKey(anthropicKey)) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const model = process.env.ANTHROPIC_VISION_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    const res = await client.messages.create({
      model,
      max_tokens: 2500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType as any, data: b64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const block = res.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    if (!text) return { kind: 'image', error: 'Vision model returned empty image analysis' };
    return {
      kind: 'image',
      text: truncate(text),
      usedVision: true,
      metadata: { format: 'image', mediaType, provider: 'anthropic', model },
    };
  }

  return {
    kind: 'image',
    error:
      'Image uploaded, but vision/OCR is not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY so screenshots can be analyzed.',
    metadata: { format: 'image', mediaType },
  };
}

export async function extractDocument(file: {
  originalname?: string;
  mimetype?: string;
  buffer: Buffer;
}): Promise<ExtractResult> {
  const filename = file.originalname || 'file';
  const mimeType = file.mimetype || '';
  const kind = detectDocumentKind({ filename, mimeType });

  if (!file.buffer?.length) {
    return { kind, error: 'File is empty' };
  }

  try {
    switch (kind) {
      case 'unsupported':
        return {
          kind,
          error: `File type isn't supported yet (${mimeType || extname(filename) || 'unknown'}).`,
        };
      case 'image':
        return await extractImageWithVision(file.buffer, filename, mimeType);
      case 'docx':
        return await extractDocx(file.buffer);
      case 'pdf':
        return await extractPdf(file.buffer);
      case 'xlsx':
        return await extractSpreadsheet(file.buffer);
      case 'pptx':
        return await extractPptx(file.buffer);
      case 'csv':
      case 'json':
      case 'markdown':
      case 'code':
      case 'text':
      default: {
        const plain = await extractPlainText(file.buffer);
        return { ...plain, kind };
      }
    }
  } catch (err) {
    return {
      kind,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function ensureUploadDir(organizationId: string): string {
  const root = path.join(process.cwd(), 'data', 'chat-uploads', organizationId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function saveUploadBinary(organizationId: string, attachmentId: string, buffer: Buffer): string {
  const dir = ensureUploadDir(organizationId);
  const filePath = path.join(dir, attachmentId);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function readUploadBinary(organizationId: string, attachmentId: string): Buffer | null {
  const filePath = path.join(process.cwd(), 'data', 'chat-uploads', organizationId, attachmentId);
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}
