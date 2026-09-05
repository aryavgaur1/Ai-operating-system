// ============================================================
// LLM Client / AI Gateway — reasoning + streaming for Nexora.
// Providers: anthropic | openai | google | mock (dev only).
// Never expose API keys to the browser — all calls are server-side.
// Production: never silently use Mock LLM; never surface raw provider JSON.
// ============================================================

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

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

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMClient {
  complete(messages: LLMMessage[]): Promise<string>;
  /** Yield text deltas. Default implementation completes then yields once. */
  stream(messages: LLMMessage[]): AsyncIterable<string>;
}

export type LLMProviderName = 'anthropic' | 'openai' | 'google' | 'mock';

export type LLMStatus = {
  provider: LLMProviderName;
  configured: boolean;
  productionSafe: boolean;
  reason?: string;
};

const USER_FACING_LLM_UNAVAILABLE =
  'Nexora AI is temporarily unavailable. The team has been notified to check the LLM API configuration.';

function isProductionLike(): boolean {
  const saas = String(process.env.SAAS_MODE ?? '').toLowerCase();
  if (saas === 'true' || saas === '1') return true;
  return String(process.env.NODE_ENV ?? '').toLowerCase() === 'production';
}

/** Reject empty / placeholder keys so we never call providers with junk credentials. */
export function isUsableApiKey(value?: string | null): boolean {
  if (!value) return false;
  const n = value.trim().toLowerCase();
  if (!n) return false;
  if (n.startsWith('<') || n.endsWith('>')) return false;
  if (n.includes('paste_your') || n.includes('your_') || n.includes('replace_me')) return false;
  if (n.includes('xxx') || n === 'changeme' || n === 'todo') return false;
  if (n.includes('example') || n.includes('placeholder')) return false;
  // Real keys are reasonably long
  if (value.trim().length < 20) return false;
  return true;
}

export function humanizeLlmError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();

  if (
    /authentication_error|invalid.?api.?key|incorrect api key|401|unauthorized|invalid_api_key|api key is invalid/i.test(
      raw
    )
  ) {
    return 'Nexora AI could not authenticate with the language model provider. Please update the LLM API key on the server, then retry.';
  }
  if (/rate.?limit|429|too many requests/i.test(raw)) {
    return 'Nexora AI is rate-limited right now. Please wait a moment and try again.';
  }
  if (/timeout|etimedout|econnreset|fetch failed|network/i.test(lower)) {
    return 'Nexora AI hit a network issue talking to the language model. Please try again.';
  }
  if (/LLM is not configured|no usable|LLM_PROVIDER/i.test(raw)) {
    return raw;
  }
  // Never dump provider JSON bodies into the chat UI
  if (/^\s*\d{3}\s*\{/.test(raw) || /"type"\s*:\s*"error"/.test(raw)) {
    return USER_FACING_LLM_UNAVAILABLE;
  }
  if (raw.length > 280) return USER_FACING_LLM_UNAVAILABLE;
  return raw.trim() || USER_FACING_LLM_UNAVAILABLE;
}

async function* onceStream(text: string): AsyncIterable<string> {
  if (text) yield text;
}

function wrapClient(client: LLMClient): LLMClient {
  return {
    async complete(messages) {
      try {
        return await client.complete(messages);
      } catch (err) {
        throw new Error(humanizeLlmError(err));
      }
    },
    async *stream(messages) {
      try {
        for await (const delta of client.stream(messages)) {
          yield delta;
        }
      } catch (err) {
        throw new Error(humanizeLlmError(err));
      }
    },
  };
}

export class MockLLMClient implements LLMClient {
  async complete(messages: LLMMessage[]): Promise<string> {
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content ?? '';
    if (/code|react|typescript|javascript|python|sql|debug|function/i.test(text)) {
      return [
        `Here's a concise coding answer for: "${text.slice(0, 100)}"`,
        '',
        '```ts',
        '// Example — replace with your real implementation',
        'export function example() {',
        '  return true;',
        '}',
        '```',
        '',
        '_Dev mock LLM — production must use a real provider key._',
      ].join('\n');
    }
    return [
      `Here's a helpful draft for: "${text.slice(0, 160)}"`,
      '',
      'I can help with general knowledge, coding, writing, planning, and — when connected — Slack/Notion/Jira actions.',
      '',
      '_Dev mock LLM — production must use a real provider key._',
    ].join('\n');
  }

