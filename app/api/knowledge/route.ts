/**
 * POST /api/knowledge – searches the Evolus knowledge library (manuals + closed interventions) for a question.
 * Runs alongside /api/ask: the answer on AMD comes first, the library passages follow when Evolus is done.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { evolusAsk, evolusConfigured } from '@/server/evolus';
import { LIMIT_MESSAGE, overLimit } from '@/server/guard';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({ question: z.string().trim().min(3).max(500), machines: z.array(z.string().max(40)).max(5).default([]) });

export async function POST(req: Request) {
  if (!evolusConfigured()) return NextResponse.json({ ok: false, error: 'Evolus knowledge library not configured' }, { status: 503 });
  if (overLimit(req)) return NextResponse.json({ ok: false, error: LIMIT_MESSAGE }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  try {
    const r = await evolusAsk(parsed.data.question, parsed.data.machines);
    console.log('[evolus]', JSON.stringify({ op: 'knowledge', latencyMs: r.latencyMs, chars: r.text.length }));
    return NextResponse.json({ ok: true, data: r });
  } catch (err) {
    console.warn('[evolus] knowledge error', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'The knowledge library did not answer in time' }, { status: 502 });
  }
}
