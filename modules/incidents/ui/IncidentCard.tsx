'use client';
/** Req 8.9, 8.10, 9.6, 10, 11, 13.6, 15.3, 15.7 – the incident as the technician/manager sees it. */
import { useState } from 'react';
import { useStore } from '@/modules/store';
import { REASON_LABEL } from '../escalation';
import { ACTION_LABEL, MODE_LABEL } from '../autonomy';
import { formatEur } from '../impact';
import { AUTHOR_LABEL, RISK_LABEL, RISK_PILL } from '../labels';
import { formatMemoryCitation } from '../memory/filter';
import { causeOptions, OTHER_CAUSE } from '../causes';
import { approve, canUndo, closeWorkOrder, executeAction, reject, undoAction } from '../orchestrator';
import type { Incident } from '@/shared/types';
import { PhotoEvidence } from '@/modules/vision/PhotoEvidence';

/** One-line headline per state, so the operator understands the card at a glance. */
function headline(inc: Incident): { icon: string; text: string; tone: string } {
  if (inc.status === 'analisi') return { icon: '◴', text: 'Analysing on AMD Token Factory…', tone: 'text-sky-300' };
  if (inc.status === 'chiuso') return { icon: '✓', text: 'Resolved and saved to memory', tone: 'text-emerald-300' };
  if (inc.status === 'rifiutato') return { icon: '✕', text: 'Rejected by manager', tone: 'text-slate-400' };
  if (inc.status === 'approvato') return { icon: '✓', text: 'Approved · work order issued', tone: 'text-emerald-300' };
  if (inc.status === 'autonomo') return { icon: '⚡', text: 'Auto-fixed by FactoryPilot', tone: 'text-emerald-300' };
  if (inc.escalation?.escalate) return { icon: '!', text: 'Needs your decision', tone: 'text-red-300' };
  return { icon: '•', text: 'Ready', tone: 'text-slate-300' };
}