  async *stream(messages: LLMMessage[]): AsyncIterable<string> {
    const full = await this.complete(messages);
    const chunk = Math.max(24, Math.floor(full.length / 12));
    for (let i = 0; i < full.length; i += chunk) {
      yield full.slice(i, i + chunk);
      await new Promise((r) => setTimeout(r, 15));
    }
  }
}

export class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey: string, private model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6') {
    if (!isUsableApiKey(apiKey)) throw new Error('ANTHROPIC_API_KEY is not set or is a placeholder.');
    this.client = new Anthropic({ apiKey: apiKey.trim() });
  }

  async complete(messages: LLMMessage[]): Promise<string> {
    const system = messages.find((m) => m.role === 'system')?.content;
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: rest,
    });

    const block = res.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  }

  async *stream(messages: LLMMessage[]): AsyncIterable<string> {
    const system = messages.find((m) => m.role === 'system')?.content;
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: rest,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}

export class OpenAILLMClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey: string, private model = process.env.OPENAI_MODEL ?? 'gpt-4o') {
    if (!isUsableApiKey(apiKey)) throw new Error('OPENAI_API_KEY is not set or is a placeholder.');
    this.client = new OpenAI({ apiKey: apiKey.trim() });
  }

  async complete(messages: LLMMessage[]): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return res.choices[0]?.message?.content ?? '';
  }

  async *stream(messages: LLMMessage[]): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

/** Google Gemini — uses GEMINI_API_KEY (preferred) or legacy GOOGLE_API_KEY. */
export class GoogleLLMClient implements LLMClient {
  constructor(
    private apiKey: string,
    private model = process.env.GOOGLE_MODEL ?? 'gemini-2.0-flash'
  ) {
    if (!isUsableApiKey(apiKey)) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is not set or is a placeholder.');
  }

  private toContents(messages: LLMMessage[]) {
    const system = messages.find((m) => m.role === 'system')?.content;
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    return { system, contents };
  }

