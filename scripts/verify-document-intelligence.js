/**
 * Document intelligence regression suite.
 * Run after build:api: node scripts/verify-document-intelligence.js
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const root = path.join(__dirname, '..');
const requireRoot = createRequire(path.join(root, 'package.json'));

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok ', msg);
  }
}

function loadDocIntel() {
  const candidates = [
    path.join(root, 'apps/api/dist/lib/documentIntelligence.js'),
    path.join(root, 'apps/api/src/lib/documentIntelligence.ts'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && p.endsWith('.js')) {
      return require(p);
    }
  }
  throw new Error('Build API first (apps/api/dist/lib/documentIntelligence.js missing)');
}

function loadAiService() {
  const p = path.join(root, 'packages/agent-core/dist/aiService/index.js');
  if (!fs.existsSync(p)) throw new Error('Build agent-core first');
  return require(p);
}

function loadRouting() {
  return require(path.join(root, 'packages/agent-core/dist/os/routingPolicy.js'));
}

/** Minimal 1x1 PNG */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Minimal JPEG */
const JPG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  'base64'
);

function minimalPdf(text) {
  // Tiny valid-ish PDF with a text stream (pdf-parse may still extract)
  const stream = `BT /F1 12 Tf 100 700 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
  objects.push(
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n'
  );
  objects.push(
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`
  );
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'utf8');
}

