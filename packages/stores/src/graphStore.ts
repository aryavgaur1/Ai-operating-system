import type { GraphNode, GraphEdge, GraphTraversalResult } from '@enterprise-ai-os/shared';

// ============================================================
// Knowledge Graph Store — maps entity relationships
// (Person -[ASSIGNED_TO]-> Issue -[PERTAINS_TO]-> Client) so the
// agent can answer relationship questions a pure vector search
// can't ("who else is on this account?", "what's blocking this
// project?").
//
// Defines the GraphStore interface plus an InMemoryGraphStore for
// zero-infra local development. Swap in a real Neo4j/Memgraph
// driver behind the same interface to go live — see
// createGraphStore() below.
// ============================================================

export interface GraphStore {
  upsertNode(node: GraphNode): Promise<void>;
  upsertEdge(edge: GraphEdge): Promise<void>;
  neighbors(nodeId: string, relationship?: string, depth?: number): Promise<GraphTraversalResult>;
  findNodesByLabel(label: string, propertyFilter?: Record<string, unknown>): Promise<GraphNode[]>;
}

export class InMemoryGraphStore implements GraphStore {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];

  async upsertNode(node: GraphNode): Promise<void> {
    this.nodes.set(node.id, node);
  }

  async upsertEdge(edge: GraphEdge): Promise<void> {
    const exists = this.edges.some(
      (e) => e.from === edge.from && e.to === edge.to && e.relationship === edge.relationship
    );
    if (!exists) this.edges.push(edge);
  }

  async neighbors(nodeId: string, relationship?: string, depth = 1): Promise<GraphTraversalResult> {
    const visitedNodeIds = new Set<string>([nodeId]);
    const collectedEdges: GraphEdge[] = [];
    let frontier = [nodeId];

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];
      for (const current of frontier) {
        const matching = this.edges.filter(
          (e) => (e.from === current || e.to === current) && (!relationship || e.relationship === relationship)
        );
        for (const e of matching) {
          collectedEdges.push(e);
          const other = e.from === current ? e.to : e.from;
          if (!visitedNodeIds.has(other)) {
            visitedNodeIds.add(other);
            nextFrontier.push(other);
          }
        }
      }
      frontier = nextFrontier;
    }

    const nodes = [...visitedNodeIds]
      .map((id) => this.nodes.get(id))
      .filter((n): n is GraphNode => Boolean(n));

    return { nodes, edges: collectedEdges };
  }

  async findNodesByLabel(label: string, propertyFilter?: Record<string, unknown>): Promise<GraphNode[]> {
    return [...this.nodes.values()].filter((n) => {
      if (n.label !== label) return false;
      if (!propertyFilter) return true;
      return Object.entries(propertyFilter).every(([k, v]) => n.properties[k] === v);
    });
  }
}

let instance: GraphStore | null = null;

export function createGraphStore(): GraphStore {
  if (instance) return instance;
  const provider = process.env.GRAPH_DB_PROVIDER ?? 'in-memory';
  switch (provider) {
    case 'neo4j':
      // TODO: return new Neo4jGraphStore(process.env.NEO4J_URI!, process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!)
      throw new Error('Neo4j provider not yet implemented — set GRAPH_DB_PROVIDER=in-memory for now.');
    case 'memgraph':
      // TODO: return new MemgraphGraphStore(...)
      throw new Error('Memgraph provider not yet implemented — set GRAPH_DB_PROVIDER=in-memory for now.');
    default:
      instance = new InMemoryGraphStore();
      return instance;
  }
}
