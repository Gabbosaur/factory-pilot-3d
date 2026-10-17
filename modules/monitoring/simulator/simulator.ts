/**
 * Simulatore (Req 2). Deterministic given (seed, config, commands applied at tick indices).
 * Pure class: the caller drives it with tick(); no timers inside, so it is fully testable.
 */
import type { FactoryConfig, FaultConfig, Sample } from '@/shared/types';

/** mulberry32 PRNG: small, fast, deterministic. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Delay (in ticks = seconds) between a machine and each downstream hop in a cascade (Req 2.4: 5–30 s). */
export const CASCADE_DELAY_TICKS = 8;

interface ActiveEffect {
  sensorId: string;
  ratePerSec: number;
  startTick: number;
  /** Drift accumulated so far: grows only while the line runs, scaled by the drift factor at each tick. */
  drift: number;
}

/** Hall temperature the temperature sensors cool down to while the line is stopped. */
const AMBIENT_C = 22;
/** Cool-down time constant in ticks (compressed for the demo: real machines take 20–60 min). */
const COOL_TAU = 90;

interface ActiveFault {
  fault: FaultConfig;
  startTick: number;
  /** machineId -> effects applied to it */
  effects: Map<string, ActiveEffect[]>;
}

export type InjectResult = { ok: true } | { ok: false; reason: string };

export class Simulator {
  private rand: () => number;
  private tickIndex = 0;
  private faults: ActiveFault[] = [];
  /** Per machine multiplier on fault drift (riduci_velocita lowers it). */
  private driftFactor = new Map<string, number>();
  /** Machines stopped by a protective trip (a serial line stops as a whole; other lines keep running). */
  private stopped = new Set<string>();
  /** Last emitted value per machine|sensor, used to coast down while stopped. */
  private last = new Map<string, number>();

  constructor(
    private config: FactoryConfig,
    private readonly seed = 42,
    private readonly startTs = Date.now(),
  ) {
    this.rand = mulberry32(seed);
  }

  get tick(): number {
    return this.tickIndex;
  }

  get activeFaults(): readonly FaultConfig[] {
    return this.faults.map((f) => f.fault);
  }

  /** Returns machines that currently have a fault effect (direct or cascaded). */
  affectedMachines(): string[] {
    const s = new Set<string>();
    for (const f of this.faults) for (const k of f.effects.keys()) s.add(k);
    return [...s];
  }

  /** Inject a configured fault (Req 2.3, 2.4, 2.8). */
  inject(faultId: string): InjectResult {
    const fault = this.config.faults.find((f) => f.id === faultId);
    if (!fault) return { ok: false, reason: `unknown fault type: ${faultId}` };
    const machine = this.config.machines.find((m) => m.id === fault.machineId);
    if (!machine) return { ok: false, reason: `unknown machine: ${fault.machineId}` };
    if (this.faults.some((f) => f.fault.machineId === fault.machineId))
      return { ok: false, reason: `${machine.name} already has an active fault` };

    const startTick = this.tickIndex;
    const effects = new Map<string, ActiveEffect[]>();
    effects.set(
      fault.machineId,
      fault.effects.map((e) => ({ ...e, startTick, drift: 0 })),
    );

    if (fault.kind === 'cascata') {
      // BFS downstream; each hop starts CASCADE_DELAY_TICKS after its upstream neighbour.
      const byId = new Map(this.config.machines.map((m) => [m.id, m]));
      const depth = new Map<string, number>([[fault.machineId, 0]]);
      const queue = [fault.machineId];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const next of byId.get(cur)?.downstream ?? []) {
          if (depth.has(next)) continue;
          depth.set(next, depth.get(cur)! + 1);
          queue.push(next);
        }
      }
      for (const [mid, d] of depth) {
        if (d === 0) continue;
        const m = byId.get(mid)!;
        // Only configured downstream effects propagate: a machine with no physical link to the fault
        // (e.g. the outfeed conveyor motor for a pump bearing) is not degraded.
        const list = (fault.downstreamEffects ?? [])
          .filter((e) => m.sensors.some((s) => s.id === e.sensorId))
          .map((e) => ({ ...e, startTick: startTick + d * CASCADE_DELAY_TICKS, drift: 0 }));
        if (list.length) effects.set(mid, list);
      }
    }
    this.faults.push({ fault, startTick, effects });
    return { ok: true };
  }

  /** Remove all faults (Req 2.5). */
  reset(): void {
    this.faults = [];
    this.driftFactor.clear();
  }

  /** Repair: remove the faults originating on a machine (and their cascade effects). */
  clearFault(machineId: string): boolean {
    const before = this.faults.length;
    this.faults = this.faults.filter((f) => f.fault.machineId !== machineId);
    this.driftFactor.delete(machineId);
    return this.faults.length < before;
  }

  /** True when no machine is stopped. */
  get isLineRunning(): boolean {
    return this.stopped.size === 0;
  }

  /** Protective trip (false) or restart (true) of a line: the given machines, or all of them. */
  setLineRunning(running: boolean, machineIds: readonly string[] = this.config.machines.map((m) => m.id)): void {
    for (const id of machineIds) {
      if (running) this.stopped.delete(id);
      else this.stopped.add(id);
    }
  }

  /** Slow down fault drift on a machine (used by the riduci_velocita action). Returns previous factor. */
  setDriftFactor(machineId: string, factor: number): number {
    const prev = this.driftFactor.get(machineId) ?? 1;
    if (factor === 1) this.driftFactor.delete(machineId);
    else this.driftFactor.set(machineId, factor);
    return prev;
  }

  /** Switch factory (Req 2.9). */
  setConfig(config: FactoryConfig): void {
    this.config = config;
    this.reset();
  }

  /** Advance one second and return one Sample per sensor of every machine (Req 2.1, 2.2). */
  step(): Sample[] {
    const t = this.tickIndex;
    const ts = this.startTs + t * 1000;
    const out: Sample[] = [];
    for (const m of this.config.machines) {
      const factor = this.driftFactor.get(m.id) ?? 1;
      for (const s of m.sensors) {
        const [lo, hi] = s.nominal;
        const mid = (lo + hi) / 2;
        const half = (hi - lo) / 2;
        // Uniform noise, clamped inside the nominal range so healthy machines never cross warn.
        // Drawn even while stopped so the random sequence does not depend on stops.
        const noise = (this.rand() * 2 - 1) * Math.min(s.noise, half);
        const key = `${m.id}|${s.id}`;
        let value: number;
        if (!this.stopped.has(m.id)) {
          value = Math.min(hi, Math.max(lo, mid + noise));
          for (const f of this.faults) {
            for (const e of f.effects.get(m.id) ?? []) {
              if (e.sensorId !== s.id || t < e.startTick) continue;
              e.drift += e.ratePerSec * factor; // the fault degrades only while the machine runs
              value += e.drift;
            }
          }
        } else {
          // Stopped: temperatures cool towards the hall (process temperatures below it stay), the rest drops to 0.
          const prev = this.last.get(key) ?? mid;
          value = s.unit === '°C' ? prev + (Math.min(mid, AMBIENT_C) - prev) / COOL_TAU : 0;
        }
        this.last.set(key, value);
        out.push({ machineId: m.id, sensorId: s.id, value: Math.round(value * 1000) / 1000, ts });
      }
    }
    this.tickIndex++;
    return out;
  }
}