export function IncidentCard({ inc }: { inc: Incident }) {
  const factory = useStore((s) => s.factory);
  const name = (id: string) => factory.machines.find((m) => m.id === id)?.name ?? id;
  const d = inc.diagnosis && inc.diagnosis !== 'non_disponibile' ? inc.diagnosis : null;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [rejectErr, setRejectErr] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [form, setForm] = useState({ realCause: '', fix: '', durationMin: '' });
  // Not preselected: the technician confirms the real cause, which feeds the factory memory.
  const [causeChoice, setCauseChoice] = useState('');
  const rootType = factory.machines.find((m) => m.id === inc.causalPath[0])?.type ?? '';
  const causes = causeOptions(rootType, d?.causa_probabile ?? null, inc.similar);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showLog, setShowLog] = useState(false);

  const h = headline(inc);

  return (
    <article className="card space-y-3 p-3 text-sm" aria-labelledby={`${inc.id}-h`}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 id={`${inc.id}-h`} className="flex items-center gap-1.5 font-semibold">
            <span className="font-mono text-xs text-slate-500">{inc.id}</span>
            {name(inc.machineId)}
          </h3>
          <p className={`mt-0.5 flex items-center gap-1.5 text-xs font-medium ${h.tone}`}>
            <span aria-hidden>{h.icon}</span>
            {h.text}
          </p>
        </div>
        {inc.risk && <span className={`pill ${RISK_PILL[inc.risk.livello_rischio]}`}>{RISK_LABEL[inc.risk.livello_rischio]} risk</span>}
      </header>

      {inc.causalPath.length > 1 && (
        <div className="rounded-lg border border-orange-400/30 bg-orange-500/10 p-2 text-xs">
          <div className="mb-0.5 font-semibold text-orange-300">Root cause up the line</div>
          <div className="flex flex-wrap items-center gap-1 font-mono">
            {inc.causalPath.map((id, i) => (
              <span key={id} className="flex items-center gap-1">
                {i > 0 && <span className="text-orange-400/60">→</span>}
                <span className={i === 0 ? 'rounded bg-orange-500/20 px-1 font-bold text-orange-200' : 'text-slate-400'}>{id}</span>
              </span>
            ))}
          </div>
          <div className="mt-0.5 text-slate-400">
            Symptom on {inc.machineId}, source is {name(inc.causalPath[0]!)}.
          </div>
        </div>
      )}

      {/* Impact */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="stat">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Downtime</div>
          <div className="font-semibold text-red-300">{formatEur(inc.impact.costPerMin)}/min</div>
        </div>
        <div className="stat">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">At risk</div>
          <div className="font-semibold">{inc.impact.partsAtRiskPerMin}/min</div>
        </div>
        <div className="stat">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Saving if fixed now</div>
          <div className="font-semibold text-emerald-300">{formatEur(inc.impact.savingsEur)}</div>
        </div>
      </div>

      {inc.diagnosis === 'non_disponibile' && (
        <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-200 ring-1 ring-inset ring-red-500/20" role="alert">
          AI diagnosis unavailable. Sent to the manager.
        </p>
      )}

      {d && (
        <div className="space-y-2">
          <div>
            <div className="section-title">Probable cause</div>
            <p className="font-medium">{d.causa_probabile}</p>
          </div>
          <blockquote className="rounded-lg border-l-2 border-sky-500/60 bg-slate-950/40 p-2 text-xs italic text-slate-300">
            “{d.citazione}”
            <footer className="mt-1 not-italic text-slate-500">
              {name(inc.causalPath[0]!)} manual · p. {d.pagina_manuale}{' '}
              {d.citazione_verificata ? <span className="text-emerald-400">✓ verified</span> : <span className="font-semibold text-red-400">⚠ unverified</span>}
            </footer>
          </blockquote>
          <div>
            <div className="section-title">Recommended action</div>
            <p>{d.azione_raccomandata}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
              <span className="pill bg-slate-800 ring-1 ring-inset ring-white/10">{ACTION_LABEL[d.codice_azione]}</span>
              <span className="pill bg-slate-800 ring-1 ring-inset ring-white/10">conf. {(d.confidenza * 100).toFixed(0)}%</span>
              {d.ricambi.length > 0 && <span className="truncate">parts: {d.ricambi.join(', ')}</span>}
            </div>
          </div>
        </div>
      )}

      {inc.similar.length > 0 && (
        <div>
          <div className="section-title">Factory memory</div>
          <ul className="mt-0.5 space-y-0.5 text-xs text-slate-400">
            {inc.similar.map((e) => (
              <li key={e.id} className="flex gap-1.5">
                <span className="text-slate-600">↺</span>
                <span>{formatMemoryCitation(e)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {inc.escalation && (
        <div className={`rounded-lg p-2 text-xs ${inc.escalation.escalate ? 'bg-red-500/10 text-red-200 ring-1 ring-inset ring-red-500/20' : 'bg-emerald-500/10 text-emerald-200 ring-1 ring-inset ring-emerald-500/20'}`}>
          {inc.escalation.escalate ? (
            <>
              <span className="font-semibold">Human decision required</span> · {inc.escalation.reasons.map((r) => REASON_LABEL[r]).join(' · ')}
            </>
          ) : (
            <span className="font-semibold">Safe for autonomy</span>
          )}
          {inc.autonomyMode && <span className="ml-1 text-slate-400">· {MODE_LABEL[inc.autonomyMode]}</span>}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {inc.status === 'in_coda' && (
          <>
            <button type="button" className="btn-primary" onClick={() => approve(inc.id)}>
              ✓ Approve
            </button>
            {inc.autonomyMode === 'bozza' && d && d.codice_azione !== 'intervento_manutentivo' && (
              <button type="button" className="btn" onClick={() => executeAction(inc.id, 'Tecnico')}>
                Run: {ACTION_LABEL[d.codice_azione]}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setRejecting((v) => !v)}>
              Reject
            </button>
          </>
        )}
        {inc.status === 'autonomo' && canUndo(inc.id) && (
          <button type="button" className="btn" onClick={() => undoAction(inc.id)}>
            ↩ Undo
          </button>
        )}
        {inc.status !== 'chiuso' && inc.status !== 'rifiutato' && <PhotoEvidence inc={inc} />}
        {(inc.status === 'approvato' || inc.status === 'autonomo') && !closing && (
          <button type="button" className="btn" onClick={() => setClosing(true)}>
            Close intervention
          </button>
        )}
        <button type="button" className="btn-ghost ml-auto" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
          {showLog ? 'Hide' : 'Reasoning'} ({inc.log.length})
        </button>
      </div>

      {rejecting && (
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            const err = reject(inc.id, reason);
            setRejectErr(err);
            if (!err) setRejecting(false);
          }}
        >
          <label className="section-title" htmlFor={`${inc.id}-reason`}>
            Why reject?
          </label>
          <textarea id={`${inc.id}-reason`} className="input" rows={2} maxLength={600} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(rejectErr)} />
          {rejectErr && <p className="text-xs text-red-400">{rejectErr}</p>}
          <button className="btn" type="submit">
            Confirm
          </button>
        </form>
      )}

      {inc.workOrder && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2 text-xs">
          <div className="mb-0.5 font-semibold text-sky-300">
            Work order {inc.workOrder.id} · {RISK_LABEL[inc.workOrder.priority].toLowerCase()} priority
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-slate-300">
            <dt className="text-slate-500">Machine</dt>
            <dd>{name(inc.workOrder.machineId)}</dd>
            <dt className="text-slate-500">Action</dt>
            <dd>{inc.workOrder.action}</dd>
            <dt className="text-slate-500">Parts</dt>
            <dd>{inc.workOrder.parts.length ? inc.workOrder.parts.join(', ') : 'none'}</dd>
            <dt className="text-slate-500">Manual</dt>
            <dd>{inc.workOrder.manualPage ? `p. ${inc.workOrder.manualPage}` : 'n/a'}</dd>
            <dt className="text-slate-500">Assignee</dt>
            <dd>{inc.workOrder.assignee}</dd>
          </dl>
          {inc.workOrder.closedAt && <div className="mt-1 text-emerald-400">Closed {new Date(inc.workOrder.closedAt).toLocaleString('en-GB')}</div>}
        </div>
      )}

      {closing && (
        <form
          className="space-y-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            const errs = await closeWorkOrder(inc.id, { realCause: form.realCause, fix: form.fix, durationMin: Number(form.durationMin) });
            setErrors(errs);
            if (!Object.keys(errs).length) setClosing(false);
          }}
        >
          {(
            [
              ['realCause', 'Actual root cause', 'textarea'],
              ['fix', 'Work performed', 'textarea'],
              ['durationMin', 'Duration (min)', 'number'],
            ] as const
          ).map(([k, label, type]) => (
            <div key={k}>
              <label className="section-title" htmlFor={`${inc.id}-${k}`}>
                {label}
              </label>
              {k === 'realCause' ? (
                <>
                  <select
                    id={`${inc.id}-${k}`}
                    className="input"
                    value={causeChoice}
                    onChange={(e) => {
                      setCauseChoice(e.target.value);
                      setForm({ ...form, realCause: e.target.value === OTHER_CAUSE ? '' : e.target.value });
                    }}
                    aria-invalid={Boolean(errors[k])}
                  >
                    <option value="" disabled>
                      Select the confirmed cause…
                    </option>
                    {(['ai', 'memory', 'manual'] as const).map((src) => {
                      const opts = causes.filter((c) => c.source === src);
                      if (!opts.length) return null;
                      return (
                        <optgroup key={src} label={src === 'ai' ? 'AI diagnosis' : src === 'memory' ? 'Confirmed before on this machine' : 'Typical causes (manual)'}>
                          {opts.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                    <option value={OTHER_CAUSE}>Other (describe)…</option>
                  </select>
                  {causeChoice === OTHER_CAUSE && (
                    <textarea
                      aria-label="Describe the actual root cause"
                      className="input mt-1"
                      rows={2}
                      autoFocus
                      value={form.realCause}
                      onChange={(e) => setForm({ ...form, realCause: e.target.value })}
                      aria-invalid={Boolean(errors[k])}
                    />
                  )}
                </>
              ) : type === 'textarea' ? (
                <textarea id={`${inc.id}-${k}`} className="input" rows={2} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-invalid={Boolean(errors[k])} />
              ) : (
                <input id={`${inc.id}-${k}`} type="number" min={1} max={1440} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-invalid={Boolean(errors[k])} />
              )}
              {errors[k] && <p className="text-xs text-red-400">{errors[k]}</p>}
            </div>
          ))}
          {errors._form && <p className="text-xs text-red-400">{errors._form}</p>}
          <button type="submit" className="btn-primary">
            Save &amp; close
          </button>
        </form>
      )}

      {showLog && (
        <ol className="max-h-44 space-y-0.5 overflow-auto rounded-lg bg-slate-950/60 p-2 font-mono text-[11px] text-slate-400 ring-1 ring-inset ring-white/5">
          {inc.log.map((l, i) => (
            <li key={i} className={l.kind === 'errore' ? 'text-red-300' : l.kind === 'llm' ? 'text-sky-300' : l.kind === 'decisione' ? 'text-amber-200' : l.kind === 'azione' ? 'text-emerald-300' : ''}>
              <span className="text-slate-600">{new Date(l.ts).toLocaleTimeString('en-GB')}</span> {AUTHOR_LABEL[l.author ?? 'Sistema']} · {l.message}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
