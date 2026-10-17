/**
 * Analizzatore_Causa_Radice (Req 12). Pure graph analysis on the factory configuration.
 */
import type { FactoryConfig, MachineStatus } from '@/shared/types';

export interface RootCauseResult {
  rootCause: string;
  path: string[]; // [rootCause, ..., alarmMachine]
  complete: boolean;
}

/** Shortest downstream path from `from` to `to`, ties broken lexicographically (Req 12.6). */
export function shortestDownstreamPath(config: FactoryConfig, from: string, to: string): string[] | null {
  const byId = new Map(config.machines.map((m) => [m.id, m]));
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const next of [...(byId.get(cur)?.downstream ?? [])].sort()) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      queue.push(next);
    }
  }
  if (!prev.has(to)) return null;
  const path: string[] = [];
  for (let n: string | null = to; n !== null; n = prev.get(n) ?? null) path.unshift(n);
  return path;
}

export function rootCause(
  config: FactoryConfig,
  statuses: Record<string, MachineStatus>,
  anomalyStart: Record<string, number>,
  alarmMachine: string,
  deadlineMs = 1000,
): RootCauseResult {
  const fallback: RootCauseResult = { rootCause: alarmMachine, path: [alarmMachine], complete: true };
  const t0 = Date.now();
  try {
    const byId = new Map(config.machines.map((m) => [m.id, m]));
    if (!byId.has(alarmMachine)) return { ...fallback, complete: false };
    const ownStart = anomalyStart[alarmMachine] ?? Number.POSITIVE_INFINITY;

    // BFS upstream, recording distance (Req 12.1).
    const dist = new Map<string, number>([[alarmMachine, 0]]);
    const queue = [alarmMachine];
    while (queue.length) {
      if (Date.now() - t0 > deadlineMs) return { ...fallback, complete: false };
      const cur = queue.shift()!;
      for (const up of byId.get(cur)?.upstream ?? []) {
        if (dist.has(up)) continue;
        dist.set(up, dist.get(cur)! + 1);
        queue.push(up);
      }
    }

    const candidates = [...dist.keys()].filter((id) => {
      if (id === alarmMachine) return false;
      const st = statuses[id];
      const start = anomalyStart[id];
      return (st === 'giallo' || st === 'rosso') && start !== undefined && start < ownStart;
    });
    if (!candidates.length) return fallback; // Req 12.4

    candidates.sort((a, b) => {
      const d = anomalyStart[a]! - anomalyStart[b]!;
      if (d !== 0) return d; // earliest anomaly first (Req 12.2)
      const dd = dist.get(b)! - dist.get(a)!;
      if (dd !== 0) return dd; // farther first (Req 12.5)
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const root = candidates[0]!;
    const path = shortestDownstreamPath(config, root, alarmMachine);
    if (!path) return { ...fallback, complete: false };
    return { rootCause: root, path, complete: true };
  } catch {
    return { ...fallback, complete: false }; // Req 12.10
  }
}
