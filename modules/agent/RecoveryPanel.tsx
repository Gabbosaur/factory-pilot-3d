'use client';
/**
 * Recovery planner agent (AMD Token Factory): the model plans in steps and calls deterministic tools that the
 * browser executes on the live data; it ends with a recovery plan (bottles and €) for the manager to approve.
 */
import { useState } from 'react';
import { useStore } from '@/modules/store';
import { enqueuePost } from '@/modules/incidents/requestQueue';
import { localMemory } from '@/modules/incidents/memory/local';
import type { AgentStep, LlmCallMeta } from '@/shared/types';
import { getSituation, MAX_BOOST, OVERTIME_EUR_PER_MIN, SHIFT_MIN, simulate, type RecoveryInput, type RecoveryOption } from './recovery';

const MAX_STEPS = 6;

interface Plan {
  summary: string;
  steps: Array<{ line: string; action: string; detail: string; extraBottles?: number; netEur?: number }>;
  expectedExtraBottles?: number;
  expectedNetEur?: number;
  risks?: string[];
}

interface Entry {
  step: AgentStep;
  observation?: string;
  meta?: LlmCallMeta;
}

function recoveryInput(): RecoveryInput {
  const s = useStore.getState();
  return {
    plant: s.plant,
    productions: s.productions,
    lines: s.lines,
    bypassed: s.bypassed,
    speed: s.speed,
    statuses: s.statuses,
    openIncidentMachines: Object.values(s.incidents)
      .filter((i) => i.status !== 'chiuso' && i.status !== 'rifiutato')
      .flatMap((i) => [i.machineId, i.causalPath[0]!]),
    memory: localMemory.all(),
  };
}

/** Short, human summary of a tool observation for the step list. */
function brief(tool: AgentStep['tool'], obs: unknown): string {
  if (!obs || typeof obs !== 'object') return '';
  const o = obs as Record<string, unknown>;
  if ('error' in o) return `⚠ ${String(o.error)}`;
  if (tool === 'get_situation') {
    const lines = (o.lines as Array<{ line: string; state: string; gapBottles: number; gapEur: number }>) ?? [];
    return lines.map((l) => `${l.line} ${l.state}, gap ${l.gapBottles.toLocaleString('en-GB')} bottles (€${l.gapEur.toLocaleString('en-GB')})`).join(' · ');
  }
  if (tool === 'simulate') return `+${Number(o.extraBottles).toLocaleString('en-GB')} bottles · net €${Number(o.netEur).toLocaleString('en-GB')}${Array.isArray(o.notes) && o.notes.length ? ` · ${o.notes.join('; ')}` : ''}`;
  return '';
}

