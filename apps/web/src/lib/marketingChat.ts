import docs from '@/data/marketingKnowledge.json';

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

type Doc = { id: string; title: string; source: string; text: string };

function scoreDoc(question: string, doc: Doc): number {
  const q = question.toLowerCase();
  const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const hay = `${doc.title}\n${doc.text}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  if (/chatgpt|vs\b|compar/i.test(q) && /chatgpt|operating system/i.test(hay)) score += 3;
  if (/slack/i.test(q) && /slack/i.test(hay)) score += 3;
  if (/notion/i.test(q) && /notion/i.test(hay)) score += 3;
  if (/pric|plan|cost/i.test(q) && /pric|starter|pro|enterprise/i.test(hay)) score += 3;
  if (/memor/i.test(q) && /memor/i.test(hay)) score += 3;
  if (/agent/i.test(q) && /agent/i.test(hay)) score += 2;
  return score;
}

function retrieve(question: string, limit = 3): Doc[] {
  return [...(docs as Doc[])]
    .map((d) => ({ d, score: scoreDoc(question, d) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.d);
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return `${s.slice(0, n).trim()}…`;
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
      '- **Free (365 days)** — core chat, Slack/Jira/Notion, propose → approve → act',
      '- **Advanced (paid)** — seats/roles, audit export, SSO/SAML, SLAs, private deploy',
      '',
      truncate(joined, 500),
    ].join('\n');
  }
  if (/agent/i.test(q)) {
    return [
      '**AI Agents on Nexora**',
      '',
      '- Nexora routes work across specialized agents inside one OS.',
      '- Agents can plan multi-step work, then execute through connected tools.',
      '- High-impact steps pause for **human approval** before acting.',
      '',
      truncate(joined, 700),
    ].join('\n');
  }
  if (joined.trim()) {
    return [truncate(joined, 900), '', '_Grounded in Nexora product knowledge._'].join('\n');
  }
  return "I don't have indexed knowledge for that yet. Try asking about Nexora's OS, Slack/Notion, pricing, memory, agents, or enterprise — or use Contact / Book a Demo.";
}

function relatedSuggestions(question: string): string[] {
  const q = question.toLowerCase();
  const pool = [...STARTER_PROMPTS];
  if (/slack/i.test(q)) pool.unshift('Can I automate Slack?', 'How does Notion integration work?');
  if (/pric/i.test(q)) pool.unshift('Is Nexora free for a year?', 'What is Advanced?');
  if (/chatgpt|vs/i.test(q)) pool.unshift('How does Memory work?', 'Explain Slack Integration');
  const unique: string[] = [];
  for (const tip of pool) {
    if (tip.trim().toLowerCase() === q.trim()) continue;
    if (unique.some((u) => u.toLowerCase() === tip.toLowerCase())) continue;
    unique.push(tip);
  }
  return unique.slice(0, 4);
}

async function tryLlm(question: string, context: string): Promise<string | null> {
  const key = (process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '').trim();
  if (!key) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          {
            role: 'system',
            content:
              'You are Nexora Assistant for the marketing site. Answer ONLY from the knowledge context. Be concise. Live tools today: Slack and Notion. Do not invent features.',
          },
          {
            role: 'user',
            content: `Knowledge:\n${context}\n\nQuestion: ${question}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function answerMarketingQuestion(question: string) {
  const matches = retrieve(question, 4);
  const context = matches.map((m, i) => `[${i + 1}] (${m.title})\n${m.text}`).join('\n\n');
  const sources = matches.map((m) => ({
    title: m.title,
    source: m.source,
    score: 1,
  }));
  const llm = await tryLlm(question, context || '(no matches)');
  const answer = llm || groundedFallback(question, matches.map((m) => m.text));
  return {
    answer,
    sources,
    suggestions: relatedSuggestions(question),
    ok: answer.length > 20,
  };
}
