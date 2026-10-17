/**
 * POST /api/safety – Agente_Sicurezza on Gemma (Req 9). The deterministic escalation rule
 * in the browser has the final word; a non-conforming answer is treated as high risk there.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DiagnosisSchema, RiskAssessmentSchema } from '@/shared/schemas';
import type { ApiResult, RiskAssessment } from '@/shared/types';
import { callLLM, extractJson } from '@/server/llm/client';
import { SAFETY_SYSTEM, safetyUser } from '@/server/llm/prompts';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  incidentId: z.string().min(1),
  scenarioId: z.string().min(1),
  diagnosis: DiagnosisSchema,
  machine: z.object({ id: z.string(), name: z.string(), type: z.string(), status: z.string() }),
  impact: z.object({ costPerMin: z.number(), partsAtRiskPerMin: z.number(), savingsEur: z.number(), horizonMin: z.number() }),
  alarmValue: z.number(),
  sensor: z.string(),
  replay: z.boolean().optional(),
});

export async function POST(req: Request): Promise<NextResponse<ApiResult<RiskAssessment>>> {
  const deadline = Date.now() + (maxDuration - 5) * 1000;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ ok: false, retryable: false, error: `Invalid request: ${parsed.error.issues[0]?.message}` }, { status: 400 });
  const b = parsed.data;

  const res = await callLLM({
    agent: 'sicurezza',
    scenarioId: b.scenarioId,
    incidentId: b.incidentId,
    system: SAFETY_SYSTEM,
    user: safetyUser(b),
    replay: b.replay,
    deadline,
  });
  if (!res.ok) return NextResponse.json(res, { status: res.retryable ? 503 : 502 });
  try {
    const risk = RiskAssessmentSchema.safeParse(extractJson(res.content));
    if (!risk.success) return NextResponse.json({ ok: false, retryable: false, error: 'Invalid schema: risk assessment does not match the schema' }, { status: 422 });
    return NextResponse.json({ ok: true, data: risk.data, meta: res.meta });
  } catch {
    return NextResponse.json({ ok: false, retryable: false, error: 'Invalid JSON: risk assessment is not valid JSON' }, { status: 422 });
  }
}
