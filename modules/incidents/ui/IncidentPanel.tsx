'use client';
/** Approval queue + selected incident (Req 11.1, 13.5). Sorted by priority desc, then oldest first. */
import { useStore } from '@/modules/store';
import { INCIDENT_STATUS_LABEL } from '../labels';
import { IncidentCard } from './IncidentCard';

export function IncidentPanel() {
  const incidents = useStore((s) => s.incidents);
  const selected = useStore((s) => s.selectedIncident);
  const select = useStore((s) => s.selectIncident);
  const all = Object.values(incidents);
  const queue = all
    .filter((i) => i.status === 'in_coda' && i.escalation?.escalate)
    .sort((a, b) => b.priority - a.priority || (a.createdAt < b.createdAt ? -1 : 1));
  const others = all.filter((i) => !queue.includes(i)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const current = (selected && incidents[selected]) || queue[0] || others[0];

  return (
    <section aria-labelledby="inc-h" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 id="inc-h" className="section-title">
          Incidents
        </h2>
        {queue.length > 0 && <span className="pill bg-red-500/20 text-red-200 ring-1 ring-inset ring-red-400/40">{queue.length} to review</span>}
      </div>
      {all.length === 0 ? (
        <p className="card p-3 text-xs text-slate-500">No incidents yet. Press Start, then Inject fault to see FactoryPilot work.</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {[...queue, ...others].map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => select(i.id)}
                aria-pressed={current?.id === i.id}
                className={`pill transition ${current?.id === i.id ? 'bg-sky-500/25 text-sky-100 ring-1 ring-inset ring-sky-400/50' : 'bg-slate-800 text-slate-400 ring-1 ring-inset ring-white/10 hover:text-slate-200'} ${queue.includes(i) ? '!ring-red-400/50' : ''}`}
                title={INCIDENT_STATUS_LABEL[i.status]}
              >
                <span className="font-mono">{i.id}</span> · {i.machineId}
              </button>
            </li>
          ))}
        </ul>
      )}
      {current && <IncidentCard key={current.id} inc={current} />}
    </section>
  );
}
