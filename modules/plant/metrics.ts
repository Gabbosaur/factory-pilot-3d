/**
 * Plant / line / cluster metrics for the production and quality views. Pure.
 */
import type { FactoryConfig, MachineStatus } from '@/shared/types';
import { kpis, nominalPerMin, type ProductionKpi, type ProductionState } from '@/modules/monitoring/production/production';
import type { PlantCluster, PlantLine, PlantModel } from './plant';

/** Plant OEE weighted by output: Σgood / Σ(ideal output over planned time); A, P, Q aggregated the same way. */
export function plantKpis(plant: PlantModel, productions: Record<string, ProductionState>): ProductionKpi {
  let good = 0, started = 0, rejected = 0, run = 0, planned = 0, idealRun = 0, idealPlanned = 0, recent = 0, target = 0;
  for (const l of plant.lines) {
    const p = productions[l.id];
    if (!p) continue;
    const k = kpis(p, l.config);
    const ratePerSec = k.targetPerHour / 3600;
    good += p.good;
    started += p.started;
    rejected += k.rejected;
    run += p.runSec;
    planned += p.plannedSec;
    idealRun += ratePerSec * p.runSec;
    idealPlanned += ratePerSec * p.plannedSec;
    recent += k.throughputPerHour;
    target += k.targetPerHour;
  }
  const availability = planned ? run / planned : 1;
  const performance = idealRun ? Math.min(1, started / idealRun) : 1;
  const quality = started ? good / started : 1;
  return {
    good,
    started,
    rejected,
    rejectPct: started ? (rejected / started) * 100 : 0,
    throughputPerHour: recent,
    targetPerHour: target,
    availability,
    performance,
    quality,
    oee: idealPlanned ? good / idealPlanned : availability * performance * quality,
  };
}

const STATUS_RANK: Record<MachineStatus, number> = { verde: 0, giallo: 1, rosso: 2 };

export interface ClusterMetrics {
  cluster: PlantCluster;
  /** Effective capacity of the cluster in bottles/h: parallel machines add up, series steps take the slowest; stopped = 0. */
  capacityPerHour: number;
  nominalPerHour: number;
  rejects: number;
  rejectPct: number;
  worst: MachineStatus;
}

export function clusterMetrics(
  line: PlantLine,
  production: ProductionState | undefined,
  statuses: Record<string, MachineStatus>,
  speed: Record<string, number>,
  lineRunning: boolean,
  /** Machines bypassed to a redundant twin: out of the flow, no capacity. */
  bypassed: ReadonlySet<string> = new Set(),
): ClusterMetrics[] {
  const started = production?.started ?? 0;
  return line.clusters.map((c) => {
    const ms = line.config.machines.filter((m) => c.machineIds.includes(m.id));
    // Machines of the same type work in parallel (they add up); different types are in series (the slowest step wins).
    const stepRate = (rate: (m: (typeof ms)[number]) => number) => {
      const byType = new Map<string, number>();
      for (const m of ms) byType.set(m.type, (byType.get(m.type) ?? 0) + rate(m));
      return byType.size ? Math.min(...byType.values()) : 0;
    };
    const nominal = stepRate((m) => m.partsPerMin * 60);
    const capacity = lineRunning ? stepRate((m) => (bypassed.has(m.id) ? 0 : m.partsPerMin * 60 * (speed[m.id] ?? 1))) : 0;
    const rejects = c.machineIds.reduce((s, id) => s + (production?.rejects[id] ?? 0), 0);
    const worst = c.machineIds.reduce<MachineStatus>((w, id) => (STATUS_RANK[statuses[id] ?? 'verde'] > STATUS_RANK[w] ? statuses[id]! : w), 'verde');
    return { cluster: c, capacityPerHour: capacity, nominalPerHour: nominal, rejects, rejectPct: started ? (rejects / started) * 100 : 0, worst };
  });
}

/** The cluster limiting the line: lowest effective capacity, only when it is below the others. */
export function bottleneck(metrics: ClusterMetrics[]): ClusterMetrics | null {
  if (metrics.length < 2) return null;
  const sorted = [...metrics].sort((a, b) => a.capacityPerHour - b.capacityPerHour);
  return sorted[0]!.capacityPerHour < sorted[1]!.capacityPerHour - 1e-6 ? sorted[0]! : null;
}

export interface ParetoItem {
  key: string;
  label: string;
  value: number;
  cumulativePct: number;
}

function pareto(items: Array<{ key: string; label: string; value: number }>): ParetoItem[] {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, i) => s + i.value, 0) || 1;
  let acc = 0;
  return sorted.map((i) => ((acc += i.value), { ...i, cumulativePct: (acc / total) * 100 }));
}

/** Downtime seconds grouped by cause (machine + sensor that tripped the line), ongoing stops included. */
export function downtimePareto(
  stops: Array<{ machineId: string; sensorId: string; startTick: number; endTick: number | null }>,
  nowTick: number,
  config: FactoryConfig,
): ParetoItem[] {
  const by = new Map<string, { key: string; label: string; value: number }>();
  for (const s of stops) {
    const m = config.machines.find((x) => x.id === s.machineId);
    const sensor = m?.sensors.find((x) => x.id === s.sensorId);
    const key = `${s.machineId}|${s.sensorId}`;
    const cur = by.get(key) ?? { key, label: `${s.machineId} · ${sensor?.name ?? s.sensorId}`, value: 0 };
    cur.value += Math.max(0, (s.endTick ?? nowTick) - s.startTick);
    by.set(key, cur);
  }
  return pareto([...by.values()]);
}

/** Rejected bottles per station across all lines. */
export function rejectPareto(plant: PlantModel, productions: Record<string, ProductionState>, config: FactoryConfig): ParetoItem[] {
  const items: Array<{ key: string; label: string; value: number }> = [];
  for (const l of plant.lines) {
    for (const [id, v] of Object.entries(productions[l.id]?.rejects ?? {})) {
      const m = config.machines.find((x) => x.id === id);
      const label = id === 'quality-hold' ? `${l.id} · scrapped quality-hold lots` : `${id} · ${m?.name.replace(/ \(L\d+\)$/, '') ?? id}`;
      items.push({ key: `${l.id}|${id}`, label, value: v });
    }
  }
  return pareto(items);
}

export const lineTarget = (line: PlantLine) => nominalPerMin(line.config) * 60;
