'use client';
/**
 * Machine view (production & quality engineer): station KPIs, reliability (MTBF/MTTR), one SPC control
 * chart per sensor with Cpk and out-of-control signals, 48 h history, incidents and maintenance history.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { useStore } from '@/modules/store';
import { kpis } from '@/modules/monitoring/production/production';
import { condition, controlLimits, cpk, isProductCharacteristic, outOfSpecPct, reliability, spcSignal, stats } from '@/modules/monitoring/quality/spc';
import { localMemory } from '@/modules/incidents/memory/local';
import { STATUS_LABEL, STATUS_PILL } from '@/modules/incidents/labels';
import { IncidentCard } from '@/modules/incidents/ui/IncidentCard';
import { MetricsPanel } from '@/modules/incidents/ui/MetricsPanel';
import { AutonomyEditor } from '@/modules/incidents/ui/AutonomyEditor';
import { QualityHolds } from '@/modules/quality/QualityHolds';
import { MachineHistory } from '@/modules/monitoring/panels/MachineHistory';
import { useHistoryUi } from '@/modules/monitoring/panels/HistoryOverlay';
import { Breadcrumb } from '@/modules/shell/Breadcrumb';
import type { MemoryEntry, SensorConfig } from '@/shared/types';

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function Kpi({ label, value, sub, tone = 'text-slate-100' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-900/60 px-3 py-2 ring-1 ring-inset ring-white/10">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`truncate font-mono text-lg font-semibold ${tone}`}>{value}</div>
      {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/** Product quality characteristic (fill volume, capping torque): control chart vs spec, Cpk, out-of-spec share. */
