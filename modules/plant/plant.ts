/**
 * Plant hierarchy (ISA-95 style): plant → production lines → process clusters → machines.
 * A multi-line plant is a single FactoryConfig (so simulator, anomaly engine, root cause and incidents
 * work unchanged): lines are disconnected sub-graphs, machines of line n > 1 get an "Ln-" id prefix.
 * Pure, no React.
 */
import type { FactoryConfig, MachineConfig } from '@/shared/types';

export interface PlantCluster {
  id: string;
  name: string;
  machineIds: string[];
}

export interface PlantLine {
  id: string;
  name: string;
  machineIds: string[];
  clusters: PlantCluster[];
  /** The line alone as a FactoryConfig (machines + faults), for per-line computations. */
  config: FactoryConfig;
}

export interface PlantModel {
  lines: PlantLine[];
  lineOf: Record<string, string>;
  clusterOf: Record<string, string>;
}

/** Process clusters by machine type, in flow order. */
const CLUSTERS: Array<{ id: string; name: string; match: RegExp }> = [
  { id: 'feed', name: 'Feed & pumping', match: /pump|tank|filter/i },
  { id: 'filling', name: 'Filling & capping', match: /fill|cap|rins/i },
  { id: 'eol', name: 'End of line', match: /convey|label|pack|pallet/i },
];

export function clusterFor(type: string): { id: string; name: string } {
  return CLUSTERS.find((c) => c.match.test(type)) ?? { id: 'process', name: 'Process' };
}

const clusterName = (id: string) => CLUSTERS.find((c) => c.id === id)?.name ?? id.replace(/(^|[-_])(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase());

/**
 * Redundant machines that can take over the flow of `machineId`: same type, same upstream and same
 * downstream machines (e.g. the two parallel fillers of a twin-filler line).
 */
export function siblingsOf(config: FactoryConfig, machineId: string): string[] {
  const m = config.machines.find((x) => x.id === machineId);
  if (!m) return [];
  const key = (ids: string[]) => [...ids].sort().join(',');
  return config.machines
    .filter((x) => x.id !== m.id && x.type === m.type && key(x.upstream) === key(m.upstream) && key(x.downstream) === key(m.downstream))
    .map((x) => x.id);
}

/**
 * Share of the line capacity still available when some machines are bypassed. Each process step offers the
 * sum of its machines of that type; the line is designed for its weakest step. A standby twin (a step with
 * spare machines) keeps the line at 100% when one machine is bypassed; parallel half-rate twins drop it.
 */
export function capacityFactor(config: FactoryConfig, bypassed: ReadonlySet<string>): number {
  const byType = new Map<string, { total: number; available: number }>();
  for (const m of config.machines) {
    const t = byType.get(m.type) ?? { total: 0, available: 0 };
    t.total += m.partsPerMin;
    if (!bypassed.has(m.id)) t.available += m.partsPerMin;
    byType.set(m.type, t);
  }
  const steps = [...byType.values()];
  const design = Math.min(...steps.map((t) => t.total));
  const left = Math.min(...steps.map((t) => t.available));
  return design > 0 ? Math.min(1, left / design) : 1;
}

/** Strip the line prefix of a machine/fault id (e.g. "L2-P1" → "P1"): shared manuals, datasets, replays. */
export const baseId = (id: string) => id.replace(/^L\d+-/i, '');

/** Merge several single-line configs into one plant config (line 1 keeps its ids). */
export function buildPlant(id: string, name: string, lines: FactoryConfig[], zGap = 14): FactoryConfig {
  const first = lines[0]!;
  const machines: MachineConfig[] = [];
  const faults: FactoryConfig['faults'] = [];
  const autonomy: FactoryConfig['autonomy'] = {};
  lines.forEach((cfg, i) => {
    const lineId = `L${i + 1}`;
    const pre = (mid: string) => (i === 0 ? mid : `${lineId}-${mid}`);
    for (const m of cfg.machines) {
      machines.push({
        ...m,
        id: pre(m.id),
        name: i === 0 ? m.name : `${m.name} (${lineId})`,
        position: [m.position[0], m.position[1], m.position[2] + i * zGap],
        upstream: m.upstream.map(pre),
        downstream: m.downstream.map(pre),
        line: lineId,
        cluster: m.cluster ?? clusterFor(m.type).id,
      });
    }
    for (const f of cfg.faults) faults.push({ ...f, id: i === 0 ? f.id : `${lineId.toLowerCase()}-${f.id}`, label: `${lineId} · ${f.label}`, machineId: pre(f.machineId) });
    for (const [type, actions] of Object.entries(cfg.autonomy)) autonomy[type] = { ...(autonomy[type] ?? {}), ...actions };
  });
  return {
    ...first,
    id,
    name,
    autonomy,
    machines,
    faults,
    lines: lines.map((cfg, i) => ({ id: `L${i + 1}`, name: `Line ${i + 1} · ${cfg.name}` })),
  };
}

export function plantModel(config: FactoryConfig): PlantModel {
  const lineIds: string[] = [];
  const byLine = new Map<string, MachineConfig[]>();
  for (const m of config.machines) {
    const l = m.line ?? config.id;
    if (!byLine.has(l)) {
      byLine.set(l, []);
      lineIds.push(l);
    }
    byLine.get(l)!.push(m);
  }
  const lineOf: Record<string, string> = {};
  const clusterOf: Record<string, string> = {};
  const lines = lineIds.map((lid) => {
    const ms = byLine.get(lid)!;
    const ids = new Set(ms.map((m) => m.id));
    const clusters: PlantCluster[] = [];
    for (const m of ms) {
      const cid = m.cluster ?? clusterFor(m.type).id;
      lineOf[m.id] = lid;
      clusterOf[m.id] = cid;
      let c = clusters.find((x) => x.id === cid);
      if (!c) clusters.push((c = { id: cid, name: clusterName(cid), machineIds: [] }));
      c.machineIds.push(m.id);
    }
    const order = (cid: string) => {
      const i = CLUSTERS.findIndex((c) => c.id === cid);
      return i < 0 ? CLUSTERS.length : i;
    };
    clusters.sort((a, b) => order(a.id) - order(b.id));
    return {
      id: lid,
      name: config.lines?.find((l) => l.id === lid)?.name ?? config.name,
      machineIds: ms.map((m) => m.id),
      clusters,
      config: { ...config, machines: ms, faults: config.faults.filter((f) => ids.has(f.machineId)) },
    };
  });
  return { lines, lineOf, clusterOf };
}
