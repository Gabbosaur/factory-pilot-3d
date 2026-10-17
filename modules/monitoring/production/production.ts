/**
 * Production counters of the serial line (bottles started, rejected per station, good), throughput
 * and OEE = availability × performance × quality. Pure and deterministic: the store calls
 * stepProduction() once per simulated second.
 */
import type { FactoryConfig } from '@/shared/types';

/** "Reduce speed" lowers the line speed by 30–40 % (conveyor manual, p. 3). */
export const REDUCED_SPEED = 0.65;
/** Rolling window for the current throughput. */
const RATE_WINDOW_SEC = 60;

export interface ProductionState {
  /** Simulated seconds since the shift started (simulation running). */
  plannedSec: number;
  /** Seconds the line actually ran (not stopped by a protective trip). */
  runSec: number;
  /** Bottles that entered the line (fractional, displayed rounded down). */
  started: number;
  /** Bottles rejected per machine id. */
  rejects: Record<string, number>;
  good: number;
  /** Good bottles per second over the last RATE_WINDOW_SEC seconds. */
  recentGood: number[];
}

export const initProduction = (): ProductionState => ({ plannedSec: 0, runSec: 0, started: 0, rejects: {}, good: 0, recentGood: [] });

/** Nominal line output in bottles per minute: the sink machine(s) of the line. */
export function nominalPerMin(config: FactoryConfig): number {
  const sinks = config.machines.filter((m) => m.downstream.length === 0);
  const list = sinks.length ? sinks : config.machines;
  return list.reduce((s, m) => s + m.partsPerMin, 0);
}

/** Sensors that measure a reject percentage at a station (e.g. fill-level rejects, capping rejects). */
export function rejectSensors(config: FactoryConfig) {
  return config.machines.flatMap((m) => m.sensors.filter((s) => s.unit === '%' && /reject/i.test(s.id)).map((s) => ({ machine: m, sensor: s })));
}

export interface StepInput {
  lineRunning: boolean;
  /** Line speed factor (1 = nominal). */
  speed: number;
  /** Latest value per `machineId|sensorId`. */
  values: Record<string, number>;
}

export function stepProduction(prev: ProductionState, config: FactoryConfig, input: StepInput): ProductionState {
  const plannedSec = prev.plannedSec + 1;
  if (!input.lineRunning) {
    return { ...prev, plannedSec, recentGood: [...prev.recentGood, 0].slice(-RATE_WINDOW_SEC) };
  }
  const started = (nominalPerMin(config) / 60) * input.speed;
  // Parallel machines of the same type share the flow (e.g. two fillers): each sees 1/k of it.
  const sameType = new Map<string, number>();
  for (const m of config.machines) sameType.set(m.type, (sameType.get(m.type) ?? 0) + 1);
  const rejects = { ...prev.rejects };
  let rejectedNow = 0;
  for (const { machine, sensor } of rejectSensors(config)) {
    const pct = input.values[`${machine.id}|${sensor.id}`];
    if (pct === undefined || pct <= 0) continue;
    const r = (started / (sameType.get(machine.type) ?? 1)) * Math.min(pct, 100) / 100;
    rejects[machine.id] = (rejects[machine.id] ?? 0) + r;
    rejectedNow += r;
  }
  const goodNow = Math.max(0, started - rejectedNow);
  return {
    plannedSec,
    runSec: prev.runSec + 1,
    started: prev.started + started,
    rejects,
    good: prev.good + goodNow,
    recentGood: [...prev.recentGood, goodNow].slice(-RATE_WINDOW_SEC),
  };
}

export interface ProductionKpi {
  good: number;
  started: number;
  rejected: number;
  rejectPct: number;
  /** Good bottles per hour over the last minute. */
  throughputPerHour: number;
  targetPerHour: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

export function kpis(p: ProductionState, config: FactoryConfig): ProductionKpi {
  const targetPerHour = nominalPerMin(config) * 60;
  const rejected = Object.values(p.rejects).reduce((s, x) => s + x, 0);
  const window = p.recentGood.length;
  const throughputPerHour = window ? (p.recentGood.reduce((s, x) => s + x, 0) / window) * 3600 : 0;
  const availability = p.plannedSec ? p.runSec / p.plannedSec : 1;
  const performance = p.runSec ? Math.min(1, p.started / p.runSec / (targetPerHour / 3600)) : 1;
  const quality = p.started ? p.good / p.started : 1;
  return {
    good: p.good,
    started: p.started,
    rejected,
    rejectPct: p.started ? (rejected / p.started) * 100 : 0,
    throughputPerHour,
    targetPerHour,
    availability,
    performance,
    quality,
    oee: availability * performance * quality,
  };
}