function SpcCard({ sensor, values, stopped }: { sensor: SensorConfig; values: number[]; stopped: boolean }) {
  const l = controlLimits(sensor);
  const spec = sensor.spec!;
  const live = stopped ? [] : values;
  const { mean, sd } = stats(live);
  const c = cpk(live, sensor);
  const oos = outOfSpecPct(live, sensor);
  const signal = stopped ? null : spcSignal(values, l);
  const last = values.at(-1);
  const outOfSpec = last !== undefined && (last < spec.lsl || last > spec.usl);
  const color = last === undefined ? '#94a3b8' : outOfSpec ? '#ef4444' : signal ? '#eab308' : '#38bdf8';
  const data = values.map((v, i) => ({ i, v }));
  const lo = Math.min(spec.lsl, l.lcl, ...values);
  const hi = Math.max(spec.usl, l.ucl, ...values);
  const pad = (hi - lo) * 0.08 || 0.1;
  const cTone = c === null ? 'text-slate-400' : c >= 1.33 ? 'text-emerald-300' : c >= 1 ? 'text-amber-300' : 'text-red-400';

  return (
    <section className="card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{sensor.name}</h3>
        <span className="font-mono text-lg font-semibold" style={{ color }}>
          {last === undefined ? '–' : `${fmt(last)} ${sensor.unit}`}
        </span>
      </div>
      <div className="mt-1 h-36" aria-hidden="true">
        {values.length < 2 ? (
          <p className="pt-12 text-center text-xs text-slate-500">Collecting live data…</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 44, bottom: 0, left: -10 }}>
              <YAxis domain={[lo - pad, hi + pad]} tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={(v: number) => v.toFixed(1)} />
              <ReferenceLine y={spec.usl} stroke="#ef4444" strokeDasharray="2 3" label={{ value: 'USL', position: 'right', fill: '#ef4444', fontSize: 9 }} />
              <ReferenceLine y={l.ucl} stroke="#a78bfa" strokeDasharray="4 3" label={{ value: 'UCL', position: 'right', fill: '#a78bfa', fontSize: 9 }} />
              <ReferenceLine y={l.center} stroke="#475569" label={{ value: 'CL', position: 'right', fill: '#64748b', fontSize: 9 }} />
              <ReferenceLine y={l.lcl} stroke="#a78bfa" strokeDasharray="4 3" label={{ value: 'LCL', position: 'right', fill: '#a78bfa', fontSize: 9 }} />
              <ReferenceLine y={spec.lsl} stroke="#ef4444" strokeDasharray="2 3" label={{ value: 'LSL', position: 'right', fill: '#ef4444', fontSize: 9 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }} labelFormatter={() => ''} formatter={(v) => [`${fmt(Number(v))} ${sensor.unit}`, sensor.name]} />
              <Line type="monotone" dataKey="v" stroke={color} dot={false} isAnimationActive={false} strokeWidth={1.8} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <dl className="mt-1 grid grid-cols-5 gap-2 text-[11px]">
        <div>
          <dt className="text-slate-500">Mean</dt>
          <dd className="font-mono">{fmt(mean)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">σ</dt>
          <dd className="font-mono">{fmt(sd, 3)}</dd>
        </div>
        <div title="Process capability vs the specification: ≥1.33 capable, 1–1.33 marginal, <1 not capable">
          <dt className="text-slate-500">Cpk</dt>
          <dd className={`font-mono ${cTone}`}>{c === null ? '–' : fmt(c)}</dd>
        </div>
        <div title="Share of the last 60 s outside LSL–USL">
          <dt className="text-slate-500">Out of spec</dt>
          <dd className={`font-mono ${oos ? 'text-red-400' : ''}`}>{oos === null ? '–' : `${oos.toFixed(1)}%`}</dd>
        </div>
        <div>
          <dt className="text-slate-500">SPC</dt>
          <dd className={signal ? 'text-amber-300' : stopped || values.length < 10 ? 'text-slate-500' : 'text-emerald-300'} title={signal?.message}>
            {stopped ? 'stopped' : values.length < 10 ? '–' : signal ? (signal.rule === 'beyond_limits' ? 'Out of control' : 'Drift') : 'In control'}
          </dd>
        </div>
      </dl>
      {signal && <p className="mt-1 text-[11px] text-amber-300/90">{signal.message}</p>}
      <p className="mt-1 text-[10px] text-slate-500">
        spec {spec.lsl}–{spec.usl} {sensor.unit} · target {fmt(l.center)} · Cpk on the last 60 s (indicative: capability studies need a longer stable run)
      </p>
    </section>
  );
}

/** Machine condition signal (vibration, temperatures, current): zone vs limits, trend, time to the trip limit. */
function ConditionCard({ sensor, values, stopped }: { sensor: SensorConfig; values: number[]; stopped: boolean }) {
  const cond = stopped ? null : condition(values, sensor);
  const last = values.at(-1);
  const color = last === undefined ? '#94a3b8' : last > sensor.crit ? '#ef4444' : last > sensor.warn ? '#eab308' : '#38bdf8';
  const data = values.map((v, i) => ({ i, v }));
  const lo = Math.min(sensor.nominal[0], ...values);
  const hi = Math.max(sensor.warn, ...values);
  const pad = (hi - lo) * 0.08 || 0.1;
  const zoneLabel = { normal: 'Normal', warning: 'Warning zone', trip: 'Trip zone' } as const;
  const zoneTone = { normal: 'text-emerald-300', warning: 'text-amber-300', trip: 'text-red-400' } as const;
  const isVibration = /vib/i.test(sensor.id);

  return (
    <section className="card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{sensor.name}</h3>
        <span className="font-mono text-lg font-semibold" style={{ color }}>
          {last === undefined ? '–' : `${fmt(last)} ${sensor.unit}`}
        </span>
      </div>
      <div className="mt-1 h-28" aria-hidden="true">
        {values.length < 2 ? (
          <p className="pt-10 text-center text-xs text-slate-500">Collecting live data…</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 44, bottom: 0, left: -10 }}>
              <YAxis domain={[lo - pad, hi + pad]} tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={(v: number) => v.toFixed(1)} />
              <ReferenceLine y={sensor.warn} stroke="#eab308" strokeDasharray="2 3" label={{ value: 'warn', position: 'right', fill: '#eab308', fontSize: 9 }} />
              {hi + pad >= sensor.crit && <ReferenceLine y={sensor.crit} stroke="#ef4444" strokeDasharray="2 3" label={{ value: 'trip', position: 'right', fill: '#ef4444', fontSize: 9 }} />}
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }} labelFormatter={() => ''} formatter={(v) => [`${fmt(Number(v))} ${sensor.unit}`, sensor.name]} />
              <Line type="monotone" dataKey="v" stroke={color} dot={false} isAnimationActive={false} strokeWidth={1.8} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <dl className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-slate-500">Zone</dt>
          <dd className={cond ? zoneTone[cond.zone] : 'text-slate-500'}>{stopped ? 'stopped' : cond ? zoneLabel[cond.zone] : '–'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Trend</dt>
          <dd className="font-mono">{cond && values.length >= 10 ? `${cond.slopePerMin >= 0 ? '+' : ''}${fmt(cond.slopePerMin)} ${sensor.unit}/min` : '–'}</dd>
        </div>
        <div title="At the current trend (linear extrapolation)">
          <dt className="text-slate-500">Time to trip</dt>
          <dd className={`font-mono ${cond?.minutesToTrip !== null && cond?.minutesToTrip !== undefined && cond.minutesToTrip < 5 ? 'text-red-400' : ''}`}>
            {cond?.minutesToTrip !== null && cond?.minutesToTrip !== undefined && cond.minutesToTrip < 60 ? `${cond.minutesToTrip.toFixed(1)} min` : 'stable'}
          </dd>
        </div>
      </dl>
      <p className="mt-1 text-[10px] text-slate-500">
        {isVibration ? 'ISO 10816-1 class I: ' : ''}normal ≤ {sensor.warn} · trip {sensor.crit} {sensor.unit} · nominal {sensor.nominal[0]}–{sensor.nominal[1]}
      </p>
    </section>
  );
}