export function RecoveryPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'approved' | 'discarded'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Select a string (stable between renders), not a fresh array: a new array per read loops useSyncExternalStore.
  const degradedKey = useStore((s) =>
    s.plant.lines
      .filter((l) => !s.lines[l.id]?.running || l.machineIds.some((id) => s.bypassed[id] || (s.speed[id] ?? 1) < 1))
      .map((l) => l.id)
      .join(','),
  );
  const degraded = degradedKey ? degradedKey.split(',') : [];

  const run = async () => {
    setEntries([]);
    setPlan(null);
    setError(null);
    setStatus('running');
    const st = useStore.getState();
    const scenario = `${st.factory.id}-${degraded.length
      ? degraded.map((id) => `${id}-${!st.lines[id]?.running ? `stop-${st.lines[id]?.trippedBy?.machineId}` : Object.keys(st.bypassed).filter((k) => st.bypassed[k]!.lineId === id).join('+') || 'slow'}`).join('_')
      : 'all-running'}`;
    const goal = degraded.length
      ? `Recover the output lost on ${degraded.join(', ')} of ${st.factory.name} by the end of the shift.`
      : `All lines of ${st.factory.name} run at 100%: check the projection to the shift target and say whether any action is worth it.`;
    const transcript: Array<{ kind: 'action' | 'observation'; content: string }> = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await enqueuePost<AgentStep>('/api/agent', { goal, step, scenario, transcript, replay: useStore.getState().replay });
      if (!res.ok) {
        setError(res.error);
        setStatus('idle');
        return;
      }
      if (res.meta) useStore.getState().logLlm(res.meta);
      const s = res.data;
      transcript.push({ kind: 'action', content: JSON.stringify(s) });
      if (s.tool === 'final') {
        setEntries((e) => [...e, { step: s, meta: res.meta }]);
        // Totals from the plan steps when the model omits them (the step figures come from the tools).
        const p = s.args as unknown as Plan;
        const steps = Array.isArray(p.steps) ? p.steps : [];
        const sum = (k: 'extraBottles' | 'netEur') => steps.reduce((a, x) => a + (Number(x[k]) || 0), 0);
        setPlan({ ...p, steps, expectedExtraBottles: Number(p.expectedExtraBottles) || sum('extraBottles'), expectedNetEur: Number(p.expectedNetEur) || sum('netEur') });
        setStatus('done');
        return;
      }
      // Tools run here, on the live plant data: the numbers never come from the model.
      const input = recoveryInput();
      const obs = s.tool === 'get_situation' ? getSituation(input) : simulate(input, s.args as unknown as RecoveryOption);
      const text = JSON.stringify(obs);
      transcript.push({ kind: 'observation', content: text.slice(0, 6000) });
      setEntries((e) => [...e, { step: s, observation: brief(s.tool, obs), meta: res.meta }]);
    }
    setError('The agent did not reach a plan within 6 steps.');
    setStatus('idle');
  };

  const approve = () => {
    const st = useStore.getState();
    const affected = new Set((plan?.steps ?? []).map((x) => x.line));
    for (const inc of Object.values(st.incidents)) {
      if (inc.status === 'chiuso' || inc.status === 'rifiutato' || !affected.has(st.plant.lineOf[inc.machineId] ?? '')) continue;
      st.patchIncident(inc.id, (i) => ({ log: [...i.log, { ts: new Date().toISOString(), kind: 'decisione', message: `Recovery plan approved: ${plan?.summary ?? ''}`, author: 'Responsabile' }] }));
    }
    st.notify({ kind: 'info', text: `Recovery plan approved: +${(plan?.expectedExtraBottles ?? 0).toLocaleString('en-GB')} bottles, net €${(plan?.expectedNetEur ?? 0).toLocaleString('en-GB')} expected` });
    setStatus('approved');
  };

  return (
    <section className="card p-3" aria-label="Recovery planner">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">⟳ Recovery planner · AI agent</h2>
          <p className="text-[11px] text-slate-500">
            {degraded.length ? (
              <span className="text-amber-300">Output is being lost on {degraded.join(', ')}.</span>
            ) : (
              'All lines at 100%.'
            )}{' '}
            The agent reads the situation, simulates options with deterministic tools and proposes a plan; the manager approves.
          </p>
        </div>
        <button type="button" className={degraded.length ? 'btn-primary' : 'btn'} onClick={() => void run()} disabled={status === 'running'}>
          {status === 'running' ? 'Planning…' : 'Plan recovery with AI'}
        </button>
      </div>

      {entries.length > 0 && (
        <ol className="space-y-1.5 text-xs">
          {entries.map((e, i) => (
            <li key={i} className="rounded-md bg-slate-950/50 px-2.5 py-1.5 ring-1 ring-inset ring-white/5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-slate-500">step {i + 1}</span>
                <span className="rounded bg-sky-500/15 px-1.5 font-mono text-[10px] text-sky-300">{e.step.tool}</span>
                {e.step.tool === 'simulate' && <span className="font-mono text-[10px] text-slate-400">{JSON.stringify(e.step.args)}</span>}
                {e.meta && <span className="ml-auto text-[10px] text-slate-600">{(e.meta.latencyMs / 1000).toFixed(1)} s{e.meta.replay ? ' · replay' : ''}</span>}
              </div>
              <p className="mt-0.5 text-slate-300">{e.step.thought}</p>
              {e.observation && <p className="mt-0.5 font-mono text-[11px] text-emerald-300/90">→ {e.observation}</p>}
            </li>
          ))}
          {status === 'running' && <li className="animate-pulse px-2.5 text-slate-500">thinking…</li>}
        </ol>
      )}
      {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}

      {plan && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-sm font-semibold text-emerald-200">{plan.summary}</p>
          {plan.steps?.length > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="font-normal">Line</th>
                  <th className="font-normal">Action</th>
                  <th className="text-right font-normal">Extra bottles</th>
                  <th className="text-right font-normal">Net €</th>
                </tr>
              </thead>
              <tbody>
                {plan.steps.map((s, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-0.5 font-mono">{s.line}</td>
                    <td className="py-0.5">
                      {s.action}
                      <div className="text-[11px] text-slate-400">{s.detail}</div>
                    </td>
                    <td className="py-0.5 text-right font-mono">{s.extraBottles?.toLocaleString('en-GB') ?? '–'}</td>
                    <td className="py-0.5 text-right font-mono">{s.netEur?.toLocaleString('en-GB') ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-slate-300">
            Expected: <strong>+{(plan.expectedExtraBottles ?? 0).toLocaleString('en-GB')} bottles</strong> · <strong>net €{(plan.expectedNetEur ?? 0).toLocaleString('en-GB')}</strong> by the end of the shift
          </p>
          {plan.risks && plan.risks.length > 0 && <p className="mt-1 text-[11px] text-amber-300/90">Risks: {plan.risks.join(' · ')}</p>}
          <div className="mt-2 flex items-center gap-2">
            {status === 'done' && (
              <>
                <button type="button" className="btn-primary" onClick={approve}>
                  ✓ Approve plan
                </button>
                <button type="button" className="btn" onClick={() => setStatus('discarded')}>
                  Discard
                </button>
              </>
            )}
            {status === 'approved' && <span className="text-xs text-emerald-300">✓ Approved by the manager and logged on the line incidents</span>}
            {status === 'discarded' && <span className="text-xs text-slate-400">Plan discarded</span>}
          </div>
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-600">
        Assumptions: {SHIFT_MIN / 60} h shift · lost bottle valued at the line downtime cost · other line up to +{MAX_BOOST * 100}% speed · overtime €{OVERTIME_EUR_PER_MIN}/min · repair times from the factory memory (or typical values).
      </p>
    </section>
  );
}
