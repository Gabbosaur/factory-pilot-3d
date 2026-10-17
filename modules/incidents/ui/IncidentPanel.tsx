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
    <section aria-labelledby="inc-h" className="space-y-3">
      <div>
        <h2 id="inc-h" className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Approval queue ({queue.length})
        </h2>
        {all.length === 0 ? (
          <p className="text-xs text-slate-500">No incidents yet. Start the simulation and inject a fault.</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {[...queue, ...others].map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => select(i.id)}
                  aria-pressed={current?.id === i.id}
                  className={`rounded px-2 py-0.5 text-xs ${current?.id === i.id ? 'bg-sky-700' : 'bg-slate-800 hover:bg-slate-700'} ${queue.includes(i) ? 'ring-1 ring-red-500' : ''}`}
                >
                  {i.id} · {i.machineId} · {INCIDENT_STATUS_LABEL[i.status]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {current && <IncidentCard key={current.id} inc={current} />}
    </section>
  );
}
