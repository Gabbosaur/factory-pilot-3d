/**
 * POST /api/inspect – visual inspection of a product photo with Gemma (multimodal) on AMD Token Factory.
 * The result is evidence attached to the machine's incident / quality hold; people decide.
 */
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ApiResult, InspectionResult } from '@/shared/types';
import { overLimit } from '@/server/guard';
import { callLLM, extractJson } from '@/server/llm/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  image: z
    .string()
    .max(3_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,/, 'image must be a PNG, JPEG or WebP data URL'),
  machine: z.object({ id: z.string(), name: z.string(), type: z.string() }),
  note: z.string().max(300).optional(),
  replay: z.boolean().optional(),
});

const DEFECT_TYPES = ['none', 'cap_missing', 'cap_crooked', 'cap_loose', 'fill_low', 'fill_high', 'label_defect', 'container_damage', 'foreign_object', 'other'] as const;

const Inspection = z.object({
  verdict: z.enum(['ok', 'defect', 'uncertain']),
  defect_type: z.enum(DEFECT_TYPES),
  confidence: z.number().min(0).max(1),
  observations: z.array(z.string().max(300)).max(6).default([]),
  affects_quality: z.boolean(),
  recommended_action: z.string().max(400),
});

const SYSTEM = `You are a visual quality inspector on a bottling line (water / juice in PET or glass bottles).
Inspect the photo for product defects: cap missing, crooked or loose; fill level too low or too high; label defects; container damage; foreign objects.
Rules:
- Describe only what is visible. If the photo is not a bottle/cap or is too unclear, answer "uncertain" with low confidence.
- confidence is 0–1. affects_quality is true when the product should not be shipped as is.
Reply ONLY with JSON: {"verdict": "ok"|"defect"|"uncertain", "defect_type": one of ${DEFECT_TYPES.map((d) => `"${d}"`).join(', ')},
"confidence": number, "observations": [short strings], "affects_quality": boolean, "recommended_action": string}.`;

export async function POST(req: Request): Promise<NextResponse<ApiResult<InspectionResult>>> {
  const deadline = Date.now() + (maxDuration - 5) * 1000;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ ok: false, retryable: false, error: `Invalid request: ${parsed.error.issues[0]?.message}` }, { status: 400 });
  const b = parsed.data;
  // Replay is per image: a recorded inspection is never reused for a different photo.
  const scenarioId = `inspect-${createHash('sha256').update(b.image).digest('hex').slice(0, 16)}`;
  const res = await callLLM({
    agent: 'visione',
    scenarioId,
    system: SYSTEM,
    user: `Machine: ${b.machine.id} ${b.machine.name} (${b.machine.type}).${b.note ? ` Operator note: ${b.note}` : ''} Inspect the attached photo.`,
    image: b.image,
    replay: b.replay,
    limited: overLimit(req),
    deadline,
  });
  if (!res.ok) {
    const error = /No replay recording/.test(res.error) ? 'This photo has no recorded inspection: switch Replay off to run the AI live on AMD.' : res.error;
    return NextResponse.json({ ...res, error }, { status: res.retryable ? 503 : 502 });
  }
  try {
    const r = Inspection.safeParse(extractJson(res.content));
    if (!r.success) return NextResponse.json({ ok: false, retryable: false, error: 'Invalid schema: the inspection did not follow the format' }, { status: 422 });
    return NextResponse.json({ ok: true, data: r.data, meta: res.meta });
  } catch {
    return NextResponse.json({ ok: false, retryable: false, error: 'Invalid JSON in the inspection' }, { status: 422 });
  }
}
