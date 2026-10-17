/**
 * Calcolatore_Impatto (Req 13). Pure.
 */
import type { FactoryConfig, Impact, RiskLevel } from '@/shared/types';

export const RISK_WEIGHT: Record<RiskLevel, number> = { basso: 1, medio: 2, alto: 4 };

/** Machines affected: causal path ∪ alarm machine ∪ all downstream of the alarm machine. */
export function affectedSet(config: FactoryConfig, causalPath: readonly string[], alarmMachine: string): string[] {
  const byId = new Map(config.machines.map((m) => [m.id, m]));
  const set = new Set<string>([...causalPath, alarmMachine]);
  const queue = [alarmMachine];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of byId.get(cur)?.downstream ?? []) {
      if (!set.has(d)) {
        set.add(d);
        queue.push(d);
      }
    }
  }
  return [...set].filter((id) => byId.has(id));
}

export function computeImpact(config: FactoryConfig, causalPath: readonly string[], alarmMachine: string): Impact {
  const byId = new Map(config.machines.map((m) => [m.id, m]));
  const ids = affectedSet(config, causalPath, alarmMachine);
  let costPerMin = 0;
  let partsAtRiskPerMin = 0;
  for (const id of ids) {
    const m = byId.get(id)!;
    costPerMin += m.downtimeCostPerMin;
    // Serial line: the same part flows through every machine, so take the max, not the sum.
    partsAtRiskPerMin = Math.max(partsAtRiskPerMin, m.partsPerMin);
  }
  const horizonMin = config.impactHorizonMin;
  return { costPerMin, partsAtRiskPerMin, savingsEur: costPerMin * horizonMin, horizonMin };
}

/** Monotonic in cost (same risk) and in risk (same cost). Unknown risk ⇒ 'alto' (Req 13.7). */
export function priorityScore(costPerMin: number, risk: RiskLevel | null): number {
  return Math.max(0, costPerMin) * RISK_WEIGHT[risk ?? 'alto'];
}

export function formatEur(n: number): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(n);
}
