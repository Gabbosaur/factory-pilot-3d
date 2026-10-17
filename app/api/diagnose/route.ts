/**
 * POST /api/diagnose – Agente_Diagnosi (Req 8). Validates input and output with zod.
 * One logical call; the browser orchestrator enforces the 3-calls-per-incident limit.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AlarmSchema, DiagnosisSchema, MemoryEntrySchema } from '@/shared/schemas';
import type { ApiResult, Diagnosis } from '@/shared/types';
import { callLLM, extractJson } from '@/server/llm/client';
import { DIAGNOSIS_SYSTEM, diagnosisUser } from '@/server/llm/prompts';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PathMachine = z.object({ id: z.string(), name: z.string(), type: z.string(), status: z.string() });
const Body = z.object({
  incidentId: z.string().min(1),
  scenarioId: z.string().min(1),
  alarm: AlarmSchema,
  alarmMachine: PathMachine,
  causalPath: z.array(PathMachine).min(1),
  sensorName: z.string(),
  sensorUnit: z.string(),
  manualPages: z.array(z.object({ n: z.number().int().min(1), text: z.string() })).max(20),
  similar: z.array(MemoryEntrySchema).max(3),
  imageFindings: z.array(z.string()).optional(),
  replay: z.boolean().optional(),
});

export async function POST(req: Request): Promise<NextResponse<ApiResult<Diagnosis>>> {
  const deadline = Date.now() + (maxDuration - 5) * 1000;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ ok: false, retryable: false, error: `Invalid request: ${parsed.error.issues[0]?.message}` }, { status: 400 });
  const b = parsed.data;

  const res = await callLLM({
    agent: 'diagnosi',
    scenarioId: b.scenarioId,
    incidentId: b.incidentId,
    system: DIAGNOSIS_SYSTEM,
    user: diagnosisUser(b),
    replay: b.replay,
    deadline,
  });
  if (!res.ok) return NextResponse.json(res, { status: res.retryable ? 503 : 502 });

  try {
    const diag = DiagnosisSchema.omit({ citazione_verificata: true }).safeParse(extractJson(res.content));
    if (!diag.success)
      return NextResponse.json({ ok: false, retryable: false, error: `Invalid schema: ${diag.error.issues[0]?.path.join('.')} ${diag.error.issues[0]?.message}` }, { status: 422 });
    return NextResponse.json({ ok: true, data: diag.data, meta: res.meta });
  } catch (err) {
    return NextResponse.json({ ok: false, retryable: false, error: err instanceof Error ? err.message : 'Invalid JSON' }, { status: 422 });
  }
}
