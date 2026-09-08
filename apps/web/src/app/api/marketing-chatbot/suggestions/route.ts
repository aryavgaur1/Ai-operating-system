import { NextResponse } from 'next/server';
import { STARTER_PROMPTS } from '@/lib/marketingChat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: { prompts: STARTER_PROMPTS },
    error: null,
  });
}
