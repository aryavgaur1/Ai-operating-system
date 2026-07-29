// ============================================================
// Embeddings — turns text into vectors for semantic search.
// Real implementation calls OpenAI's embedding API. Falls back to
// a deterministic hashed embedding when EMBEDDING_PROVIDER=mock
// (or no OPENAI_API_KEY is set) so local dev never hard-fails.
// ============================================================

import OpenAI from 'openai';

export const EMBEDDING_DIMENSIONS = 1536; // text-embedding-3-small

const MOCK_DIMENSIONS = EMBEDDING_DIMENSIONS;

let client: OpenAI | null = null;

function isPlaceholderApiKey(value?: string): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized === '' || normalized.startsWith('<') || normalized.includes('paste_your') || normalized.includes('your_') || normalized.includes('replace_me');
}

function getClient(): OpenAI | null {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (isPlaceholderApiKey(apiKey)) return null;

  client = new OpenAI({ apiKey });
  return client;
}

function mockEmbed(text: string): number[] {
  const vector = new Array(MOCK_DIMENSIONS).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
    }
    vector[hash % MOCK_DIMENSIONS] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

/** Embed a single string. Batches internally are not needed at this call size. */
export async function embedText(text: string): Promise<number[]> {
  const provider = process.env.EMBEDDING_PROVIDER ?? 'mock';
  if (provider === 'mock') return mockEmbed(text);

  const realClient = getClient();
  if (!realClient) return mockEmbed(text);

  const res = await realClient.embeddings.create({
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

/** Embed many strings in one API call — use this for ingestion pipelines. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const provider = process.env.EMBEDDING_PROVIDER ?? 'mock';
  if (provider === 'mock') return texts.map(mockEmbed);

  const realClient = getClient();
  if (!realClient) return texts.map(mockEmbed);

  const res = await realClient.embeddings.create({
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}