export default function MachinePage() {
  const { id } = useParams<{ id: string }>();
  const factory = useStore((s) => s.factory);
  const plant = useStore((s) => s.plant);
  const machine = factory.machines.find((m) => m.id === id);
  const lineId = plant.lineOf[id];
  const line = plant.lines.find((l) => l.id === lineId);
  const cluster = line?.clusters.find((c) => c.machineIds.includes(id));
  const status = useStore((s) => s.statuses[id] ?? 'verde');
  const history = useStore((s) => s.history[id]);
  const production = useStore((s) => (lineId ? s.productions[lineId] : undefined));
  const lineState = useStore((s) => (lineId ? s.lines[lineId] : undefined));
  const speed = useStore((s) => s.speed[id] ?? 1);
  const incidents = useStore((s) => s.incidents);
  const selectMachine = useStore((s) => s.selectMachine);
  const showHistory = useHistoryUi((s) => s.showHistory);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);

  // Factory memory lives in the browser (localStorage + samples).
  useEffect(() => {
    setMemory(localMemory.all().filter((e) => e.machineId === id).sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1)));
  }, [id, incidents]);

  const rel = useMemo(() => reliability(memory), [memory]);
  if (!machine || !line) {
    return (
      <div className="p-6 text-sm text-slate-400">
        Machine <span className="font-mono">{id}</span> is not part of this plant. <Link href="/" className="text-sky-400 hover:underline">Back to the plant</Link>
      </div>
    );
  }

  const lk = production ? kpis(production, line.config) : null;
  const sameType = line.config.machines.filter((m) => m.type === machine.type).length || 1;
  const processed = (production?.started ?? 0) / sameType;
  const rejectedHere = production?.rejects[id] ?? 0;
  const stopped = lineState ? !lineState.running : false;
  const list = Object.values(incidents)
    .filter((i) => i.machineId === id || i.causalPath[0] === id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const openCount = list.filter((i) => i.status !== 'chiuso' && i.status !== 'rifiutato').length;

  const openList = list.filter((i) => i.status !== 'chiuso' && i.status !== 'rifiutato');
  const closedList = list.filter((i) => i.status === 'chiuso' || i.status === 'rifiutato');

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1400px] space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Breadcrumb
            items={[
              { label: factory.name.split(' – ')[0]!, href: '/' },
              { label: line.name, href: `/lines/${line.id}` },
              ...(cluster ? [{ label: cluster.name, href: `/lines/${line.id}/${cluster.id}` }] : []),
              { label: `${machine.id} · ${machine.name}` },
            ]}
          />
          <div className="flex items-center gap-2">
            <span className={`pill ${STATUS_PILL[status]}`}>{STATUS_LABEL[status]}</span>
            <button type="button" className="btn-ghost text-xs" onClick={() => showHistory(machine.id)}>
              History (48 h)
            </button>
            <Link
              href={`/lines/${line.id}${cluster ? `/${cluster.id}` : ''}`}
              className="btn-ghost text-xs"
              onClick={() => selectMachine(machine.id)}
            >
              Show on line map
            </Link>
          </div>
        </div>

        <section aria-label="Station KPIs" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Kpi
            label="State"
            value={stopped ? (lineState?.trippedBy?.machineId === id ? '⛔ Tripped' : '⏸ Line stopped') : speed < 1 ? `▶ ${Math.round(speed * 100)}% speed` : '▶ Running'}
            sub={`${machine.type.replace(/_/g, ' ')} · nominal ${(machine.partsPerMin * 60).toLocaleString('en-GB')} /h`}
            tone={stopped ? 'text-red-400' : speed < 1 ? 'text-amber-300' : 'text-emerald-300'}
          />
          <Kpi label="Bottles processed" value={Math.floor(processed).toLocaleString('en-GB')} sub="this shift" />
          <Kpi
            label="Rejected here"
            value={Math.round(rejectedHere).toLocaleString('en-GB')}
            sub={processed > 0 ? `${((rejectedHere / processed) * 100).toFixed(2)}% of processed` : 'no reject sensor or no output yet'}
            tone={processed > 0 && rejectedHere / processed > 0.015 ? 'text-amber-300' : 'text-slate-100'}
          />
          <Kpi label="Availability (line)" value={lk ? pct(lk.availability) : '–'} sub={`OEE line ${lk ? pct(lk.oee) : '–'}`} />
          <Kpi label="MTBF" value={rel.mtbfDays === null ? '–' : `${rel.mtbfDays.toFixed(1)} d`} sub={`${rel.failures} intervention${rel.failures === 1 ? '' : 's'} in memory`} />
          <Kpi label="MTTR" value={rel.mttrMin === null ? '–' : `${Math.round(rel.mttrMin)} min`} sub={`downtime €${machine.downtimeCostPerMin}/min · ${openCount} open incident${openCount === 1 ? '' : 's'}`} />
        </section>

        <section aria-label="Incidents" className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_minmax(0,420px)]">
          <div className="space-y-2">
            <h2 className="section-title">
              Incidents {openList.length > 0 && <span className="text-amber-300">· {openList.length} open</span>}
            </h2>
            {openList.length === 0 && <p className="card p-3 text-xs text-slate-500">No open incidents on this machine.</p>}
            {openList.map((i) => (
              <IncidentCard key={i.id} inc={i} />
            ))}
            {closedList.length > 0 && (
              <details className="card p-3 text-xs">
                <summary className="cursor-pointer select-none text-slate-400">Closed this shift ({closedList.length})</summary>
                <ul className="mt-2 space-y-2">
                  {closedList.map((i) => (
                    <li key={i.id}>
                      <IncidentCard inc={i} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <div className="space-y-3">
            <MetricsPanel machineId={machine.id} />
            <QualityHolds machineId={machine.id} />
          </div>
        </section>

        {machine.sensors.some(isProductCharacteristic) && (
          <section aria-label="Product quality">
            <h2 className="section-title mb-2">Product quality · SPC &amp; capability (last 60 s)</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {machine.sensors.filter(isProductCharacteristic).map((s) => (
                <SpcCard key={s.id} sensor={s} values={(history?.[s.id] ?? []).map((x) => x.value)} stopped={stopped} />
              ))}
            </div>
          </section>
        )}

        <section aria-label="Machine condition">
          <h2 className="section-title mb-2">Machine condition · zones and trend (last 60 s)</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {machine.sensors
              .filter((s) => !isProductCharacteristic(s))
              .map((s) => (
                <ConditionCard key={s.id} sensor={s} values={(history?.[s.id] ?? []).map((x) => x.value)} stopped={stopped} />
              ))}
          </div>
        </section>

        <MachineHistory machine={machine} large />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section className="card space-y-2 p-3" aria-label="Configuration">
            <h2 className="section-title">Configuration</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th scope="col" className="text-left font-normal">
                    Sensor
                  </th>
                  <th scope="col" className="text-right font-normal">
                    Nominal
                  </th>
                  <th scope="col" className="text-right font-normal">
                    Warning
                  </th>
                  <th scope="col" className="text-right font-normal">
                    Trip
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {machine.sensors.map((s) => (
                  <tr key={s.id}>
                    <th scope="row" className="py-0.5 text-left font-sans font-normal text-slate-300">
                      {s.name}
                    </th>
                    <td className="text-right">
                      {s.nominal[0]}–{s.nominal[1]} {s.unit}
                    </td>
                    <td className="text-right text-amber-300">{s.warn}</td>
                    <td className="text-right text-red-400">{s.crit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-500">
              Nominal rate {(machine.partsPerMin * 60).toLocaleString('en-GB')} /h · downtime €{machine.downtimeCostPerMin}/min · manual {machine.manualRef}
            </p>
            <AutonomyEditor machineType={machine.type} />
          </section>
          <section className="card p-3">
            <h2 className="section-title mb-2">Maintenance history (factory memory)</h2>
            {memory.length === 0 ? (
              <p className="text-xs text-slate-500">No closed interventions recorded for this machine.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {memory.map((e) => (
                  <li key={e.id} className="rounded bg-slate-950/40 px-2 py-1.5">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-slate-200">{e.realCause}</span>
                      <span className="shrink-0 font-mono text-slate-500">
                        {new Date(e.closedAt).toLocaleDateString('en-GB')} · {e.durationMin} min
                      </span>
                    </div>
                    <div className="text-slate-400">{e.fix}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
