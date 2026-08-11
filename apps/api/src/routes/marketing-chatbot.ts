import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mammoth from 'mammoth';
import { answerMarketingQuestion, STARTER_PROMPTS } from '../chatbot/rag';
import { indexUploadedText, listIndexedDocs, reindexKnowledgeBase, isChatbotReady } from '../chatbot/indexer';
import { getChatAnalytics, recordChatTurn, recordSatisfaction } from '../chatbot/analytics';
import { requireAdmin } from '../middleware/auth';

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // pdf-parse v2 may export differently across installs
    const mod: any = await import('pdf-parse');
    const parse = mod.default || mod;
    const out = await parse(buffer);
    return String(out?.text || '');
  } catch {
    return '';
  }
}

export const marketingChatbotRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

marketingChatbotRouter.get('/suggestions', (_req, res) => {
  res.json({ success: true, data: { prompts: STARTER_PROMPTS }, error: null });
});

marketingChatbotRouter.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: { ready: isChatbotReady(), docs: listIndexedDocs().length },
    error: null,
  });
});

marketingChatbotRouter.post('/chat', async (req, res) => {
  const question = String(req.body?.message ?? req.body?.question ?? '').trim();
  if (!question) {
    res.status(400).json({ success: false, message: 'message is required', data: null, error: 'bad_request' });
    return;
  }

  const started = Date.now();
  try {
    const result = await answerMarketingQuestion(question);
    const latencyMs = Date.now() - started;
    recordChatTurn(question, result.ok, latencyMs);

    const stream = Boolean(req.body?.stream);
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const chunks = result.answer.match(/\S+\s*/g) ?? [result.answer];
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ type: 'token', text: chunk })}\n\n`);
        await new Promise((r) => setTimeout(r, 12));
      }
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          sources: result.sources,
          suggestions: result.suggestions,
          latencyMs,
          ok: result.ok,
        })}\n\n`
      );
      res.end();
      return;
    }

    res.json({
      success: true,
      data: {
        answer: result.answer,
        sources: result.sources,
        suggestions: result.suggestions,
        latencyMs,
        ok: result.ok,
      },
      error: null,
    });
  } catch (e: any) {
    recordChatTurn(question, false, Date.now() - started);
    res.status(500).json({ success: false, message: e?.message || 'chat failed', data: null, error: 'chat_failed' });
  }
});

marketingChatbotRouter.post('/feedback', (req, res) => {
  const up = Boolean(req.body?.up);
  recordSatisfaction(up);
  res.json({ success: true, data: { ok: true }, error: null });
});

/** Admin chatbot controls — mounted under /admin/chatbot with requireAdmin */
export const adminChatbotRouter = Router();
adminChatbotRouter.use(requireAdmin);

adminChatbotRouter.get('/docs', (_req, res) => {
  res.json({ success: true, data: { docs: listIndexedDocs(), ready: isChatbotReady() }, error: null });
});

adminChatbotRouter.post('/reindex', async (_req, res) => {
  try {
    const result = await reindexKnowledgeBase();
    res.json({ success: true, data: result, error: null });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message || 'reindex failed', data: null, error: 'reindex_failed' });
  }
});

adminChatbotRouter.get('/analytics', (_req, res) => {
  res.json({ success: true, data: getChatAnalytics(), error: null });
});

adminChatbotRouter.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'file required', data: null, error: 'bad_request' });
      return;
    }
    const name = req.file.originalname || 'upload.txt';
    const ext = path.extname(name).toLowerCase();
    let text = '';

    if (['.md', '.txt', '.markdown', '.csv', '.json'].includes(ext)) {
      text = req.file.buffer.toString('utf8');
    } else if (ext === '.docx') {
      const out = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = out.value;
    } else if (ext === '.pdf') {
      text = await extractPdfText(req.file.buffer);
      if (!text.trim()) text = `Uploaded PDF: ${name}. Text extraction unavailable — convert to Markdown for richer RAG.`;
    } else {
      // store raw + minimal index note
      const dir = path.resolve(process.cwd(), 'apps/api/data/chatbot-uploads');
      fs.mkdirSync(dir, { recursive: true });
      const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      fs.writeFileSync(path.join(dir, safe), req.file.buffer);
      text = `Uploaded binary document: ${name}. Filename indexed; convert to Markdown for richer RAG.`;
    }

    if (!text.trim()) {
      res.status(400).json({ success: false, message: 'No extractable text', data: null, error: 'empty' });
      return;
    }

    const saved = await indexUploadedText(name.replace(/\.[^.]+$/, '') + '.md', `# ${name}\n\n${text}`);
    res.json({ success: true, data: saved, error: null });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message || 'upload failed', data: null, error: 'upload_failed' });
  }
});
