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
app.use(express.json());

// Webhooks are unauthenticated at the RBAC layer (see routes/webhooks.ts
// for why) — mount before the `authenticate` middleware.
app.use('/webhooks', webhooksRouter);

app.use(authenticate);

app.get('/health', (_req, res) => res.json({ ok: true, service: 'enterprise-ai-os-api' }));

app.use('/chat', chatRouter);
app.use('/approvals', approvalsRouter);
app.use('/integrations', integrationsRouter);

const PORT = Number(process.env.PORT ?? 4000);

async function start() {
  const orgId = getDemoOrgId();
  seedDemoConnections(orgId);
  await bootstrapDemoData(orgId);
  startBatchPolling(orgId);

  app.listen(PORT, () => {
    console.log(`🚀 Enterprise AI OS API listening on http://localhost:${PORT}`);
    console.log(`   Try: curl -X POST http://localhost:${PORT}/chat -H "Content-Type: application/json" -d '{"message":"Why is Project Phoenix delayed?"}'`);
  });
}

start().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
