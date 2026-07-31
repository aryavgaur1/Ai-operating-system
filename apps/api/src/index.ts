import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';
import { authenticate, getDemoOrgId } from './middleware/auth';
import { seedDemoConnections } from './auth/oauth';
import { bootstrapDemoData, startBatchPolling } from './ingestion/pipeline';
import { chatRouter } from './routes/chat';
import { approvalsRouter } from './routes/approvals';
import { integrationsRouter } from './routes/integrations';
import { webhooksRouter } from './routes/webhooks';
import { slackRouter, slackEventsRouter } from './routes/slack';
import { errorMiddleware } from './lib/errors';
import { isLiveMode, slackService } from '@enterprise-ai-os/connectors';
import { upsertSlackInstallation } from '@enterprise-ai-os/stores';

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

const app = express();
app.use(cors());

// Preserve raw body for Slack signature verification (Events API).
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);

// Webhooks are unauthenticated at the RBAC layer (see routes/webhooks.ts
// for why) — mount before the `authenticate` middleware.
app.use('/webhooks', webhooksRouter);

// Slack Events API must be reachable without our session auth.
app.use('/integrations/slack/events', slackEventsRouter);

app.use(authenticate);

app.get('/health', (_req, res) => res.json({ ok: true, service: 'enterprise-ai-os-api' }));

app.use('/chat', chatRouter);
app.use('/approvals', approvalsRouter);
app.use('/integrations/slack', slackRouter);
app.use('/integrations', integrationsRouter);

app.use(errorMiddleware);

const PORT = Number(process.env.PORT ?? 4000);

async function bootstrapSlackInstallation(orgId: string): Promise<void> {
  if (!isLiveMode('slack')) return;
  try {
    slackService.initializeClient();
    const info = await slackService.authTest();
    await upsertSlackInstallation({
      organizationId: orgId,
      teamId: info.teamId,
      teamName: info.teamName,
      botUserId: info.botUserId,
      appId: process.env.SLACK_APP_ID,
      status: 'active',
      metadata: { url: info.url, bootstrappedAt: new Date().toISOString() },
    });
    console.log(`✅ Slack live connected to workspace: ${info.teamName ?? info.teamId}`);
  } catch (err) {
    console.warn('⚠️  Slack live mode enabled but auth.test failed:', err instanceof Error ? err.message : err);
  }
}

async function start() {
  const orgId = getDemoOrgId();
  seedDemoConnections(orgId);
  await bootstrapDemoData(orgId);
  await bootstrapSlackInstallation(orgId);
  startBatchPolling(orgId);

  app.listen(PORT, () => {
    console.log(`🚀 Enterprise AI OS API listening on http://localhost:${PORT}`);
    console.log(`   Slack mode: ${isLiveMode('slack') ? 'LIVE' : 'mock'}`);
    console.log(`   Try: curl -X POST http://localhost:${PORT}/chat -H "Content-Type: application/json" -d '{"message":"Why is Project Phoenix delayed?"}'`);
  });
}

start().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
