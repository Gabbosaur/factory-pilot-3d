'use client';
/** Shift production KPIs for the production engineer: output, throughput vs target, rejects per station, downtime, OEE. */
import { useMemo } from 'react';
import { useStore } from '@/modules/store';
import { kpis, rejectSensors } from '@/modules/monitoring/production/production';
import { capacityFactor } from '@/modules/plant/plant';

const int = (n: number) => Math.floor(n).toLocaleString('en-GB');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mmss = (sec: number) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

function Cell({ label, value, sub, tone = 'text-slate-100', title }: { label: string; value: string; sub?: string; tone?: string; title?: string }) {
  return (
    <div className="min-w-0 px-3 py-1.5" title={title}>
      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`truncate font-mono text-base font-semibold ${tone}`}>{value}</div>
      {sub && <div className="truncate text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

/** KPIs of one production line of the plant. */
export function ProductionBar({ lineId }: { lineId?: string } = {}) {
  const plantLine = useStore((s) => (lineId ? s.plant.lines.find((l) => l.id === lineId) : undefined) ?? s.plant.lines[0]!);
  const production = useStore((s) => (plantLine ? s.productions[plantLine.id] : undefined) ?? s.productions[s.plant.lines[0]?.id ?? '']!);
  const factory = plantLine?.config ?? useStore.getState().factory;
  const line = useStore((s) => s.lines[plantLine.id]!);
  const speed = useStore((s) => Math.min(1, ...plantLine.machineIds.map((id) => s.speed[id] ?? 1)));
  // A machine bypassed to its twin lowers the line capacity without stopping it.
  const capacity = useStore((s) => capacityFactor(plantLine.config, new Set(plantLine.machineIds.filter((id) => s.bypassed[id]))));
  const k = useMemo(() => kpis(production, factory), [production, factory]);
  const stations = useMemo(() => rejectSensors(factory), [factory]);
  const costPerMin = factory.machines.reduce((s, m) => s + m.downtimeCostPerMin, 0);
  const downtimeSec = production.plannedSec - production.runSec;

  const ratio = k.targetPerHour ? k.throughputPerHour / k.targetPerHour : 0;
  const rateTone = !line.running ? 'text-red-400' : ratio >= 0.95 ? 'text-emerald-300' : ratio >= 0.8 ? 'text-amber-300' : 'text-red-400';
  const oeeTone = k.oee >= 0.85 ? 'text-emerald-300' : k.oee >= 0.65 ? 'text-amber-300' : 'text-red-400';
  const rejectTone = k.rejectPct < 1 ? 'text-slate-100' : k.rejectPct < 2 ? 'text-amber-300' : 'text-red-400';

  return (
    <section aria-label="Shift production" className="grid grid-cols-2 divide-white/5 border-b border-white/10 bg-slate-950/80 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
      <Cell
        label="Line"
        value={!line.running ? '⛔ Stopped' : capacity < 1 ? `↪ Rerouted · ${Math.round(capacity * 100)}%` : speed < 1 ? `▶ ${Math.round(speed * 100)}% speed` : '▶ Running'}
        sub={`shift ${mmss(production.plannedSec)}`}
        tone={!line.running ? 'text-red-400' : speed < 1 || capacity < 1 ? 'text-amber-300' : 'text-emerald-300'}
      />
      <Cell label="Good bottles" value={int(k.good)} sub={`${int(k.started)} started`} />
      <Cell
        label="Throughput"
        value={`${int(k.throughputPerHour)} /h`}
        sub={`target ${int(k.targetPerHour)} /h · ${Math.round(ratio * 100)}%`}
        tone={rateTone}
        title="Good bottles per hour over the last minute"
      />
      <Cell
        label="Rejects"
        value={`${Math.round(k.rejected).toLocaleString('en-GB')} · ${k.rejectPct.toFixed(2)}%`}
        sub={stations.map(({ machine }) => `${machine.id} ${Math.round(production.rejects[machine.id] ?? 0)}`).join(' · ') || 'no reject sensors'}
        tone={rejectTone}
      />
      <Cell
        label="Downtime"
        value={mmss(downtimeSec)}
        sub={`≈ €${Math.round((downtimeSec / 60) * costPerMin).toLocaleString('en-GB')} lost`}
        tone={downtimeSec ? 'text-red-400' : 'text-slate-100'}
      />
      <Cell
        label="OEE"
        value={pct(k.oee)}
        sub={`A ${pct(k.availability)} · P ${pct(k.performance)} · Q ${pct(k.quality)}`}
        tone={oeeTone}
        title="Overall Equipment Effectiveness = Availability × Performance × Quality"
      />
    </section>
  );
}
