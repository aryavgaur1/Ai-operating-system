// ============================================================
// LLM Client / AI Gateway — reasoning + streaming for Nexora.
 // Providers: mock | anthropic | openai | google (stub until key set).
 // Never expose API keys to the browser — all calls are server-side.
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

async function* onceStream(text: string): AsyncIterable<string> {
  if (text) yield text;
}

export class MockLLMClient implements LLMClient {
  async complete(messages: LLMMessage[]): Promise<string> {
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content ?? '';
    // General-purpose mock: still useful offline
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
        '_Mock LLM — set LLM_PROVIDER=openai|anthropic for live answers._',
      ].join('\n');
    }
    return [
      `Here's a helpful draft for: "${text.slice(0, 160)}"`,
      '',
      'I can help with general knowledge, coding, writing, planning, and — when connected — Slack/Notion/Jira actions.',
      '',
      '_Mock LLM — set LLM_PROVIDER=openai|anthropic for live answers._',
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
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
    this.client = new Anthropic({ apiKey });
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
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
    this.client = new OpenAI({ apiKey });
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

/** Google Gemini stub — activates when GOOGLE_API_KEY is set; otherwise falls back to mock text. */
export class GoogleLLMClient implements LLMClient {
  constructor(
    private apiKey: string,
    private model = process.env.GOOGLE_MODEL ?? 'gemini-2.0-flash'
  ) {
    if (!apiKey) throw new Error('GOOGLE_API_KEY is not set.');
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
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
    // Streaming REST varies by version — complete then yield for reliability.
    yield* onceStream(await this.complete(messages));
  }
}

let instance: LLMClient | null = null;

export function createLLMClient(): LLMClient {
  if (instance) return instance;
  const provider = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  switch (provider) {
    case 'anthropic':
      instance = new AnthropicLLMClient(process.env.ANTHROPIC_API_KEY ?? '');
      return instance;
    case 'openai':
      instance = new OpenAILLMClient(process.env.OPENAI_API_KEY ?? '');
      return instance;
    case 'google':
    case 'gemini':
      instance = new GoogleLLMClient(process.env.GOOGLE_API_KEY ?? '');
      return instance;
    default:
      instance = new MockLLMClient();
      return instance;
  }
}

/** Reset the cached client — useful in tests or after rotating a key. */
export function resetLLMClient(): void {
  instance = null;
}

export function getLLMProviderName(): string {
  return (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
}
