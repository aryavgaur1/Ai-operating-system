import type { VectorMatch } from '@enterprise-ai-os/shared';
import { getPool } from './postgres';

// ============================================================
// Vector Store — semantic search over unstructured text
// (Slack threads, emails, Notion pages, etc).
//
// This file defines the VectorStore interface every part of the
// system codes against, plus an InMemoryVectorStore so the agent
// loop is fully runnable with zero external infra.
//
// To go live: implement the same interface against Pinecone,
// Qdrant, or pgvector, and swap the instance created in
// createVectorStore() below. Nothing else in the codebase needs
// to change.
// ============================================================

export interface VectorRecord {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  query(embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<VectorMatch[]>;
  delete(ids: string[]): Promise<void>;
}

/** Simple cosine similarity — fine for a mock/demo store; a real
 * vector DB does this with an ANN index (HNSW/IVF) at scale. */
function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class InMemoryVectorStore implements VectorStore {
  private records: Map<string, VectorRecord> = new Map();

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const r of records) this.records.set(r.id, r);
  }

  async query(embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<VectorMatch[]> {
    const candidates = [...this.records.values()].filter((r) => {
      if (!filter) return true;
      return Object.entries(filter).every(([k, v]) => r.metadata[k] === v);
    });

    return candidates
      .map((r) => ({
        id: r.id,
        score: cosineSimilarity(embedding, r.embedding),
        text: r.text,
        metadata: r.metadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id);
  }
}

/** Real vector store backed by Postgres + the pgvector extension.
 * Requires db/schema.sql's `document_embeddings` table (vector(1536),
 * matching the OpenAI text-embedding-3-small dimension) and the
 * `vector` extension enabled — both provisioned by the docker-compose
 * Postgres image (pgvector/pgvector) + `npm run db:migrate`. */
export class PgVectorStore implements VectorStore {
  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const pool = getPool();
    for (const r of records) {
      const embeddingLiteral = `[${r.embedding.join(',')}]`;
      await pool.query(
        `insert into document_embeddings (id, text, embedding, metadata)
         values ($1, $2, $3::vector, $4)
         on conflict (id) do update set text = excluded.text, embedding = excluded.embedding, metadata = excluded.metadata`,
        [r.id, r.text, embeddingLiteral, r.metadata]
      );
    }
  }

  async query(embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<VectorMatch[]> {
    const pool = getPool();
    const embeddingLiteral = `[${embedding.join(',')}]`;

    const conditions: string[] = [];
    const params: unknown[] = [embeddingLiteral];
    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        params.push(value);
        conditions.push(`metadata ->> '${key}' = $${params.length}`);
      }
    }
    params.push(topK);
    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

    const result = await pool.query<{ id: string; text: string; metadata: Record<string, unknown>; distance: number }>(
      `select id, text, metadata, embedding <=> $1::vector as distance
       from document_embeddings
       ${whereClause}
       order by embedding <=> $1::vector asc
       limit $${params.length}`,
      params
    );

    // pgvector's <=> is cosine *distance*; convert to a similarity score
    // (1 - distance) so callers get the same 0..1-ish "higher is better"
    // shape the InMemoryVectorStore returns.
    return result.rows.map((row) => ({
      id: row.id,
      score: 1 - row.distance,
      text: row.text,
      metadata: row.metadata,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const pool = getPool();
    await pool.query('delete from document_embeddings where id = any($1)', [ids]);
  }
}

let instance: VectorStore | null = null;

export function createVectorStore(): VectorStore {
  if (instance) return instance;
  const provider = process.env.VECTOR_DB_PROVIDER ?? 'in-memory';
  switch (provider) {
    case 'pinecone':
      // TODO: return new PineconeVectorStore(process.env.PINECONE_API_KEY!, process.env.PINECONE_INDEX!)
      throw new Error('Pinecone provider not yet implemented — set VECTOR_DB_PROVIDER=in-memory for now.');
    case 'qdrant':
      // TODO: return new QdrantVectorStore(process.env.QDRANT_URL!)
      throw new Error('Qdrant provider not yet implemented — set VECTOR_DB_PROVIDER=in-memory for now.');
    case 'pgvector':
      instance = new PgVectorStore();
      return instance;
    default:
      instance = new InMemoryVectorStore();
      return instance;
  }
}
