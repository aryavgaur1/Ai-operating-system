import { createLLMClient, runNexoraTurn, type LLMMessage } from '@enterprise-ai-os/agent-core';
import { retrieveMarketingContext } from './indexer';
import { getDemoOrgId } from '../middleware/auth';

const SYSTEM = `You are Nexora Assistant — a Sales Engineer + Product Expert + Support Engineer for the Nexora AI Operating System marketing site.

Rules:
- Be professional, helpful, technical, and honest.
- Answer ONLY using the retrieved knowledge context below. Do not invent features, connectors, or pricing.
- Keep answers concise (under ~180 words) with short bullets when helpful.
- If the context does not contain the answer, say so and suggest Contact / Book Demo or /pricing, /integrations, /docs, /enterprise, /register.
- When recommending plans: Starter (explore), Pro (startup live Slack+Notion), Business (team governance), Enterprise (SSO/private).
- Live tools today: Slack and Notion. Other logos may be marketing/roadmap — say so clearly.
- Never claim to execute tools from this marketing chat; this assistant explains the product.`;

const FOLLOWUPS: { match: RegExp; tips: string[] }[] = [
  {
    match: /chatgpt|different|vs\b|compar|better than/i,
    tips: ['How does Memory work?', 'Explain Slack Integration', 'What pricing plan for a startup?', 'Show me AI Agents'],
  },
  {
    match: /slack/i,
    tips: ['Can I automate Slack?', 'How does Notion integration work?', 'Do actions need approvals?', 'What happens after I sign up?'],
  },
  {
    match: /notion/i,
    tips: ['Explain Slack Integration', 'How does Memory work?', 'Live command examples', 'Pro vs Business pricing'],
  },
  {
    match: /pric|plan|cost|starter|pro\b|business|enterprise|buy/i,
    tips: ["I'm a startup — what should I use?", "I'm an enterprise — what do I need?", 'What is included in Pro?', 'Book a Demo'],
  },
  {
    match: /memor/i,
    tips: ['How does the Reasoning Engine work?', 'Compare Nexora vs ChatGPT', 'Does Nexora remember conversations?', 'Show me AI Agents'],
  },
  {
    match: /agent/i,
    tips: ['How it works: Understand → Remember', 'How does Memory work?', 'Explain Slack Integration', 'What happens after I sign up?'],
  },
  {
    match: /sign ?up|onboard|after i (sign|register)|getting started/i,
    tips: ['How do I connect Slack?', 'How do I connect Notion?', 'Where is Approvals?', 'Starter vs Pro'],
  },
  {
    match: /github|jira|gmail|drive|calendar|zoom|salesforce/i,
    tips: ['Which integrations are live today?', 'Explain Slack Integration', 'Explain Notion Integration', 'Enterprise roadmap'],
  },
  {
    match: /founder|aryav|ceo|contact|email|linkedin/i,
    tips: ['What is Nexora?', 'Book a Demo', 'Enterprise Pricing', 'Compare Nexora vs ChatGPT'],
  },
  {
    match: /secur|privacy|sso|audit|approval/i,
    tips: ['How do Approvals work?', 'Enterprise plan details', 'Is my Slack data safe?', 'Business vs Enterprise'],
  },
];

const DEFAULT_FOLLOWUPS = [
  'What is Nexora?',
  'Explain Slack Integration',
  'How does Memory work?',
  'What pricing plan should I buy?',
  'Show me AI Agents',
  'Compare Nexora vs ChatGPT',
];

