/**
 * Deterministic tools of the Recovery planner agent: the model chooses and argues, these functions
 * compute the numbers (output gap to the shift target, effect of each recovery option in bottles and €).
 * Pure; assumptions are explicit constants shown in the UI.
 */
import type { MachineStatus, MemoryEntry } from '@/shared/types';
import type { ProductionState } from '@/modules/monitoring/production/production';
import { capacityFactor, type PlantModel } from '@/modules/plant/plant';

export const SHIFT_MIN = 480;
/** A healthy line can run at most 10 % above nominal for a few hours (mechanical margin). */
export const MAX_BOOST = 0.1;
/** Overtime cost of a line crew, € per minute. */
export const OVERTIME_EUR_PER_MIN = 6;
/** Typical repair times (minutes) by machine type when the factory memory has no history. */
const DEFAULT_MTTR: Array<[RegExp, number]> = [
  [/pump/, 75],
  [/fill/, 40],
  [/cap/, 30],
  [/convey/, 20],
];

export interface RecoveryInput {
  plant: PlantModel;
  productions: Record<string, ProductionState>;
  lines: Record<string, { running: boolean; trippedBy: { machineId: string } | null }>;
  bypassed: Record<string, { lineId: string; sibling: string }>;
  speed: Record<string, number>;
  statuses: Record<string, MachineStatus>;
  openIncidentMachines: string[];
  memory: MemoryEntry[];
}

interface LineFacts {
  id: string;
  name: string;
  nominalPerMin: number;
  /** Current output rate as a share of nominal (0 when stopped). */
  rateShare: number;
  eurPerBottle: number;
  good: number;
  elapsedMin: number;
  faulty: Array<{ machineId: string; type: string; reason: string; mttrMin: number }>;
}

function lineFacts(s: RecoveryInput, lineId: string): LineFacts | null {
  const l = s.plant.lines.find((x) => x.id === lineId);
  if (!l) return null;
  const sinks = l.config.machines.filter((m) => m.downstream.length === 0);
  const nominalPerMin = (sinks.length ? sinks : l.config.machines).reduce((a, m) => a + m.partsPerMin, 0);
  const ls = s.lines[l.id];
  const bypassed = new Set(l.machineIds.filter((id) => s.bypassed[id]));
  const speed = Math.min(1, ...l.machineIds.map((id) => s.speed[id] ?? 1));
  const rateShare = ls && !ls.running ? 0 : Math.min(capacityFactor(l.config, bypassed), speed);
  const costPerMin = l.config.machines.reduce((a, m) => a + m.downtimeCostPerMin, 0);
  const p = s.productions[l.id];
  const faulty = l.config.machines
    .filter((m) => ls?.trippedBy?.machineId === m.id || bypassed.has(m.id) || s.openIncidentMachines.includes(m.id) || s.statuses[m.id] === 'rosso')
    .map((m) => ({
      machineId: m.id,
      type: m.type,
      reason: ls?.trippedBy?.machineId === m.id ? 'tripped the line' : bypassed.has(m.id) ? `bypassed to ${s.bypassed[m.id]!.sibling}` : 'open incident / alarm',
      mttrMin: mttr(m.id, m.type, s.memory),
    }));
  return { id: l.id, name: l.name, nominalPerMin, rateShare, eurPerBottle: costPerMin / nominalPerMin, good: p?.good ?? 0, elapsedMin: (p?.plannedSec ?? 0) / 60, faulty };
}

export function mttr(machineId: string, type: string, memory: MemoryEntry[]): number {
  const own = memory.filter((e) => e.machineId === machineId);
  const same = own.length ? own : memory.filter((e) => e.machineType === type);
  if (same.length) return Math.round(same.reduce((a, e) => a + e.durationMin, 0) / same.length);
  return DEFAULT_MTTR.find(([re]) => re.test(type))?.[1] ?? 45;
}

const round = (x: number) => Math.round(x);

