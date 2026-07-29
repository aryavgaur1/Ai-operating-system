// ============================================================
// LLM Client — the reasoning/generation backend for the agent.
// Real Anthropic + OpenAI implementations. Set LLM_PROVIDER to
// 'anthropic' or 'openai' and the matching API key in .env.
// MockLLMClient is kept for offline/CI runs (LLM_PROVIDER=mock).
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
}

export class MockLLMClient implements LLMClient {
  async complete(messages: LLMMessage[]): Promise<string> {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const text = lastUser?.content ?? '';
    return `Based on the retrieved context, here's a draft response to: "${text.slice(0, 140)}"`;
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
      max_tokens: 1024,
      system,
      messages: rest,
    });

    const block = res.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
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
}

let instance: LLMClient | null = null;

export function createLLMClient(): LLMClient {
  if (instance) return instance;
  const provider = process.env.LLM_PROVIDER ?? 'mock';
  switch (provider) {
    case 'anthropic':
      instance = new AnthropicLLMClient(process.env.ANTHROPIC_API_KEY ?? '');
      return instance;
    case 'openai':
      instance = new OpenAILLMClient(process.env.OPENAI_API_KEY ?? '');
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