export function relatedSuggestions(question: string, answer: string): string[] {
  const blob = `${question}\n${answer}`;
  const pool: string[] = [];
  for (const row of FOLLOWUPS) {
    if (row.match.test(blob)) pool.push(...row.tips);
  }
  pool.push(...DEFAULT_FOLLOWUPS);
  // de-dupe, skip near-identical to the asked question
  const qn = question.trim().toLowerCase();
  const unique: string[] = [];
  for (const tip of pool) {
    if (tip.trim().toLowerCase() === qn) continue;
    if (unique.some((u) => u.toLowerCase() === tip.toLowerCase())) continue;
    unique.push(tip);
  }
  // rotate so consecutive asks feel different
  const offset = Math.abs(hash(question)) % Math.max(1, unique.length - 3);
  const rotated = [...unique.slice(offset), ...unique.slice(0, offset)];
  return rotated.slice(0, 4);
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export async function answerMarketingQuestion(question: string): Promise<{
  answer: string;
  sources: { title: string; source: string; score: number }[];
  suggestions: string[];
  ok: boolean;
}> {
  const matches = await retrieveMarketingContext(question, 5);
  const context = matches
    .map((m, i) => `[${i + 1}] (${String(m.metadata?.title ?? 'Source')}) ${m.text}`)
    .join('\n\n');

  const sources = matches.map((m) => ({
    title: String(m.metadata?.title ?? 'Source'),
    source: String(m.metadata?.source ?? ''),
    score: Number(m.score.toFixed(3)),
  }));

  // Unified AI Service — public marketing mode (no tools)
  try {
    const result = await runNexoraTurn({
      message: question,
      organizationId: getDemoOrgId(),
      mode: 'public_marketing',
      productKnowledge: context || undefined,
    });
    const answer = result.reply || groundedFallback(question, matches.map((m) => m.text));
    return {
      answer,
      sources,
      suggestions: relatedSuggestions(question, answer),
      ok: answer.length > 20,
    };
  } catch {
    if (!context.trim()) {
      const answer =
        "I don't have indexed knowledge for that yet. Try asking about Nexora's OS, Slack/Notion integrations, pricing, memory, agents, or enterprise — or use Contact / Book a Demo.";
      return { answer, sources, suggestions: relatedSuggestions(question, answer), ok: false };
    }
    const provider = process.env.LLM_PROVIDER ?? 'mock';
    if (provider === 'mock') {
      const answer = groundedFallback(question, matches.map((m) => m.text));
      return { answer, sources, suggestions: relatedSuggestions(question, answer), ok: true };
    }
    try {
      const llm = createLLMClient();
      let answer = await llm.complete([
        { role: 'system', content: `${SYSTEM}\n\n--- RETRIEVED KNOWLEDGE ---\n${context}` },
        { role: 'user', content: question },
      ] as LLMMessage[]);
      if (/Based on the retrieved context, here's a draft/i.test(answer)) {
        answer = groundedFallback(question, matches.map((m) => m.text));
      }
      return { answer, sources, suggestions: relatedSuggestions(question, answer), ok: answer.length > 40 };
    } catch {
      const answer = groundedFallback(question, matches.map((m) => m.text));
      return { answer, sources, suggestions: relatedSuggestions(question, answer), ok: true };
    }
  }
}

function groundedFallback(question: string, chunks: string[]): string {
  const q = question.toLowerCase();
  const joined = chunks.join('\n\n');
  if (/chatgpt|different|vs\b|compar/i.test(q)) {
    return [
      '**Nexora vs ChatGPT**',
      '',
      '- ChatGPT primarily answers questions in chat.',
      '- Nexora is an **AI Operating System**: it reasons, plans, remembers, and **executes real work** via tools.',
      '- Live tool execution today centers on **Slack** and **Notion**.',
      '- Nexora adds **approvals**, **org isolation**, and persistent **memory**.',
    ].join('\n');
  }
  if (/pric|plan|startup|enterprise|buy/i.test(q)) {
    return [
      '**Pricing guidance**',
      '',
      '- **Starter ($0)** — explore chat + demo connectors',
      '- **Pro ($49)** — startups running live Slack + Notion',
      '- **Business ($149)** — teams needing seats, roles, audit',
      '- **Enterprise (Custom)** — SSO/SAML, SLAs, private deploy',
      '',
      truncate(joined, 500),
    ].join('\n');
  }
  return [
    truncate(joined, 900),
    '',
    '_Grounded in indexed Nexora knowledge._',
  ].join('\n');
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return `${s.slice(0, n).trim()}…`;
}

export const STARTER_PROMPTS = [
  'What is Nexora?',
  'Show me AI Agents',
  'Explain Slack Integration',
  'Compare Nexora vs ChatGPT',
  'How does Memory work?',
  'Can I automate Slack?',
  'Enterprise Pricing',
  'What happens after I sign up?',
];