/** Tool get_situation: per line, the gap to the shift target if nothing changes, and the faulty machines. */
export function getSituation(s: RecoveryInput) {
  return {
    assumptions: { shiftMin: SHIFT_MIN, maxBoostPct: MAX_BOOST * 100, overtimeEurPerMin: OVERTIME_EUR_PER_MIN, eurPerBottle: 'line downtime cost per minute / nominal bottles per minute' },
    lines: s.plant.lines.map((l) => {
      const f = lineFacts(s, l.id)!;
      const remaining = Math.max(0, SHIFT_MIN - f.elapsedMin);
      const target = f.nominalPerMin * SHIFT_MIN;
      const projected = f.good + f.nominalPerMin * f.rateShare * remaining;
      return {
        line: f.id,
        name: f.name,
        state: f.rateShare === 0 ? 'stopped' : f.rateShare < 1 ? `running at ${round(f.rateShare * 100)}%` : 'running at 100%',
        remainingMin: round(remaining),
        shiftTargetBottles: round(target),
        projectedBottlesIfNothingChanges: round(projected),
        gapBottles: round(Math.max(0, target - projected)),
        gapEur: round(Math.max(0, target - projected) * f.eurPerBottle),
        spareCapacityForBoostPerMin: f.rateShare === 1 ? round(f.nominalPerMin * MAX_BOOST) : 0,
        faultyMachines: f.faulty,
      };
    }),
  };
}

export type RecoveryOption =
  | { type: 'do_nothing'; line: string }
  | { type: 'repair_now'; line: string; machine: string }
  | { type: 'repair_at_minute'; line: string; machine: string; minute: number }
  | { type: 'boost_other_line'; line: string; minutes: number }
  | { type: 'overtime'; line: string; minutes: number };

/** Tool simulate: effect of one option on a line by the end of the shift, vs doing nothing. */
export function simulate(s: RecoveryInput, o: RecoveryOption) {
  const f = lineFacts(s, o.line);
  if (!f) return { error: `unknown line ${o.line}` };
  const remaining = Math.max(0, SHIFT_MIN - f.elapsedMin);
  const full = f.nominalPerMin;
  const base = f.nominalPerMin * f.rateShare * remaining;
  let extra = 0;
  let costEur = 0;
  const notes: string[] = [];
  const machine = 'machine' in o ? f.faulty.find((m) => m.machineId === o.machine) : undefined;
  if ((o.type === 'repair_now' || o.type === 'repair_at_minute') && !machine) return { error: `${o.machine} is not a faulty machine of ${o.line}` };

  if (o.type === 'repair_now') {
    const m = machine!;
    // A bypassed machine can be repaired while the twin keeps producing; otherwise the line is down for the repair.
    const downRate = m.reason.startsWith('bypassed') ? f.rateShare : 0;
    const t = Math.min(remaining, m.mttrMin);
    extra = downRate * full * t + full * (remaining - t) - base;
    notes.push(`${m.machineId} repair ${m.mttrMin} min${downRate ? ', twin keeps producing meanwhile' : ', line down meanwhile'}`);
  } else if (o.type === 'repair_at_minute') {
    const m = machine!;
    const start = Math.min(remaining, Math.max(0, o.minute));
    const t = Math.min(remaining - start, m.mttrMin);
    const downRate = m.reason.startsWith('bypassed') ? f.rateShare : 0;
    extra = f.rateShare * full * start + downRate * full * t + full * (remaining - start - t) - base;
    notes.push(`run as now for ${round(start)} min, then ${m.machineId} repair ${m.mttrMin} min`);
    if (f.rateShare === 0) notes.push('the line is stopped: waiting only adds downtime');
  } else if (o.type === 'boost_other_line') {
    if (f.rateShare < 1) return { error: `${o.line} is not healthy at 100%: it cannot be boosted` };
    const minutes = Math.min(remaining, Math.max(0, o.minutes));
    extra = full * MAX_BOOST * minutes;
    notes.push(`+${MAX_BOOST * 100}% speed for ${round(minutes)} min: more wear, check vibration and temperatures`);
  } else if (o.type === 'overtime') {
    const minutes = Math.max(0, Math.min(120, o.minutes));
    extra = full * minutes;
    costEur = minutes * OVERTIME_EUR_PER_MIN;
    notes.push(`overtime ${round(minutes)} min at full rate, crew cost €${costEur}`);
  }
  return {
    option: o,
    extraBottles: round(extra),
    eurRecovered: round(extra * f.eurPerBottle),
    costEur: round(costEur),
    netEur: round(extra * f.eurPerBottle - costEur),
    notes,
  };
}
