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
}

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
  /** Per machine multiplier on fault drift (riduci_velocita sets 0.6). */
  private driftFactor = new Map<string, number>();

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
      fault.effects.map((e) => ({ ...e, startTick })),
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
        // Use configured downstream effects when they match the machine's sensors, otherwise
        // degrade the first sensor so it crosses its warn threshold (Req 2.4).
        const configured = (fault.downstreamEffects ?? []).filter((e) => m.sensors.some((s) => s.id === e.sensorId));
        const fallback = m.sensors[0]
          ? [{ sensorId: m.sensors[0].id, ratePerSec: (m.sensors[0].crit - m.sensors[0].nominal[1]) / 20 }]
          : [];
        const list = (configured.length ? configured : fallback).map((e) => ({
          ...e,
          startTick: startTick + d * CASCADE_DELAY_TICKS,
        }));
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
        const noise = (this.rand() * 2 - 1) * Math.min(s.noise, half);
        let value = Math.min(hi, Math.max(lo, mid + noise));
        for (const f of this.faults) {
          for (const e of f.effects.get(m.id) ?? []) {
            if (e.sensorId === s.id && t >= e.startTick) value += e.ratePerSec * (t - e.startTick) * factor;
          }
        }
        out.push({ machineId: m.id, sensorId: s.id, value: Math.round(value * 1000) / 1000, ts });
      }
    }
    this.tickIndex++;
    return out;
  }
}
