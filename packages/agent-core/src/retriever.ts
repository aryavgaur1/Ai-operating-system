import type { RetrievedContext, GraphTraversalResult } from '@enterprise-ai-os/shared';
import type { VectorStore } from '@enterprise-ai-os/stores';
import type { GraphStore } from '@enterprise-ai-os/stores';
import { embedText } from './embeddings';

// ============================================================
// Hybrid Context Retriever — combines vector search (relevant
// text snippets) with knowledge graph traversal (who is working
// on what, and how entities relate) so the agent can answer
// relationship-shaped questions a pure RAG pipeline misses, e.g.
// "Why is Project X delayed?" needs both the Slack message *and*
// the graph edge from Person -> ASSIGNED_TO -> Issue -> BLOCKS -> Project.
// ============================================================

const KNOWN_ENTITY_PATTERN = /\b([A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*)*)\b/g;

/** Very lightweight "NER": pull out capitalized phrases as candidate
 * entity names to look up in the graph. A production system would
 * use a proper NER model or the LLM's own entity-extraction pass. */
function extractCandidateEntities(query: string): string[] {
  const matches = query.match(KNOWN_ENTITY_PATTERN) ?? [];
  return [...new Set(matches.filter((m) => m.length > 2))];
}

export async function hybridRetrieve(
  query: string,
  organizationId: string,
  vectorStore: VectorStore,
  graphStore: GraphStore,
  topK = 5
): Promise<RetrievedContext> {
  const embedding = await embedText(query);
  const vectorMatches = await vectorStore.query(embedding, topK, { organizationId });

  const candidateEntities = extractCandidateEntities(query);
  const graphResults: GraphTraversalResult[] = [];

  for (const entity of candidateEntities) {
    const personNodes = await graphStore.findNodesByLabel('Person', { name: entity });
    const projectNodes = await graphStore.findNodesByLabel('Project', { name: entity });
    const clientNodes = await graphStore.findNodesByLabel('Client', { name: entity });
    const matchedNodes = [...personNodes, ...projectNodes, ...clientNodes];

    for (const node of matchedNodes) {
      const traversal = await graphStore.neighbors(node.id, undefined, 2);
      graphResults.push(traversal);
    }
  }

  // Merge traversal results, de-duplicating by node/edge identity.
  const nodeMap = new Map<string, GraphTraversalResult['nodes'][number]>();
  const edgeKey = (e: GraphTraversalResult['edges'][number]) => `${e.from}->${e.relationship}->${e.to}`;
  const edgeMap = new Map<string, GraphTraversalResult['edges'][number]>();

  for (const result of graphResults) {
    for (const node of result.nodes) nodeMap.set(node.id, node);
    for (const edge of result.edges) edgeMap.set(edgeKey(edge), edge);
  }

  return {
    vectorMatches,
    graph: { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] },
  };
}
