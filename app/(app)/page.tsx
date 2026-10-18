'use client';
/**
 * Plant view (production & quality engineer): plant KPIs, one card per line (drill down to the line),
 * OEE trend over the shift, downtime and reject Paretos, incidents waiting for a decision.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '@/modules/store';
import { kpis } from '@/modules/monitoring/production/production';
import { STATUS_DOT } from '@/modules/incidents/labels';
import { bottleneck, clusterMetrics, downtimePareto, plantKpis, rejectPareto, type ParetoItem } from '@/modules/plant/metrics';
import { Breadcrumb } from '@/modules/shell/Breadcrumb';
import { QualityHolds } from '@/modules/quality/QualityHolds';
import { AskPanel } from '@/modules/copilot/AskPanel';
import { RecoveryPanel } from '@/modules/agent/RecoveryPanel';

const int = (n: number) => Math.round(n).toLocaleString('en-GB');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const hms = (sec: number) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const LINE_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#f472b6'];
const oeeTone = (x: number) => (x >= 0.85 ? 'text-emerald-300' : x >= 0.65 ? 'text-amber-300' : 'text-red-400');

function Kpi({ label, value, sub, tone = 'text-slate-100', title }: { label: string; value: string; sub?: string; tone?: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-900/60 px-3 py-2 ring-1 ring-inset ring-white/10" title={title}>
      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`truncate font-mono text-xl font-semibold ${tone}`}>{value}</div>
      {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-3 text-slate-500">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </span>
      <span className="w-12 text-right font-mono text-slate-300">{pct(value)}</span>
    </div>
  );
}

function Pareto({ title, items, unit, format, empty }: { title: string; items: ParetoItem[]; unit: string; format: (v: number) => string; empty: string }) {
  const max = items[0]?.value ?? 1;
  return (
    <section className="card p-3">
      <h2 className="section-title mb-2">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">{empty}</p>
      ) : (
        <ol className="space-y-1.5">
          {items.slice(0, 6).map((i) => (
            <li key={i.key} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate text-slate-300">{i.label}</span>
                <span className="shrink-0 font-mono text-slate-400">
                  {format(i.value)} {unit} · <span className="text-slate-500">{i.cumulativePct.toFixed(0)}% cum.</span>
                </span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-sky-400/80" style={{ width: `${(i.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function PlantPage() {
  const router = useRouter();
  const factory = useStore((s) => s.factory);
  const plant = useStore((s) => s.plant);
  const productions = useStore((s) => s.productions);
  const lines = useStore((s) => s.lines);
  const statuses = useStore((s) => s.statuses);
  const speed = useStore((s) => s.speed);
  const stops = useStore((s) => s.stops);
  const trend = useStore((s) => s.trend);
  const tick = useStore((s) => s.tick);
  const incidents = useStore((s) => s.incidents);
  const selectIncident = useStore((s) => s.selectIncident);
  const bypassed = useStore((s) => s.bypassed);
  const holds = useStore((s) => s.holds);
  const onHold = holds.filter((h) => h.status === 'collecting' || h.status === 'quarantined').reduce((a, h) => a + h.suspect, 0);

  const k = useMemo(() => plantKpis(plant, productions), [plant, productions]);
  const downtimeSec = plant.lines.reduce((s, l) => s + ((productions[l.id]?.plannedSec ?? 0) - (productions[l.id]?.runSec ?? 0)), 0);
  const lostEur = plant.lines.reduce((s, l) => {
    const p = productions[l.id];
    const cost = l.config.machines.reduce((c, m) => c + m.downtimeCostPerMin, 0);
    return s + (p ? ((p.plannedSec - p.runSec) / 60) * cost : 0);
  }, 0);
  const runningLines = plant.lines.filter((l) => lines[l.id]?.running).length;
  const shiftSec = Math.max(0, ...plant.lines.map((l) => productions[l.id]?.plannedSec ?? 0));
  const downPareto = useMemo(() => downtimePareto(stops, tick, factory), [stops, tick, factory]);
  const rejPareto = useMemo(() => rejectPareto(plant, productions, factory), [plant, productions, factory]);
  const pending = Object.values(incidents)
    .filter((i) => i.status === 'in_coda' && i.escalation?.escalate)
    .sort((a, b) => b.priority - a.priority);
  const chart = trend.map((t) => ({ min: +(t.tick / 60).toFixed(1), ...Object.fromEntries(Object.entries(t.lines).map(([id, v]) => [id, +(v.oee * 100).toFixed(1)])) }));

  const openIncident = (id: string, machineId: string) => {
    selectIncident(id);
    router.push(`/lines/${plant.lineOf[machineId] ?? plant.lines[0]!.id}`);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1400px] space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Breadcrumb items={[{ label: `${factory.name.split(' – ')[0]} · overview` }]} />
          <span className="text-xs text-slate-500">{`Shift ${hms(shiftSec)}`}</span>
        </div>

        {/* Plant KPIs */}
        <section aria-label="Plant KPIs" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Kpi
            label="Lines running"
            value={`${runningLines} / ${plant.lines.length}`}
            sub={runningLines < plant.lines.length ? 'protective stop in progress' : 'all lines producing'}
            tone={runningLines < plant.lines.length ? 'text-red-400' : 'text-emerald-300'}
          />
          <Kpi label="Good bottles" value={int(k.good)} sub={`${int(k.started)} started`} />
          <Kpi
            label="Throughput"
            value={`${int(k.throughputPerHour)} /h`}
            sub={`target ${int(k.targetPerHour)} /h · ${k.targetPerHour ? Math.round((k.throughputPerHour / k.targetPerHour) * 100) : 0}%`}
            tone={k.throughputPerHour >= 0.95 * k.targetPerHour ? 'text-emerald-300' : k.throughputPerHour >= 0.8 * k.targetPerHour ? 'text-amber-300' : 'text-red-400'}
            title="Good bottles per hour over the last minute, all lines"
          />
          <Kpi
            label="First pass yield"
            value={pct(k.quality)}
            sub={`${int(k.rejected)} rejects · ${k.rejectPct.toFixed(2)}%${onHold ? ` · ${int(onHold)} on hold` : ''}`}
            tone={k.quality >= 0.99 ? 'text-emerald-300' : k.quality >= 0.98 ? 'text-amber-300' : 'text-red-400'}
            title="Good bottles / bottles started"
          />
          <Kpi label="Downtime" value={hms(downtimeSec)} sub={`≈ €${int(lostEur)} lost`} tone={downtimeSec ? 'text-red-400' : 'text-slate-100'} />
          <Kpi
            label="Plant OEE"
            value={pct(k.oee)}
            sub={`A ${pct(k.availability)} · P ${pct(k.performance)} · Q ${pct(k.quality)}`}
            tone={oeeTone(k.oee)}
            title="Good output / ideal output over planned time (weighted by line capacity)"
          />
        </section>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <AskPanel />
          <RecoveryPanel />
        </div>

        {/* Lines */}
        <section aria-label="Production lines" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {plant.lines.map((l, i) => {
            const p = productions[l.id];
            const lk = p ? kpis(p, l.config) : null;
            const ls = lines[l.id];
            const cms = clusterMetrics(l, p, statuses, speed, ls?.running ?? true, new Set(Object.keys(bypassed)));
            const neck = bottleneck(cms);
            const lineSpeed = Math.min(1, ...l.machineIds.map((id) => speed[id] ?? 1));
            const open = Object.values(incidents).filter((x) => l.machineIds.includes(x.machineId) && x.status !== 'chiuso' && x.status !== 'rifiutato').length;
            return (
              <Link key={l.id} href={`/lines/${l.id}`} className="card block p-3 transition hover:ring-1 hover:ring-inset hover:ring-white/25">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="truncate text-sm font-semibold">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} />
                    {l.name}
                  </h2>
                  <span className={`pill ${!ls?.running ? 'bg-red-500/15 text-red-300 ring-red-400/40' : lineSpeed < 1 ? 'bg-amber-500/15 text-amber-300 ring-amber-400/40' : 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40'}`}>
                    {!ls?.running ? `⛔ Stopped · ${ls?.trippedBy?.machineId ?? ''}` : lineSpeed < 1 ? `${Math.round(lineSpeed * 100)}% speed` : 'Running'}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-4">
                  <div className="text-center">
                    <div className={`font-mono text-3xl font-semibold ${oeeTone(lk?.oee ?? 1)}`}>{pct(lk?.oee ?? 1)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">OEE</div>
                  </div>
                  <div className="space-y-1">
                    <Bar label="A" value={lk?.availability ?? 1} tone="bg-sky-400" />
                    <Bar label="P" value={lk?.performance ?? 1} tone="bg-violet-400" />
                    <Bar label="Q" value={lk?.quality ?? 1} tone="bg-emerald-400" />
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-slate-500">Throughput</dt>
                    <dd className="font-mono">
                      {int(lk?.throughputPerHour ?? 0)}
                      <span className="text-slate-500"> / {int(lk?.targetPerHour ?? 0)} /h</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Good</dt>
                    <dd className="font-mono">{int(lk?.good ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Rejects</dt>
                    <dd className="font-mono">{(lk?.rejectPct ?? 0).toFixed(2)}%</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Open incidents</dt>
                    <dd className={`font-mono ${open ? 'text-amber-300' : ''}`}>{open}</dd>
                  </div>
                </dl>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/5 pt-2 text-[11px] text-slate-400">
                  {cms.map((cm) => (
                    <span key={cm.cluster.id} className="flex items-center gap-1.5">
                      <span className={neck?.cluster.id === cm.cluster.id ? 'font-semibold text-amber-300' : ''}>{cm.cluster.name}</span>
                      {cm.cluster.machineIds.map((id) => (
                        <span key={id} title={id} className={`h-2 w-2 rounded-full ${STATUS_DOT[statuses[id] ?? 'verde']}`} />
                      ))}
                    </span>
                  ))}
                  {neck && <span className="ml-auto text-amber-300">Bottleneck: {neck.cluster.name}</span>}
                </div>
              </Link>
            );
          })}
        </section>

        {/* Trend, Paretos, decisions */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <section className="card p-3 xl:col-span-2">
            <h2 className="section-title mb-2">OEE over the shift</h2>
            {chart.length < 2 ? (
              <p className="py-10 text-center text-xs text-slate-500">Collecting data (one point every 30 s)…</p>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="min" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v: number) => `${v}′`} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }} labelFormatter={(v) => `minute ${v}`} formatter={(v) => `${v}%`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {plant.lines.map((l, i) => (
                      <Line key={l.id} type="monotone" dataKey={l.id} name={l.id} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={false} strokeWidth={2} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
          <Pareto title="Downtime by cause" items={downPareto} unit="s" format={(v) => int(v)} empty="No protective stops this shift." />
          <Pareto title="Rejects by station" items={rejPareto} unit="bottles" format={(v) => int(v)} empty="No rejects yet." />
        </div>

        <QualityHolds />

        <section className="card p-3">
          <h2 className="section-title mb-2">Needs your decision {pending.length > 0 && <span className="text-amber-300">({pending.length})</span>}</h2>
          {pending.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing waiting for approval.</p>
          ) : (
            <ul className="divide-y divide-white/5 text-sm">
              {pending.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => openIncident(i.id, i.machineId)} className="flex w-full items-center gap-3 px-1 py-1.5 text-left hover:bg-white/5">
                    <span className="font-mono text-xs text-slate-500">{i.id}</span>
                    <span className="font-mono text-xs text-slate-400">{plant.lineOf[i.machineId]}</span>
                    <span className="truncate">{i.diagnosis && i.diagnosis !== 'non_disponibile' ? i.diagnosis.causa_probabile : factory.machines.find((m) => m.id === i.machineId)?.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-sky-400">Open in line →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
