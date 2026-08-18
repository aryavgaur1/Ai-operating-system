import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { authenticate } from './middleware/auth';
import { chatRouter } from './routes/chat';
import { approvalsRouter } from './routes/approvals';
import { integrationsRouter } from './routes/integrations';
import { webhooksRouter } from './routes/webhooks';
import { slackRouter, slackEventsRouter } from './routes/slack';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { oauthNotionRouter } from './routes/oauth-notion';
import { oauthSlackRouter } from './routes/oauth-slack';
import { oauthJiraRouter } from './routes/oauth-jira';
import { conversationsRouter } from './routes/conversations';
import { dashboardRouter } from './routes/dashboard';
import { workspacesRouter } from './routes/workspaces';
import { invitationsAuthRouter, invitationsPublicRouter } from './routes/invitations';
import { errorMiddleware } from './lib/errors';
import { isLiveMode } from '@enterprise-ai-os/connectors';

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
const WEB_APP_URL_RAW = (
  process.env.WEB_APP_URL ??
  (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production'
    ? 'https://ai-lilac-phi.vercel.app'
    : 'http://localhost:3000')
).replace(/\/$/, '');
// Never treat retired Netlify as the canonical web origin.
const WEB_APP_URL = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(WEB_APP_URL_RAW)
  ? 'https://ai-lilac-phi.vercel.app'
  : WEB_APP_URL_RAW;
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
      if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(normalized)) return cb(null, true);
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

// Public webhooks / events
app.use('/webhooks', webhooksRouter);
app.use('/integrations/slack/events', slackEventsRouter);

// Auth (rate-limited)
app.use('/auth', authLimiter, authRouter);
app.use('/oauth/notion', oauthNotionRouter);
app.use('/oauth/slack', oauthSlackRouter);
app.use('/oauth/jira', oauthJiraRouter);

app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    service: 'enterprise-ai-os-api',
    saas: SAAS_MODE,
    commit:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      process.env.COMMIT_REF ||
      null,
    deployedAt: process.env.RAILWAY_DEPLOYMENT_ID || null,
  })
);

/**
 * One-shot founder bootstrap: attach platform NOTION_API_KEY to founder user rows.
 * Requires header x-bootstrap-secret == NOTION_BOOTSTRAP_SECRET. Remove the secret after use.
 */
app.post('/internal/bootstrap-notion', async (req, res) => {
  try {
    const expected = process.env.NOTION_BOOTSTRAP_SECRET?.trim();
    const provided = String(req.header('x-bootstrap-secret') || req.body?.secret || '').trim();
    if (!expected || !provided || provided !== expected) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    const notionToken = process.env.NOTION_API_KEY?.trim();
    if (!notionToken) {
      res.status(500).json({ ok: false, error: 'NOTION_API_KEY missing on server' });
      return;
    }
    const meRes = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
      },
    });
    if (!meRes.ok) {
      res.status(502).json({ ok: false, error: 'Notion token invalid on server' });
      return;
    }
    const me = (await meRes.json()) as {
      name?: string;
      bot?: { workspace_name?: string };
    };
    const workspaceName = me.bot?.workspace_name || me.name || 'Notion workspace';
    const { query, storeConnection } = await import('@enterprise-ai-os/stores');
    const users = await query<{ id: string; email: string; organization_id: string }>(
      `select id, email, organization_id from users
       where lower(email) in ('aryavgaur1@gmail.com', 'aryavgaur01@gmail.com')
       order by created_at asc`
    );
    if (!users.rows.length) {
      res.status(404).json({ ok: false, error: 'founder user not found' });
      return;
    }
    const connected: string[] = [];
    for (const u of users.rows) {
      await storeConnection(u.organization_id, 'notion', notionToken, {
        userId: u.id,
        metadata: {
          workspaceName,
          connectedAt: new Date().toISOString(),
          method: 'internal_token_bootstrap_endpoint',
        },
      });
      connected.push(u.email);
    }
    res.json({ ok: true, workspaceName, connected });
  } catch (err) {
    console.error('[bootstrap-notion]', err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'bootstrap failed' });
  }
});

// Public invitation preview (no auth) — never returns token_hash
app.use('/invitations', invitationsPublicRouter);

// Authenticated app routes
app.use(authenticate);
app.use('/chat', chatRouter);
app.use('/approvals', approvalsRouter);
app.use('/integrations/slack', slackRouter);
app.use('/integrations', integrationsRouter);
app.use('/conversations', conversationsRouter);
app.use('/dashboard', dashboardRouter);
app.use('/workspaces', workspacesRouter);
app.use('/invitations', invitationsAuthRouter);
app.use('/admin', adminRouter);

app.use(errorMiddleware);

const PORT = Number(process.env.PORT ?? 4000);

async function start() {
  if (!SAAS_MODE) {
    console.warn('[api] SAAS_MODE=false — demo connection seeding and mock ingestion are disabled. Connect real tools via OAuth.');
  }

  app.listen(PORT, () => {
    console.log(`🚀 Nexora OS API listening on http://localhost:${PORT}`);
    console.log(`   SAAS_MODE=${SAAS_MODE}`);
    console.log(`   Slack mode: ${isLiveMode('slack') ? 'LIVE' : 'not connected'}`);
    console.log(`   Notion mode: ${isLiveMode('notion') ? 'LIVE' : 'not connected'}`);
    console.log(`   Jira mode: ${isLiveMode('jira') ? 'LIVE' : 'not connected'}`);
  });
}

start().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
