import fs from 'fs';
import path from 'path';

export type ChatAnalytics = {
  totalQuestions: number;
  failedQuestions: number;
  totalLatencyMs: number;
  satisfactionUp: number;
  satisfactionDown: number;
  questions: { q: string; at: string; ok: boolean; latencyMs: number }[];
  popularFeatures: Record<string, number>;
};

const FEATURE_KEYS = ['slack', 'notion', 'pricing', 'memory', 'agent', 'enterprise', 'github', 'approval', 'integrat'];

function analyticsPath() {
  const dir = path.resolve(process.cwd(), 'apps/api/data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'chatbot-analytics.json');
}

function load(): ChatAnalytics {
  const p = analyticsPath();
  if (!fs.existsSync(p)) {
    return {
      totalQuestions: 0,
      failedQuestions: 0,
      totalLatencyMs: 0,
      satisfactionUp: 0,
      satisfactionDown: 0,
      questions: [],
      popularFeatures: {},
    };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ChatAnalytics;
  } catch {
    return {
      totalQuestions: 0,
      failedQuestions: 0,
      totalLatencyMs: 0,
      satisfactionUp: 0,
      satisfactionDown: 0,
      questions: [],
      popularFeatures: {},
    };
  }
}

function save(data: ChatAnalytics) {
  fs.writeFileSync(analyticsPath(), JSON.stringify(data, null, 2), 'utf8');
}

export function recordChatTurn(question: string, ok: boolean, latencyMs: number) {
  const data = load();
  data.totalQuestions += 1;
  if (!ok) data.failedQuestions += 1;
  data.totalLatencyMs += latencyMs;
  data.questions.unshift({ q: question.slice(0, 240), at: new Date().toISOString(), ok, latencyMs });
  data.questions = data.questions.slice(0, 200);
  const lower = question.toLowerCase();
  for (const key of FEATURE_KEYS) {
    if (lower.includes(key)) data.popularFeatures[key] = (data.popularFeatures[key] ?? 0) + 1;
  }
  save(data);
}

export function recordSatisfaction(up: boolean) {
  const data = load();
  if (up) data.satisfactionUp += 1;
  else data.satisfactionDown += 1;
  save(data);
}

export function getChatAnalytics() {
  const data = load();
  const avg = data.totalQuestions ? Math.round(data.totalLatencyMs / data.totalQuestions) : 0;
  const mostAsked = Object.entries(
    data.questions.reduce<Record<string, number>>((acc, row) => {
      const k = row.q.toLowerCase().slice(0, 80);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([q, count]) => ({ q, count }));

  const failed = data.questions.filter((q) => !q.ok).slice(0, 20);
  const popular = Object.entries(data.popularFeatures)
    .sort((a, b) => b[1] - a[1])
    .map(([feature, count]) => ({ feature, count }));

  return {
    totalQuestions: data.totalQuestions,
    failedQuestions: data.failedQuestions,
    averageResponseTimeMs: avg,
    satisfactionUp: data.satisfactionUp,
    satisfactionDown: data.satisfactionDown,
    mostAsked,
    failed,
    popularFeatures: popular,
    recent: data.questions.slice(0, 30),
  };
}