  async complete(messages: LLMMessage[]): Promise<string> {
    const { system, contents } = this.toContents(messages);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey.trim())}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google LLM error ${res.status}: ${err.slice(0, 300)}`);
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  }

  async *stream(messages: LLMMessage[]): AsyncIterable<string> {
    yield* onceStream(await this.complete(messages));
  }
}

function buildClient(provider: LLMProviderName): LLMClient {
  switch (provider) {
    case 'anthropic':
      return new AnthropicLLMClient(process.env.ANTHROPIC_API_KEY ?? '');
    case 'openai':
      return new OpenAILLMClient(process.env.OPENAI_API_KEY ?? '');
    case 'google':
      return new GoogleLLMClient(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
    case 'mock':
    default:
      return new MockLLMClient();
  }
}

function keyFor(provider: Exclude<LLMProviderName, 'mock'>): string | undefined {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  if (provider === 'openai') return process.env.OPENAI_API_KEY;
  // Prefer GEMINI_API_KEY; keep GOOGLE_API_KEY as alias for older configs.
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

const PROVIDER_ORDER: Array<Exclude<LLMProviderName, 'mock'>> = ['anthropic', 'openai', 'google'];

/**
 * Resolve which provider to use.
 * - Honors LLM_PROVIDER when its key is usable
 * - Otherwise auto-picks the first provider with a real key
 * - Mock only when explicitly allowed (never the silent production default)
 */
export function resolveLLMStatus(): LLMStatus {
  const requestedRaw = (process.env.LLM_PROVIDER ?? '').trim().toLowerCase();
  const requested = !requestedRaw || requestedRaw === 'auto' ? 'auto' : requestedRaw;
  const allowMockExplicit = String(process.env.LLM_ALLOW_MOCK ?? '').toLowerCase() === 'true';

  if (requested === 'mock') {
    if (isProductionLike() && !allowMockExplicit) {
      return {
        provider: 'mock',
        configured: false,
        productionSafe: false,
        reason: 'LLM_PROVIDER=mock is not allowed in production without LLM_ALLOW_MOCK=true',
      };
    }
    return { provider: 'mock', configured: true, productionSafe: !isProductionLike(), reason: 'explicit mock' };
  }

  const tryProvider = (p: Exclude<LLMProviderName, 'mock'>): LLMStatus | null => {
    if (!isUsableApiKey(keyFor(p))) return null;
    return { provider: p, configured: true, productionSafe: true };
  };

  if (requested === 'anthropic' || requested === 'openai' || requested === 'google') {
    const hit = tryProvider(requested);
    if (hit) return hit;
  }
  if (requested === 'gemini') {
    const hit = tryProvider('google');
    if (hit) return hit;
  }

  for (const p of PROVIDER_ORDER) {
    const hit = tryProvider(p);
    if (hit) {
      return {
        ...hit,
        reason:
          requested !== 'auto' && requested !== p
            ? `requested ${requested} has no usable key; using ${p}`
            : undefined,
      };
    }
  }

  if (allowMockExplicit || (!isProductionLike() && requested === 'auto')) {
    return {
      provider: 'mock',
      configured: true,
      productionSafe: false,
      reason: 'no usable LLM API key — using mock in development',
    };
  }

  return {
    provider: 'anthropic',
    configured: false,
    productionSafe: false,
    reason: 'No usable ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY is configured',
  };
}

let instance: LLMClient | null = null;
let instanceProvider: LLMProviderName | null = null;

export function createLLMClient(): LLMClient {
  if (instance) return instance;

  const status = resolveLLMStatus();
  if (!status.configured || (isProductionLike() && status.provider === 'mock' && !status.productionSafe)) {
    throw new Error(
      status.reason ||
        'Nexora AI is not configured. Set a valid ANTHROPIC_API_KEY or OPENAI_API_KEY (and LLM_PROVIDER) on the API.'
    );
  }

  instance = wrapClient(buildClient(status.provider));
  instanceProvider = status.provider;
  return instance;
}

/**
 * On auth failure, rebuild with the next usable provider (real→real only — never mock in prod).
 * Returns null if no alternate exists.
 */
export function failoverLLMClient(failedProvider?: LLMProviderName): LLMClient | null {
  const failed = failedProvider || instanceProvider;
  const remaining = PROVIDER_ORDER.filter((p) => p !== failed && isUsableApiKey(keyFor(p)));
  if (!remaining.length) {
    instance = null;
    instanceProvider = null;
    return null;
  }
  const next = remaining[0];
  instance = wrapClient(buildClient(next));
  instanceProvider = next;
  return instance;
}

/** Reset the cached client — useful in tests or after rotating a key. */
export function resetLLMClient(): void {
  instance = null;
  instanceProvider = null;
}

export function getLLMProviderName(): string {
  return resolveLLMStatus().provider;
}

/** Run complete with one automatic real-provider failover on auth errors. */
export async function llmComplete(messages: LLMMessage[]): Promise<string> {
  const primary = createLLMClient();
  try {
    return await primary.complete(messages);
  } catch (err) {
    const msg = humanizeLlmError(err);
    if (!/authenticate|API key/i.test(msg)) throw new Error(msg);
    const next = failoverLLMClient();
    if (!next) throw new Error(msg);
    try {
      return await next.complete(messages);
    } catch (err2) {
      throw new Error(humanizeLlmError(err2));
    }
  }
}

/** Stream with one automatic real-provider failover on auth errors. */
export async function* llmStream(messages: LLMMessage[]): AsyncIterable<string> {
  const primary = createLLMClient();
  try {
    for await (const delta of primary.stream(messages)) {
      yield delta;
    }
  } catch (err) {
    const msg = humanizeLlmError(err);
    if (!/authenticate|API key/i.test(msg)) throw new Error(msg);
    const next = failoverLLMClient();
    if (!next) throw new Error(msg);
    for await (const delta of next.stream(messages)) {
      yield delta;
    }
  }
}
