'use client';
/** Req 6: machine detail with current values, 60 s charts with thresholds, incidents list. */
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts';
import { useStore } from '@/modules/store';
import { INCIDENT_STATUS_LABEL, STATUS_LABEL, STATUS_PILL } from '@/modules/incidents/labels';

export function MachineDetail() {
  const id = useStore((s) => s.selectedMachine);
  const factory = useStore((s) => s.factory);
  const history = useStore((s) => s.history);
  const status = useStore((s) => (id ? s.statuses[id] : undefined));
  const incidents = useStore((s) => s.incidents);
  const running = useStore((s) => s.running);
  const selectIncident = useStore((s) => s.selectIncident);
  const m = factory.machines.find((x) => x.id === id);

  if (!m) {
    return (
      <section className="card p-3 text-xs text-slate-500">
        <h2 className="section-title mb-1">Machine detail</h2>
        Select a machine on the map or the list to see its sensors and history.
      </section>
    );
  }

  const list = Object.values(incidents).filter((i) => i.machineId === m.id || i.causalPath[0] === m.id);
  const open = list.filter((i) => i.status !== 'chiuso').sort((a, b) => b.priority - a.priority);
  const closed = list.filter((i) => i.status === 'chiuso').slice(-20).reverse();

  return (
    <section aria-labelledby="detail-h" className="card space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="detail-h" className="truncate text-sm font-semibold">
          <span className="font-mono text-xs text-slate-500">{m.id}</span> {m.name}
        </h2>
        {status && <span className={`pill ${STATUS_PILL[status]}`}>{STATUS_LABEL[status]}</span>}
      </div>
      <div className="text-[11px] text-slate-500">{m.type.replace(/_/g, ' ')}{!running && ' · paused'}</div>

      <div className="grid grid-cols-1 gap-2">
        {m.sensors.map((s) => {
          const data = history[m.id]?.[s.id] ?? [];
          const last = data.at(-1)?.value;
          const color = last === undefined ? '#94a3b8' : last > s.crit ? '#ef4444' : last > s.warn ? '#eab308' : '#22c55e';
          return (
            <div key={s.id} className="rounded-lg border border-white/5 bg-slate-950/40 p-2">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-slate-300">{s.name}</span>
                <span className="font-mono font-semibold" style={{ color }}>
                  {last?.toFixed(2) ?? '–'} <span className="text-[10px] text-slate-500">{s.unit}</span>
                </span>
              </div>
              <div className="h-12" aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
                    <YAxis hide domain={[Math.min(s.nominal[0], ...data.map((d) => d.value)) * 0.95, Math.max(s.crit * 1.05, ...data.map((d) => d.value))]} />
                    <ReferenceLine y={s.warn} stroke="#eab308" strokeOpacity={0.5} strokeDasharray="3 3" />
                    <ReferenceLine y={s.crit} stroke="#ef4444" strokeOpacity={0.5} strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="value" stroke={color} dot={false} isAnimationActive={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <h3 className="section-title mb-1">Incidents</h3>
        {open.length + closed.length === 0 ? (
          <p className="text-xs text-slate-500">None for this machine.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {[...open, ...closed].map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => selectIncident(i.id)} className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left transition hover:bg-white/5">
                  <span className="font-mono text-slate-400">{i.id}</span>
                  <span className="text-slate-500">{INCIDENT_STATUS_LABEL[i.status]} · P{Math.round(i.priority)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
