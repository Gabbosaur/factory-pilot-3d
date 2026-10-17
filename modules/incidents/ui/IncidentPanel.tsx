'use client';
/** Incidents section: compact list, click a row to open full detail (Req 11.1, 13.5). */
import { useEffect, useState } from 'react';
import { useStore } from '@/modules/store';
import { INCIDENT_STATUS_LABEL, STATUS_DOT } from '../labels';
import { formatEur } from '../impact';
import { IncidentCard } from './IncidentCard';
import type { Incident } from '@/shared/types';

function statusDot(inc: Incident): string {
  if (inc.escalation?.escalate && inc.status === 'in_coda') return 'bg-red-400 animate-pulse';
  if (inc.status === 'chiuso') return 'bg-slate-500';
  if (inc.status === 'autonomo' || inc.status === 'approvato') return 'bg-emerald-400';
  if (inc.status === 'analisi') return 'bg-sky-400 animate-pulse';
  return STATUS_DOT.giallo;
}

export function IncidentPanel() {
  const incidents = useStore((s) => s.incidents);
  const selected = useStore((s) => s.selectedIncident);
  const select = useStore((s) => s.selectIncident);
  const [openId, setOpenId] = useState<string | null>(null);

  // A notification's "View incident" sets selectedIncident; open its detail here.
  useEffect(() => {
    if (selected && incidents[selected]) setOpenId(selected);
  }, [selected, incidents]);

  const all = Object.values(incidents);
  const queue = all
    .filter((i) => i.status === 'in_coda' && i.escalation?.escalate)
    .sort((a, b) => b.priority - a.priority || (a.createdAt < b.createdAt ? -1 : 1));
  const rest = all.filter((i) => !queue.includes(i)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const ordered = [...queue, ...rest];

  const open = openId ? incidents[openId] : null;

  // Detail view
  if (open) {
    return (
      <section aria-label="Incident detail" className="space-y-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setOpenId(null);
          }}
        >
          ← All incidents
        </button>
        <IncidentCard key={open.id} inc={open} />
      </section>
    );
  }

  // List view
  return (
    <section aria-labelledby="inc-h" className="space-y-2">
      {all.length === 0 ? (
        <p className="card p-3 text-xs text-slate-500">No incidents yet. Press Start, then Inject fault to see FactoryPilot work.</p>
      ) : (
        <ul className="space-y-1.5">
          {ordered.map((i) => {
            const needsYou = i.escalation?.escalate && i.status === 'in_coda';
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(i.id);
                    select(i.id);
                  }}
                  className={`card flex w-full items-center gap-3 p-2.5 text-left transition hover:ring-1 hover:ring-inset hover:ring-white/20 ${selected === i.id ? 'ring-1 ring-inset ring-sky-400/40' : ''}`}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(i)}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{i.id}</span>
                      <span className="truncate text-sm font-medium">{i.machineId}</span>
                    </span>
                    <span className="text-xs text-slate-500">{INCIDENT_STATUS_LABEL[i.status]}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs font-semibold text-red-300">{formatEur(i.impact.costPerMin)}/min</span>
                    {needsYou ? (
                      <span className="text-[10px] font-semibold text-red-400">Needs you</span>
                    ) : (
                      <span className="text-[10px] text-slate-500">P{Math.round(i.priority)}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-slate-600">›</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
