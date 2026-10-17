'use client';
/** Req 6: machine detail with current values, 60 s charts with thresholds, incidents list. */
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts';
import { useStore } from '@/modules/store';
import { INCIDENT_STATUS_LABEL, STATUS_LABEL, STATUS_PILL } from '@/modules/incidents/labels';
import { useHistoryUi } from './HistoryOverlay';

export function MachineDetail({ onClose }: { onClose?: () => void } = {}) {
  const id = useStore((s) => s.selectedMachine);
  const factory = useStore((s) => s.factory);
  const history = useStore((s) => s.history);
  const status = useStore((s) => (id ? s.statuses[id] : undefined));
  const incidents = useStore((s) => s.incidents);
  const running = useStore((s) => s.running);
  const selectIncident = useStore((s) => s.selectIncident);
  const showHistory = useHistoryUi((s) => s.showHistory);
  const production = useStore((s) => s.production);
  const lineRunning = useStore((s) => s.line.running);
  const machineSpeed = useStore((s) => (id ? (s.speed[id] ?? 1) : 1));
  const m = factory.machines.find((x) => x.id === id);

  if (!m) {
    return (
      <section className="card p-3 text-xs text-slate-500">
        <h2 className="section-title mb-1">Machine detail</h2>
        Select a machine on the map or the list to see its sensors and history.
      </section>
    );
  }

  // Serial line: every bottle passes every stage; parallel machines of the same type share the flow.
  const sameType = factory.machines.filter((x) => x.type === m.type).length || 1;
  const processed = production.started / sameType;
  const rejectedHere = production.rejects[m.id] ?? 0;

  const list = Object.values(incidents).filter((i) => i.machineId === m.id || i.causalPath[0] === m.id);
  const open = list.filter((i) => i.status !== 'chiuso').sort((a, b) => b.priority - a.priority);
  const closed = list.filter((i) => i.status === 'chiuso').slice(-20).reverse();

  return (
    <section aria-labelledby="detail-h" className="card space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="detail-h" className="truncate text-sm font-semibold">
          <span className="font-mono text-xs text-slate-500">{m.id}</span> {m.name}
        </h2>
        <span className="flex shrink-0 items-center gap-2">
          {status && <span className={`pill ${STATUS_PILL[status]}`}>{STATUS_LABEL[status]}</span>}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close machine detail" className="rounded px-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100">
              ✕
            </button>
          )}
        </span>
      </div>
      <div className="text-[11px] text-slate-500">{m.type.replace(/_/g, ' ')}{!running && ' · paused'}</div>
      <button type="button" onClick={() => showHistory(m.id)} className="text-left text-xs text-sky-400 hover:underline">
        History (48 h) · or right-click a machine
      </button>

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
                  {last?.toFixed(2) ?? 'n/a'} <span className="text-[10px] text-slate-500">{s.unit}</span>
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
        <h3 className="section-title mb-1">Production this shift</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">Bottles processed</dt>
          <dd className="text-right font-mono">{Math.floor(processed).toLocaleString('en-GB')}</dd>
          <dt className="text-slate-500">Rejected here</dt>
          <dd className="text-right font-mono">
            {Math.floor(rejectedHere).toLocaleString('en-GB')}
            {processed > 0 && <span className="text-slate-500"> · {((rejectedHere / processed) * 100).toFixed(2)}%</span>}
          </dd>
          <dt className="text-slate-500">Nominal rate</dt>
          <dd className="text-right font-mono">{(m.partsPerMin * 60).toLocaleString('en-GB')} /h</dd>
          <dt className="text-slate-500">Speed</dt>
          <dd className={`text-right font-mono ${!lineRunning ? 'text-red-400' : machineSpeed < 1 ? 'text-amber-300' : ''}`}>
            {!lineRunning ? 'stopped' : `${Math.round(machineSpeed * 100)}%`}
          </dd>
          <dt className="text-slate-500">Downtime cost</dt>
          <dd className="text-right font-mono">€{m.downtimeCostPerMin}/min</dd>
        </dl>
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
