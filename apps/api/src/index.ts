import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { authenticate, getDemoOrgId } from './middleware/auth';
import { chatRouter } from './routes/chat';
import { approvalsRouter } from './routes/approvals';
import { integrationsRouter } from './routes/integrations';
import { webhooksRouter } from './routes/webhooks';
import { slackRouter, slackEventsRouter } from './routes/slack';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { oauthNotionRouter } from './routes/oauth-notion';
import { oauthSlackRouter } from './routes/oauth-slack';
import { conversationsRouter } from './routes/conversations';
import { dashboardRouter } from './routes/dashboard';
import { marketingChatbotRouter, adminChatbotRouter } from './routes/marketing-chatbot';
import { errorMiddleware } from './lib/errors';
import { isLiveMode } from '@enterprise-ai-os/connectors';
import { reindexKnowledgeBase } from './chatbot/indexer';

function loadEnvFromWorkspaceRoot(): void {
  const candidates = [process.cwd(), __dirname];
  for (const start of candidates) {
    let current = path.resolve(start);
    while (true) {
      const envPath = path.join(current, '.env');
      if (fs.existsSync(envPath)) {
        config({ path: envPath });
        return;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  config();
}

loadEnvFromWorkspaceRoot();

const SAAS_MODE = (process.env.SAAS_MODE ?? 'true') === 'true';
const WEB_APP_URL = (process.env.WEB_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const EXTRA_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

const app = express();
// Railway / Vercel / reverse proxies
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = new Set([
        WEB_APP_URL,
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        ...EXTRA_ORIGINS,
      ]);
      if (!origin) return cb(null, true);
      const normalized = origin.replace(/\/$/, '');
      if (allowed.has(normalized)) return cb(null, true);
      if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalized)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Never rate-limit Google OAuth redirects — a failed exchange + retries must not 429.
  skip: (req) => (req.originalUrl || req.url || '').includes('/auth/google/'),
});

const chatbotLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public webhooks / events
app.use('/webhooks', webhooksRouter);
app.use('/integrations/slack/events', slackEventsRouter);

// Auth (rate-limited)
app.use('/auth', authLimiter, authRouter);
app.use('/oauth/notion', oauthNotionRouter);
app.use('/oauth/slack', oauthSlackRouter);

app.get('/health', (_req, res) => res.json({ ok: true, service: 'enterprise-ai-os-api', saas: SAAS_MODE }));

// Public marketing AI assistant (RAG)
app.use('/marketing-chatbot', chatbotLimiter, marketingChatbotRouter);

// Authenticated app routes
app.use(authenticate);
app.use('/chat', chatRouter);
app.use('/approvals', approvalsRouter);
app.use('/integrations/slack', slackRouter);
app.use('/integrations', integrationsRouter);
app.use('/conversations', conversationsRouter);
app.use('/dashboard', dashboardRouter);
app.use('/admin/chatbot', adminChatbotRouter);
app.use('/admin', adminRouter);

app.use(errorMiddleware);

const PORT = Number(process.env.PORT ?? 4000);

async function start() {
  try {
    const indexed = await reindexKnowledgeBase();
    console.log(`📚 Marketing chatbot indexed ${indexed.docs} docs / ${indexed.chunks} chunks`);
  } catch (err) {
    console.warn('Marketing chatbot index deferred:', err);
  }

  if (!SAAS_MODE) {
    const { seedDemoConnections } = await import('./auth/oauth');
    const { bootstrapDemoData, startBatchPolling } = await import('./ingestion/pipeline');
    const orgId = getDemoOrgId();
    seedDemoConnections(orgId);
    await bootstrapDemoData(orgId);
    startBatchPolling(orgId);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Nexora OS API listening on http://localhost:${PORT}`);
    console.log(`   SAAS_MODE=${SAAS_MODE}`);
    console.log(`   Slack mode: ${isLiveMode('slack') ? 'LIVE' : 'mock'}`);
    console.log(`   Notion mode: ${isLiveMode('notion') ? 'LIVE' : 'mock'}`);
  });
}

start().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
