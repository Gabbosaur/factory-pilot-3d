'use client';
/** Req 8.9, 8.10, 9.6, 10, 11, 13.6, 15.3, 15.7 – the incident as the technician/manager sees it. */
import { useState } from 'react';
import { useStore } from '@/modules/store';
import { REASON_LABEL } from '../escalation';
import { ACTION_LABEL, MODE_LABEL } from '../autonomy';
import { formatEur } from '../impact';
import { AUTHOR_LABEL, INCIDENT_STATUS_LABEL, RISK_LABEL } from '../labels';
import { formatMemoryCitation } from '../memory/filter';
import { approve, canUndo, closeWorkOrder, executeAction, reject, undoAction } from '../orchestrator';
import type { Incident } from '@/shared/types';

const RISK_STYLE = { basso: 'bg-green-700', medio: 'bg-yellow-600', alto: 'bg-red-700' } as const;

export function IncidentCard({ inc }: { inc: Incident }) {
  const factory = useStore((s) => s.factory);
  const name = (id: string) => factory.machines.find((m) => m.id === id)?.name ?? id;
  const d = inc.diagnosis && inc.diagnosis !== 'non_disponibile' ? inc.diagnosis : null;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [rejectErr, setRejectErr] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [form, setForm] = useState({ realCause: '', fix: '', durationMin: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showLog, setShowLog] = useState(false);

  const analysing = inc.status === 'analisi';

  return (
    <article className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-sm" aria-labelledby={`${inc.id}-h`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${inc.id}-h`} className="font-semibold">
          {inc.id} · {name(inc.machineId)}
        </h3>
        <span className="rounded bg-slate-700 px-2 py-0.5 text-xs">{INCIDENT_STATUS_LABEL[inc.status]}</span>
      </header>

      {inc.causalPath.length > 1 && (
        <div className="rounded-md border border-orange-500/50 bg-orange-500/10 p-2 text-xs">
          <strong className="text-orange-300">Root cause traced back along the line:</strong>{' '}
          {inc.causalPath.map((id, i) => (
            <span key={id}>
              {i > 0 && ' → '}
              <span className={i === 0 ? 'font-bold text-orange-200' : ''}>{id}</span>
            </span>
          ))}
          <div className="text-slate-400">
            The symptom shows on {inc.machineId}, but the problem starts at {name(inc.causalPath[0]!)}.
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded bg-slate-800 p-1.5">
          <div className="text-slate-400">Downtime cost</div>
          <div className="font-semibold">{formatEur(inc.impact.costPerMin)}/min</div>
        </div>
        <div className="rounded bg-slate-800 p-1.5">
          <div className="text-slate-400">Parts at risk</div>
          <div className="font-semibold">{inc.impact.partsAtRiskPerMin}/min</div>
        </div>
        <div className="rounded bg-slate-800 p-1.5">
          <div className="text-slate-400">Savings if you act now</div>
          <div className="font-semibold">{formatEur(inc.impact.savingsEur)}</div>
        </div>
      </div>
      <p className="-mt-1 text-[10px] text-slate-500">
        Estimates based on the factory configuration, {inc.impact.horizonMin}-min horizon. Priority {Math.round(inc.priority)}.
      </p>

      {analysing && !d && (
        <p className="animate-pulse text-sky-300" role="status">
          AI analysis running on AMD Token Factory…
        </p>
      )}

      {inc.diagnosis === 'non_disponibile' && (
        <p className="rounded bg-red-900/40 p-2 text-red-200" role="alert">
          AI diagnosis unavailable: incident forwarded to the manager.
        </p>
      )}

      {d && (
        <div className="space-y-1.5">
          <div>
            <span className="text-xs uppercase text-slate-400">Probable cause</span>
            <p className="font-medium">{d.causa_probabile}</p>
          </div>
          <blockquote className="border-l-2 border-sky-500 pl-2 text-xs italic text-slate-300">
            “{d.citazione}”
            <footer className="not-italic text-slate-400">
              {name(inc.causalPath[0]!)} manual, p. {d.pagina_manuale}{' '}
              {d.citazione_verificata ? (
                <span className="text-green-400">✓ verified</span>
              ) : (
                <span className="font-semibold text-red-400">⚠ citation not verified</span>
              )}
            </footer>
          </blockquote>
          <div>
            <span className="text-xs uppercase text-slate-400">Recommended action</span>
            <p>{d.azione_raccomandata}</p>
            <p className="text-xs text-slate-400">
              {ACTION_LABEL[d.codice_azione]} · confidence {(d.confidenza * 100).toFixed(0)}%
              {d.ricambi.length > 0 && ` · spare parts: ${d.ricambi.join(', ')}`}
            </p>
          </div>
        </div>
      )}

      {inc.risk && (
        <p className="text-xs">
          <span className={`mr-1 rounded px-1.5 py-0.5 font-semibold text-white ${RISK_STYLE[inc.risk.livello_rischio]}`}>
            {RISK_LABEL[inc.risk.livello_rischio]} risk
          </span>
          <span className="text-slate-300">{inc.risk.motivazione}</span>
        </p>
      )}

      <div>
        <span className="text-xs uppercase text-slate-400">Factory memory</span>
        {inc.similar.length ? (
          <ul className="list-disc pl-4 text-xs text-slate-300">
            {inc.similar.map((e) => (
              <li key={e.id}>{formatMemoryCitation(e)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No similar intervention in memory.</p>
        )}
      </div>

      {inc.escalation && (
        <div className={`rounded p-2 text-xs ${inc.escalation.escalate ? 'bg-red-950/60 text-red-200' : 'bg-green-950/60 text-green-200'}`}>
          {inc.escalation.escalate ? (
            <>
              <strong>Manager decision required:</strong> {inc.escalation.reasons.map((r) => REASON_LABEL[r]).join(' · ')}
            </>
          ) : (
            <>No escalation required by the safety rule.</>
          )}
          {inc.autonomyMode && <div className="mt-0.5 text-slate-300">Autonomy: {MODE_LABEL[inc.autonomyMode]}</div>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {inc.status === 'in_coda' && (
          <>
            <button type="button" className="btn-primary" onClick={() => approve(inc.id)}>
              Approve and create work order
            </button>
            {inc.autonomyMode === 'bozza' && d && d.codice_azione !== 'intervento_manutentivo' && (
              <button type="button" className="btn" onClick={() => executeAction(inc.id, 'Tecnico')}>
                Run draft: {ACTION_LABEL[d.codice_azione]}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setRejecting((v) => !v)}>
              Reject
            </button>
          </>
        )}
        {inc.status === 'autonomo' && canUndo(inc.id) && (
          <button type="button" className="btn" onClick={() => undoAction(inc.id)}>
            Undo automatic action
          </button>
        )}
        {(inc.status === 'approvato' || inc.status === 'autonomo') && !closing && (
          <button type="button" className="btn" onClick={() => setClosing(true)}>
            Close intervention
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
          {showLog ? 'Hide' : 'Show'} reasoning ({inc.log.length})
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
          <label className="block text-xs" htmlFor={`${inc.id}-reason`}>
            Reason for rejection
          </label>
          <textarea id={`${inc.id}-reason`} className="input" maxLength={600} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(rejectErr)} />
          {rejectErr && <p className="text-xs text-red-400">{rejectErr}</p>}
          <button className="btn" type="submit">
            Confirm rejection
          </button>
        </form>
      )}

      {inc.workOrder && (
        <div className="rounded border border-sky-700 bg-sky-950/40 p-2 text-xs">
          <strong>Work order {inc.workOrder.id}</strong> · {RISK_LABEL[inc.workOrder.priority].toLowerCase()} priority · {inc.workOrder.assignee}
          <div>Machine: {name(inc.workOrder.machineId)}</div>
          <div>Cause: {inc.workOrder.cause}</div>
          <div>Action: {inc.workOrder.action}</div>
          <div>Spare parts: {inc.workOrder.parts.length ? inc.workOrder.parts.join(', ') : 'none required'}</div>
          <div>Manual: {inc.workOrder.manualPage ? `p. ${inc.workOrder.manualPage}` : 'reference not available'}</div>
          {inc.workOrder.closedAt && <div className="text-green-400">Closed on {new Date(inc.workOrder.closedAt).toLocaleString('en-GB')}</div>}
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
              ['durationMin', 'Duration (minutes)', 'number'],
            ] as const
          ).map(([k, label, type]) => (
            <div key={k}>
              <label className="block text-xs" htmlFor={`${inc.id}-${k}`}>
                {label}
              </label>
              {type === 'textarea' ? (
                <textarea id={`${inc.id}-${k}`} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-invalid={Boolean(errors[k])} />
              ) : (
                <input id={`${inc.id}-${k}`} type="number" min={1} max={1440} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-invalid={Boolean(errors[k])} />
              )}
              {errors[k] && <p className="text-xs text-red-400">{errors[k]}</p>}
            </div>
          ))}
          {errors._form && <p className="text-xs text-red-400">{errors._form}</p>}
          <button type="submit" className="btn-primary">
            Save to memory and close
          </button>
        </form>
      )}

      {showLog && (
        <ol className="max-h-48 space-y-0.5 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] text-slate-300">
          {inc.log.map((l, i) => (
            <li key={i} className={l.kind === 'errore' ? 'text-red-300' : l.kind === 'llm' ? 'text-sky-300' : l.kind === 'decisione' ? 'text-amber-200' : ''}>
              {new Date(l.ts).toLocaleTimeString('en-GB')} [{AUTHOR_LABEL[l.author ?? 'Sistema']}] {l.message}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
