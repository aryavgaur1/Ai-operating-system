import fs from 'fs';
import path from 'path';
import { InMemoryVectorStore, type VectorRecord } from '@enterprise-ai-os/stores';
import { embedBatch, embedText } from '@enterprise-ai-os/agent-core';

export type IndexedDocMeta = {
  id: string;
  source: string;
  title: string;
  type: 'knowledge' | 'upload' | 'site';
  chunkCount: number;
  updatedAt: string;
};

const NAMESPACE = 'marketing-chatbot';

let store = new InMemoryVectorStore();
let docs: IndexedDocMeta[] = [];
let ready = false;

function knowledgeRoots(): string[] {
  const roots = [
    path.resolve(process.cwd(), 'apps/api/knowledge'),
    path.resolve(process.cwd(), 'knowledge'),
    path.resolve(__dirname, '../../knowledge'),
  ];
  const uploads = [
    path.resolve(process.cwd(), 'apps/api/data/chatbot-uploads'),
    path.resolve(process.cwd(), 'data/chatbot-uploads'),
    path.resolve(__dirname, '../../data/chatbot-uploads'),
  ];
  return [...roots, ...uploads];
}

function ensureUploadDir(): string {
  const dir = path.resolve(process.cwd(), 'apps/api/data/chatbot-uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function chunkText(text: string, source: string, title: string): { id: string; text: string; title: string; source: string }[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: { id: string; text: string; title: string; source: string }[] = [];
  let buf = '';
  let idx = 0;
  for (const part of parts) {
    if ((buf + '\n\n' + part).length > 900 && buf) {
      chunks.push({ id: `${source}::${idx++}`, text: buf.trim(), title, source });
      buf = part;
    } else {
      buf = buf ? `${buf}\n\n${part}` : part;
    }
  }
  if (buf.trim()) chunks.push({ id: `${source}::${idx++}`, text: buf.trim(), title, source });
  return chunks;
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (/\.(md|txt|json|csv|markdown)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/** Pull string literals from marketing Next.js pages so new routes become searchable on reindex */
function extractSitePages(): { source: string; title: string; content: string }[] {
  const appDir = path.resolve(process.cwd(), 'apps/web/src/app');
  const marketing = ['features', 'pricing', 'integrations', 'enterprise', 'about', 'contact', 'docs', 'privacy', 'terms'];
  const out: { source: string; title: string; content: string }[] = [];
  for (const slug of marketing) {
    const file = path.join(appDir, slug, 'page.tsx');
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const strings = [...raw.matchAll(/['"`]((?:\\.|[^'`"\\]){12,})['"`]/g)]
      .map((m) => m[1]!.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((s) => /[a-zA-Z]/.test(s) && !s.includes('className') && !s.startsWith('http') && !s.includes('=>'));
    const unique = [...new Set(strings)].slice(0, 80);
    if (!unique.length) continue;
    out.push({
      source: `site:///${slug}`,
      title: `Marketing page /${slug}`,
      content: `# /${slug}\n\n${unique.join('\n')}`,
    });
  }
  // Landing component copy
  const landing = path.resolve(process.cwd(), 'apps/web/src/components/landing/LandingPage.tsx');
  if (fs.existsSync(landing)) {
    const raw = fs.readFileSync(landing, 'utf8');
    const strings = [...raw.matchAll(/['"`]((?:\\.|[^'`"\\]){16,})['"`]/g)]
      .map((m) => m[1]!.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((s) => /[a-zA-Z]/.test(s) && !s.includes('className') && !s.includes('rgba'));
    out.push({
      source: 'site:///landing',
      title: 'Landing page copy',
      content: `# Landing\n\n${[...new Set(strings)].slice(0, 120).join('\n')}`,
    });
  }
  return out;
}

function titleFromFile(file: string, content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1]!.trim();
  return path.basename(file).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

export function getChatbotStore() {
  return store;
}

export function listIndexedDocs() {
  return docs;
}

export function isChatbotReady() {
  return ready;
}

export async function reindexKnowledgeBase(): Promise<{ docs: number; chunks: number }> {
  ensureUploadDir();
  store = new InMemoryVectorStore();
  docs = [];
  const allChunks: { id: string; text: string; title: string; source: string; type: IndexedDocMeta['type'] }[] = [];

  for (const root of knowledgeRoots()) {
    const files = walkFiles(root);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const source = path.relative(process.cwd(), file).replace(/\\/g, '/');
      const title = titleFromFile(file, content);
      const type: IndexedDocMeta['type'] = source.includes('chatbot-uploads') ? 'upload' : 'knowledge';
      const pieces = chunkText(content, source, title);
      for (const p of pieces) allChunks.push({ ...p, type });
      docs.push({
        id: source,
        source,
        title,
        type,
        chunkCount: pieces.length,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // Auto-index marketing page / landing copy from the web app
  for (const page of extractSitePages()) {
    const pieces = chunkText(page.content, page.source, page.title);
    for (const p of pieces) allChunks.push({ ...p, type: 'site' });
    docs.push({
      id: page.source,
      source: page.source,
      title: page.title,
      type: 'site',
      chunkCount: pieces.length,
      updatedAt: new Date().toISOString(),
    });
  }

  // Site snapshot — always present so product copy is searchable even if files missing
  const siteSnapshot = SITE_SNAPSHOT;
  const siteChunks = chunkText(siteSnapshot, 'site://nexora-marketing', 'Nexora marketing site snapshot');
  for (const p of siteChunks) allChunks.push({ ...p, type: 'site' });
  docs.push({
    id: 'site://nexora-marketing',
    source: 'site://nexora-marketing',
    title: 'Nexora marketing site snapshot',
    type: 'site',
    chunkCount: siteChunks.length,
    updatedAt: new Date().toISOString(),
  });

  const embeddings = await embedBatch(allChunks.map((c) => c.text));
  const records: VectorRecord[] = allChunks.map((c, i) => ({
    id: c.id,
    text: c.text,
    embedding: embeddings[i]!,
    metadata: {
      namespace: NAMESPACE,
      source: c.source,
      title: c.title,
      type: c.type,
    },
  }));
  await store.upsert(records);
  ready = true;
  return { docs: docs.length, chunks: records.length };
}

export async function indexUploadedText(filename: string, content: string, type: IndexedDocMeta['type'] = 'upload') {
  const dir = ensureUploadDir();
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const full = path.join(dir, safe);
  fs.writeFileSync(full, content, 'utf8');
  await reindexKnowledgeBase();
  return { path: full, filename: safe };
}

export async function retrieveMarketingContext(query: string, topK = 6) {
  if (!ready) await reindexKnowledgeBase();
  const embedding = await embedText(query);
  const matches = await store.query(embedding, topK, { namespace: NAMESPACE });
  return matches.filter((m) => m.score > 0.05);
}

const SITE_SNAPSHOT = `
# Nexora marketing site

Hero: The AI Operating System for Modern Teams. Connect your apps. Understand your business. Execute work automatically. One AI. Unlimited possibilities.

CTAs: Start Free (/register), Book Demo (/login), Watch Demo (#commands).

Nav: Why Nexora (#features), Product (#product), Analysis (#analysis), Agents (#agents), Integrations (#integrations).

Sections: Global network, capability bento (Global Sync, Lightning Fast), integrations accordion, AI Agents living cards, How it works loop, Analytics control plane, Why Nexora glass stack (Memory, Reasoning, Tools, Approvals), Live commands, Product command surface, Testimonials (Aryav Gaur, Priyanshu Gupta BuilderFellows, Abhishek Sharma NextWave India, international agency voices), Pricing, FAQ, Final CTA.

Brand: NEXORA — AI Operating System. Dark premium glass UI.
`;
