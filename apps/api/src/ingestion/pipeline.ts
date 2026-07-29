import type { ToolName } from '@enterprise-ai-os/shared';
import { createVectorStore, createGraphStore } from '@enterprise-ai-os/stores';
import { getConnector, allTools } from '@enterprise-ai-os/connectors';
import { embedText, seedDemoData } from '@enterprise-ai-os/agent-core';

// ============================================================
// Ingestion Pipeline — Phase 1 of the architecture:
//   - Event-Driven Webhooks: real-time sync for Slack messages,
//     Jira updates, Salesforce edits (handleWebhookEvent below).
//   - Batch Polling: periodic incremental backfill for documents
//     that have no webhook (Notion, and a periodic reconciliation
//     pass for everything else) — startBatchPolling below.
// ============================================================

const vectorStore = createVectorStore();
const graphStore = createGraphStore();

export async function handleWebhookEvent(tool: ToolName, organizationId: string, payload: unknown) {
  const connector = getConnector(tool);
  const docs = await connector.handleWebhook(payload);

  for (const doc of docs) {
    await vectorStore.upsert([
      {
        id: `${tool}:${doc.externalId}`,
        text: doc.text,
        embedding: await embedText(doc.text),
        metadata: { organizationId, tool, url: doc.url, title: doc.title, resourceType: doc.resourceType },
      },
    ]);
    // A production pipeline would also upsert/refresh the corresponding
    // graph node + edges here (see packages/agent-core/src/seed.ts for
    // the entity-linking pattern), and persist doc metadata into the
    // `documents` Postgres table for auditability.
  }

  return { ingested: docs.length };
}

let pollingHandle: NodeJS.Timeout | null = null;

export function startBatchPolling(organizationId: string, intervalMs = 60_000): void {
  if (pollingHandle) return;
  pollingHandle = setInterval(async () => {
    for (const tool of allTools()) {
      try {
        const connector = getConnector(tool);
        const page = await connector.fetchRecent();
        for (const doc of page.items) {
          await vectorStore.upsert([
            {
              id: `${tool}:${doc.externalId}`,
              text: doc.text,
              embedding: await embedText(doc.text),
              metadata: { organizationId, tool, url: doc.url, title: doc.title, resourceType: doc.resourceType },
            },
          ]);
        }
      } catch (err) {
        console.error(`[ingestion] batch poll failed for ${tool}:`, err);
      }
    }
  }, intervalMs);
}

export function stopBatchPolling(): void {
  if (pollingHandle) clearInterval(pollingHandle);
  pollingHandle = null;
}

/** Run once at server startup so the demo has data to query immediately. */
export async function bootstrapDemoData(organizationId: string): Promise<void> {
  await seedDemoData(vectorStore, graphStore, organizationId);
}

export function getStores() {
  return { vectorStore, graphStore };
}
