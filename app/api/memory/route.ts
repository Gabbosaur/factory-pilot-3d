/**
 * POST /api/memory – proxy to Evolus RAG (keys stay server-side). Req 15.10, 15.11.
 * The browser always keeps a local copy and applies the exact similarity filter itself.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MemoryEntrySchema } from '@/shared/schemas';
import { evolusConfigured, evolusDelete, evolusSave, evolusSearch } from '@/server/evolus';

export const runtime = 'nodejs';
export const maxDuration = 30;

const Body = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('search'),
    machineId: z.string(),
    machineType: z.string(),
    sensorIds: z.array(z.string()),
    symptom: z.string().max(500),
  }),
  z.object({ op: z.literal('save'), entry: MemoryEntrySchema }),
  z.object({ op: z.literal('delete'), documentIds: z.array(z.string()).max(50) }),
]);

export async function POST(req: Request) {
  if (!evolusConfigured()) return NextResponse.json({ ok: false, retryable: false, error: 'Evolus not configured' }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, retryable: false, error: 'Invalid request' }, { status: 400 });
  const b = parsed.data;
  const t0 = Date.now();
  try {
    if (b.op === 'search') {
      const entries = await evolusSearch(b);
      console.log('[evolus]', JSON.stringify({ op: 'search', latencyMs: Date.now() - t0, n: entries.length }));
      return NextResponse.json({ ok: true, data: entries });
    }
    if (b.op === 'save') {
      const r = await evolusSave(b.entry);
      console.log('[evolus]', JSON.stringify({ op: 'save', latencyMs: Date.now() - t0 }));
      return NextResponse.json({ ok: true, data: r });
    }
    await Promise.allSettled(b.documentIds.map(evolusDelete));
    return NextResponse.json({ ok: true, data: { deleted: b.documentIds.length } });
  } catch (err) {
    console.warn('[evolus] error', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, retryable: false, error: 'Evolus unavailable' }, { status: 502 });
  }
}
