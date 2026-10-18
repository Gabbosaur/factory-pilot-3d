/**
 * POST /api/agent – one step of the Recovery planner agent (ReAct style). The browser runs the loop:
 * it sends the transcript, the model answers with the next tool to call (or the final plan), the browser
 * executes the deterministic tool on the live data and sends the observation back. Max 6 steps.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { AgentStep, ApiResult } from '@/shared/types';
import { overLimit } from '@/server/guard';
import { callLLM, extractJson } from '@/server/llm/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  goal: z.string().min(1).max(600),
  step: z.number().int().min(0).max(6),
  scenario: z.string().min(1).max(120),
  transcript: z
    .array(z.object({ kind: z.enum(['action', 'observation']), content: z.string().max(12_000) }))
    .max(14),
  replay: z.boolean().optional(),
});

const Step = z.object({
  thought: z.string().max(600),
  tool: z.enum(['get_situation', 'simulate', 'final']),
  args: z.record(z.string(), z.unknown()).default({}),
});

const SYSTEM = `You are the Recovery planner agent of FactoryPilot, for a production engineer in a bottling plant.
Goal: when output is lost (line stopped, machine bypassed, reduced speed), find the plan that recovers the most bottles and euros by the end of the shift, safely.
You work in steps. At each step reply ONLY with JSON {"thought": string (1-2 sentences), "tool": string, "args": object}.
Tools (computed by deterministic code on the live plant data; never invent numbers):
- get_situation {} → per line: state, remaining minutes, shift target, projected output, gap in bottles and €, spare capacity, faulty machines with repair time (MTTR).
- simulate {"type": "do_nothing"|"repair_now"|"repair_at_minute"|"boost_other_line"|"overtime", "line": "L1", "machine": "L2-F1" (repairs), "minute": 30 (repair_at_minute), "minutes": 60 (boost/overtime)} → extra bottles, € recovered, cost, net €, notes.
- final {"summary": string, "steps": [{"line": string, "action": string, "detail": string, "extraBottles": number, "netEur": number}], "expectedExtraBottles": number, "expectedNetEur": number, "risks": [string]} → ends the run.
Rules:
- Start with get_situation. Compare at least two options with simulate before final. Use at most 6 steps in total.
- Only use machines and lines that get_situation returned. Copy numbers from the observations.
- Safety: never propose running a tripped machine; repairs need the maintenance crew and the manager's approval.`;

export async function POST(req: Request): Promise<NextResponse<ApiResult<AgentStep>>> {
  const deadline = Date.now() + (maxDuration - 5) * 1000;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ ok: false, retryable: false, error: `Invalid request: ${parsed.error.issues[0]?.message}` }, { status: 400 });
  const b = parsed.data;
  const history = b.transcript.map((t) => (t.kind === 'action' ? `YOUR STEP: ${t.content}` : `OBSERVATION: ${t.content}`)).join('\n');
  const mustFinish = b.step >= 5 ? '\nThis is your last step: reply with tool "final".' : '';
  const res = await callLLM({
    agent: 'pianificatore',
    // Replay per situation and step number, so a recorded run can be replayed for the video.
    scenarioId: `recovery-${b.scenario}-step${b.step}`,
    system: SYSTEM,
    user: `GOAL: ${b.goal}\n\n${history || '(no steps yet)'}${mustFinish}\n\nNext step JSON:`,
    replay: b.replay,
    limited: overLimit(req),
    deadline,
  });
  if (!res.ok) {
    const error = /No replay recording/.test(res.error) ? 'No recorded run for this situation: switch Replay off to run the agent live on AMD.' : res.error;
    return NextResponse.json({ ...res, error }, { status: res.retryable ? 503 : 502 });
  }
  try {
    const s = Step.safeParse(extractJson(res.content));
    if (!s.success) return NextResponse.json({ ok: false, retryable: false, error: 'Invalid schema: the agent step did not follow the format' }, { status: 422 });
    return NextResponse.json({ ok: true, data: s.data as AgentStep, meta: res.meta });
  } catch {
    return NextResponse.json({ ok: false, retryable: false, error: 'Invalid JSON in the agent step' }, { status: 422 });
  }
}
