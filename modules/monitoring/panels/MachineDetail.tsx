'use client';
/** Req 6: machine detail with current values, 60 s charts with thresholds, incidents list. */
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts';
import { useStore } from '@/modules/store';
import { INCIDENT_STATUS_LABEL, STATUS_LABEL } from '@/modules/incidents/labels';

export function MachineDetail() {
  const id = useStore((s) => s.selectedMachine);
  const factory = useStore((s) => s.factory);
  const history = useStore((s) => s.history);
  const status = useStore((s) => (id ? s.statuses[id] : undefined));
  const incidents = useStore((s) => s.incidents);
  const running = useStore((s) => s.running);
  const selectIncident = useStore((s) => s.selectIncident);
  const m = factory.machines.find((x) => x.id === id);
  if (!m) return null;

  const list = Object.values(incidents).filter((i) => i.machineId === m.id || i.causalPath[0] === m.id);
  const open = list.filter((i) => i.status !== 'chiuso').sort((a, b) => b.priority - a.priority);
  const closed = list.filter((i) => i.status === 'chiuso').slice(-20).reverse();

  return (
    <section aria-labelledby="detail-h" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="detail-h" className="text-sm font-semibold">
          {m.id} · {m.name}
        </h2>
        <span className="text-xs text-slate-400">
          {m.type.replace(/_/g, ' ')} · status <strong className="text-slate-100">{status ? STATUS_LABEL[status] : '–'}</strong>
        </span>
      </div>
      {!running && <p className="text-xs text-amber-300">Simulation paused: data not updating</p>}
      <div className="grid grid-cols-1 gap-2">
        {m.sensors.map((s) => {
          const data = history[m.id]?.[s.id] ?? [];
          const last = data.at(-1)?.value;
          const color = last === undefined ? '#94a3b8' : last > s.crit ? '#ef4444' : last > s.warn ? '#eab308' : '#22c55e';
          return (
            <div key={s.id} className="rounded-md bg-slate-900/60 p-2">
              <div className="flex justify-between text-xs">
                <span>{s.name}</span>
                <span className="font-mono" style={{ color }}>
                  {last?.toFixed(2) ?? '–'} {s.unit}
                </span>
              </div>
              <div className="h-14" aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <YAxis hide domain={[Math.min(s.nominal[0], ...data.map((d) => d.value)) * 0.95, Math.max(s.crit * 1.05, ...data.map((d) => d.value))]} />
                    <ReferenceLine y={s.warn} stroke="#eab308" strokeDasharray="3 3" />
                    <ReferenceLine y={s.crit} stroke="#ef4444" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="value" stroke={color} dot={false} isAnimationActive={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[10px] text-slate-500">
                warning {s.warn} · critical {s.crit} {s.unit}
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-400">Incidents</h3>
        {open.length + closed.length === 0 ? (
          <p className="text-xs text-slate-500">No incidents for this machine.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {[...open, ...closed].map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => selectIncident(i.id)} className="w-full rounded px-1 text-left hover:bg-slate-800">
                  {i.id} · {INCIDENT_STATUS_LABEL[i.status]} · priority {Math.round(i.priority)} · {new Date(i.createdAt).toLocaleTimeString('en-GB')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
