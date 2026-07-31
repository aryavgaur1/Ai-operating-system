import type { VectorStore, GraphStore } from '@enterprise-ai-os/stores';
import { allTools, getConnector } from '@enterprise-ai-os/connectors';
import { embedText } from './embeddings';

// ============================================================
// Demo seeding — pulls fixture documents out of every mock
// connector (as fetchRecent() would during a real batch-polling
// ingestion run), embeds them into the vector store, and derives
// a small knowledge graph (Person / Project / Client / Issue
// nodes + relationships) so hybridRetrieve() has something real
// to traverse.
//
// In production this logic lives in the ingestion pipeline
// (apps/api/src/ingestion/pipeline.ts) and runs continuously off
// webhooks + polling, not as a one-shot seed.
// ============================================================

const KNOWN_PEOPLE = ['priya', 'arjun', 'meera'];
const KNOWN_CLIENTS = ['Acme Corp'];
const KNOWN_PROJECTS = ['Project Phoenix'];

export async function seedDemoData(
  vectorStore: VectorStore,
  graphStore: GraphStore,
  organizationId: string
): Promise<void> {
  // ---- Graph: seed known entities ----
  for (const person of KNOWN_PEOPLE) {
    await graphStore.upsertNode({ id: `person:${person}`, label: 'Person', properties: { name: person } });
  }
  for (const client of KNOWN_CLIENTS) {
    await graphStore.upsertNode({ id: `client:${client}`, label: 'Client', properties: { name: client } });
  }
  for (const project of KNOWN_PROJECTS) {
    await graphStore.upsertNode({ id: `project:${project}`, label: 'Project', properties: { name: project } });
  }
  await graphStore.upsertEdge({ from: 'project:Project Phoenix', to: 'client:Acme Corp', relationship: 'PERTAINS_TO' });
  await graphStore.upsertEdge({ from: 'person:arjun', to: 'project:Project Phoenix', relationship: 'ASSIGNED_TO' });
  await graphStore.upsertEdge({ from: 'person:meera', to: 'project:Project Phoenix', relationship: 'ASSIGNED_TO' });
  await graphStore.upsertEdge({ from: 'person:priya', to: 'project:Project Phoenix', relationship: 'ASSIGNED_TO' });

  // ---- Vector store + per-document graph nodes ----
  for (const tool of allTools()) {
    const connector = getConnector(tool);
    let page;
    try {
      page = await connector.fetchRecent();
    } catch (err) {
      console.warn(`[seed] fetchRecent failed for ${tool}:`, err instanceof Error ? err.message : err);
      continue;
    }

    for (const doc of page.items) {
      await vectorStore.upsert([
        {
          id: `${tool}:${doc.externalId}`,
          text: doc.text,
          embedding: await embedText(doc.text),
          metadata: { organizationId, tool, url: doc.url, title: doc.title, resourceType: doc.resourceType },
        },
      ]);

      const docNodeId = `doc:${tool}:${doc.externalId}`;
      await graphStore.upsertNode({
        id: docNodeId,
        label: doc.resourceType === 'issue' ? 'Issue' : 'Document',
        properties: { title: doc.title, url: doc.url, tool },
      });

      const assignee = (doc.metadata as Record<string, unknown>).assignee as string | undefined;
      const user = (doc.metadata as Record<string, unknown>).user as string | undefined;
      const client = (doc.metadata as Record<string, unknown>).client as string | undefined;
      const owner = (doc.metadata as Record<string, unknown>).owner as string | undefined;

      const relatedPerson = assignee ?? user ?? owner;
      if (relatedPerson && KNOWN_PEOPLE.includes(relatedPerson)) {
        await graphStore.upsertEdge({ from: `person:${relatedPerson}`, to: docNodeId, relationship: 'AUTHORED_OR_OWNS' });
      }
      const relatedClient = client ?? (doc.metadata as Record<string, unknown>).account as string | undefined;
      if (relatedClient && KNOWN_CLIENTS.includes(relatedClient)) {
        await graphStore.upsertEdge({ from: docNodeId, to: `client:${relatedClient}`, relationship: 'PERTAINS_TO' });
      }
      await graphStore.upsertEdge({ from: docNodeId, to: 'project:Project Phoenix', relationship: 'RELATES_TO' });
    }
  }
}
