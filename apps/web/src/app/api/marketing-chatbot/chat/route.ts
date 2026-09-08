import { NextRequest, NextResponse } from 'next/server';
import { answerMarketingQuestion } from '@/lib/marketingChat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM = (process.env.NEXT_PUBLIC_API_URL || 'https://nexora-api.up.railway.app').replace(
  /\/$/,
  ''
);

async function tryUpstream(req: NextRequest, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${UPSTREAM}/marketing-chatbot/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Origin: req.headers.get('origin') || 'https://nexoraos.co.in',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.data?.answer || json?.answer) return json;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  let body: { message?: string; question?: string; stream?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, message: 'invalid_json', data: null, error: 'bad_request' },
      { status: 400 }
    );
  }

  const question = String(body.message ?? body.question ?? '').trim();
  if (!question) {
    return NextResponse.json(
      { success: false, message: 'message is required', data: null, error: 'bad_request' },
      { status: 400 }
    );
  }

  // Prefer live Railway API when healthy; otherwise serve on Vercel.
  const upstream = await tryUpstream(req, { ...body, message: question, stream: false });
  if (upstream) {
    return NextResponse.json(upstream);
  }

  const started = Date.now();
  const result = await answerMarketingQuestion(question);
  return NextResponse.json({
    success: true,
    data: {
      answer: result.answer,
      sources: result.sources,
      suggestions: result.suggestions,
      latencyMs: Date.now() - started,
      ok: result.ok,
      mode: 'vercel_fallback',
    },
    error: null,
  });
}