async function buildDocx(paragraph) {
  const JSZip = requireRoot('jszip');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder('_rels').file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder('word').file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p></w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildPptx(slideText) {
  const JSZip = requireRoot('jszip');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`
  );
  zip.folder('ppt').folder('slides').file(
    'slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>${slideText}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`
  );
  zip.folder('ppt').file('presentation.xml', `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function buildXlsx() {
  const XLSX = requireRoot('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Region', 'Revenue'],
    ['West', 120],
    ['East', 90],
    ['North', 150],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sales');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Mirror of attachment retrieval isolation filter (must match attachmentStore). */
function filterAttachmentHits(matches, input) {
  if (!input.attachmentIds?.length) return [];
  return matches.filter((m) => {
    const meta = m.metadata || {};
    if (meta.source !== 'chat_attachment') return false;
    if (meta.organizationId !== input.organizationId) return false;
    if (meta.userId !== input.userId) return false;
    if (!input.attachmentIds.includes(String(meta.attachmentId))) return false;
    return true;
  });
}

async function main() {
  const doc = loadDocIntel();
  const { wantsDocumentAnalysis, wantsWorkspaceTools } = loadAiService();
  const { resolveAuthoritativeRoute } = loadRouting();

  // --- Detection ---
  assert(doc.detectDocumentKind({ filename: 'shot.png', mimeType: 'image/png' }) === 'image', 'PNG kind');
  assert(doc.detectDocumentKind({ filename: 'shot.jpg', mimeType: 'image/jpeg' }) === 'image', 'JPG kind');
  assert(doc.detectDocumentKind({ filename: 'a.pdf', mimeType: 'application/pdf' }) === 'pdf', 'PDF kind');
  assert(doc.detectDocumentKind({ filename: 'a.docx' }) === 'docx', 'DOCX kind by ext');
  assert(doc.detectDocumentKind({ filename: 'a.xlsx' }) === 'xlsx', 'XLSX kind');
  assert(doc.detectDocumentKind({ filename: 'a.csv' }) === 'csv', 'CSV kind');
  assert(doc.detectDocumentKind({ filename: 'a.pptx' }) === 'pptx', 'PPTX kind');
  assert(doc.detectDocumentKind({ filename: 'a.txt' }) === 'text', 'TXT kind');
  assert(doc.detectDocumentKind({ filename: 'a.md' }) === 'markdown', 'MD kind');
  assert(doc.detectDocumentKind({ filename: 'virus.exe' }) === 'unsupported', 'unsupported ext');
  assert(
    doc.detectDocumentKind({ filename: 'report.bin', mimeType: 'application/pdf' }) === 'pdf',
    'MIME preferred over weird ext'
  );

  // --- Extractions ---
  {
    const r = await doc.extractDocument({
      originalname: 'notes.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from('Launch date is March 12. Risks: supply, hiring, budget.', 'utf8'),
    });
    assert(r.kind === 'text' && /March 12/.test(r.text || ''), 'TXT extract');
  }
  {
    const r = await doc.extractDocument({
      originalname: 'readme.md',
      mimetype: 'text/markdown',
      buffer: Buffer.from('# Policy\n\nApproval requires two managers.', 'utf8'),
    });
    assert(r.kind === 'markdown' && /two managers/.test(r.text || ''), 'Markdown extract');
  }
  {
    const r = await doc.extractDocument({
      originalname: 'sales.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('Region,Revenue\nWest,100\nEast,80\n', 'utf8'),
    });
    assert(r.kind === 'csv' && /West/.test(r.text || ''), 'CSV extract');
  }
  {
    const xlsxBuf = buildXlsx();
    const r = await doc.extractDocument({
      originalname: 'q1.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuf,
    });
    assert(r.kind === 'xlsx' && /North/.test(r.text || '') && /Sheet: Sales/.test(r.text || ''), 'XLSX extract preserves sheets');
  }
  {
    const docxBuf = await buildDocx('Approval process: manager then finance.');
    const r = await doc.extractDocument({
      originalname: 'policy.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBuf,
    });
    assert(r.kind === 'docx' && /manager then finance/.test(r.text || ''), 'DOCX extract');
  }
  {
    const pptxBuf = await buildPptx('Q4 roadmap and launch risks');
    const r = await doc.extractDocument({
      originalname: 'deck.pptx',
      mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      buffer: pptxBuf,
    });
    assert(r.kind === 'pptx' && /Slide 1/.test(r.text || '') && /Q4 roadmap/.test(r.text || ''), 'PPTX extract slide boundaries');
  }
  {
    const pdfBuf = minimalPdf('Major deadline is June 1');
    const r = await doc.extractDocument({
      originalname: 'plan.pdf',
      mimetype: 'application/pdf',
      buffer: pdfBuf,
    });
    // pdf-parse may fail on synthetic PDF — accept either text or honest error
    assert(
      r.kind === 'pdf' && (Boolean(r.text?.trim()) || Boolean(r.error)),
      `PDF extract returns text or honest error (got text=${Boolean(r.text)} err=${r.error || ''})`
    );
    if (r.text) assert(/June|deadline/i.test(r.text), 'PDF text contains deadline when extractable');
  }

  // Images — without API keys must fail honestly (no fake OCR)
  {
    const prevO = process.env.OPENAI_API_KEY;
    const prevA = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    const png = await doc.extractDocument({
      originalname: 'error.png',
      mimetype: 'image/png',
      buffer: PNG_1X1,
    });
    assert(png.kind === 'image' && png.error && /vision|OCR|not configured/i.test(png.error), 'PNG without keys → honest vision error');
    assert(!png.text, 'PNG without keys → no fake OCR text');
    const jpg = await doc.extractDocument({
      originalname: 'error.jpg',
      mimetype: 'image/jpeg',
      buffer: JPG_1X1,
    });
    assert(jpg.kind === 'image' && jpg.error, 'JPG without keys → honest error');
    process.env.OPENAI_API_KEY = prevO;
    process.env.ANTHROPIC_API_KEY = prevA;
  }

  // Empty / corrupt / unsupported
  {
    const empty = await doc.extractDocument({
      originalname: 'empty.txt',
      mimetype: 'text/plain',
      buffer: Buffer.alloc(0),
    });
    assert(empty.error && /empty/i.test(empty.error), 'empty file error');
  }
  {
    const bad = await doc.extractDocument({
      originalname: 'broken.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-not-really', 'utf8'),
    });
    assert(bad.kind === 'pdf' && (bad.error || !bad.text), 'corrupt PDF → error or no text');
  }
  {
    const un = await doc.extractDocument({
      originalname: 'thing.exe',
      mimetype: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    });
    assert(un.kind === 'unsupported' && /supported/i.test(un.error || ''), 'unsupported format message');
  }

  // Chunking
  {
    const long = 'A'.repeat(5000) + '\n\nSection B\n' + 'B'.repeat(3000);
    const chunks = doc.chunkDocumentText(long, { sourceLabel: 'report.pdf' });
    assert(chunks.length > 1, 'large doc chunks into multiple sections');
    assert(chunks.every((c) => c.label.includes('report.pdf')), 'chunk labels preserve source');
  }

  // Document Q&A preference vs action routing
  const att = [{ id: '1', filename: 'q4.pdf', text: 'revenue west' }];
  assert(wantsDocumentAnalysis('Summarize this.', att) === true, 'summarize → document analysis');
  assert(wantsDocumentAnalysis("What's wrong here?", att) === true, 'screenshot Q → document analysis');
  assert(wantsDocumentAnalysis('Which region performed best?', att) === true, 'follow-up → document analysis');
  assert(wantsDocumentAnalysis('Create a launch war room', att) === false, 'war room not hijacked by docs');
  assert(wantsWorkspaceTools('Create a launch war room') === true, 'war room still wants workspace tools');
  assert(wantsDocumentAnalysis('Find my important emails', att) === false, 'gmail not hijacked');
  assert(wantsDocumentAnalysis('Create a Jira ticket for login bug', att) === false, 'jira not hijacked');
  assert(wantsDocumentAnalysis('Create a Notion document', att) === false, 'notion not hijacked');
  assert(wantsDocumentAnalysis('hello', []) === false, 'no attachment → no doc mode');

  // Action OS routing regressions (no attachment path)
  const routes = [
    ['Create a launch war room', 'slack'],
    ['Find my important emails', 'gmail'],
    ['Create a Jira ticket for the auth bug', 'jira'],
    ['Create a Notion document about onboarding', 'notion'],
  ];
  for (const [q, tool] of routes) {
    const r = resolveAuthoritativeRoute(q);
    assert(
      String(r.lockedTool || r.family || '').toLowerCase().includes(tool) ||
        String(r.family || '').toLowerCase().includes(tool),
      `action route "${q}" → ${tool} (got family=${r.family} tool=${r.lockedTool})`
    );
  }

  // Workspace isolation filter
  const corpus = [
    {
      text: 'personal secret',
      metadata: {
        source: 'chat_attachment',
        organizationId: 'org-personal',
        userId: 'user-a',
        attachmentId: 'att-1',
      },
      score: 0.9,
    },
    {
      text: 'team doc',
      metadata: {
        source: 'chat_attachment',
        organizationId: 'org-team',
        userId: 'user-b',
        attachmentId: 'att-2',
      },
      score: 0.95,
    },
    {
      text: 'other user same org',
      metadata: {
        source: 'chat_attachment',
        organizationId: 'org-team',
        userId: 'user-c',
        attachmentId: 'att-3',
      },
      score: 0.92,
    },
  ];

  assert(
    filterAttachmentHits(corpus, {
      organizationId: 'org-personal',
      userId: 'user-a',
      attachmentIds: ['att-1'],
    }).length === 1 &&
      filterAttachmentHits(corpus, {
        organizationId: 'org-personal',
        userId: 'user-a',
        attachmentIds: ['att-1'],
      })[0].text === 'personal secret',
    'personal workspace retrieval scoped to owner'
  );
  assert(
    filterAttachmentHits(corpus, {
      organizationId: 'org-team',
      userId: 'user-b',
      attachmentIds: ['att-2'],
    }).length === 1 &&
      filterAttachmentHits(corpus, {
        organizationId: 'org-team',
        userId: 'user-b',
        attachmentIds: ['att-2'],
      })[0].text === 'team doc',
    'team member only sees own attachment rows (userId gate)'
  );
  assert(
    filterAttachmentHits(corpus, {
      organizationId: 'org-team',
      userId: 'user-b',
      attachmentIds: ['att-3'],
    }).length === 0,
    'cannot retrieve another user attachment id'
  );
  assert(
    filterAttachmentHits(corpus, {
      organizationId: 'org-team',
      userId: 'user-removed',
      attachmentIds: ['att-2'],
    }).length === 0,
    'removed/unauthorized user gets nothing'
  );
  assert(
    filterAttachmentHits(corpus, {
      organizationId: 'org-evil',
      userId: 'user-a',
      attachmentIds: ['att-1'],
    }).length === 0,
    'cross-org retrieval rejected'
  );
  assert(
    filterAttachmentHits(corpus, {
      organizationId: 'org-personal',
      userId: 'user-a',
      attachmentIds: [],
    }).length === 0,
    'empty attachmentIds → no retrieval (fast path)'
  );

  // Multiple files context preference
  const multi = [
    { id: 'q1', filename: 'Q1.xlsx', text: 'q1' },
    { id: 'q2', filename: 'Q2.xlsx', text: 'q2' },
    { id: 'q3', filename: 'Q3.xlsx', text: 'q3' },
  ];
  assert(wantsDocumentAnalysis('Compare Q1, Q2 and Q3.', multi) === true, 'multi-file compare → document analysis');

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll document intelligence checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
