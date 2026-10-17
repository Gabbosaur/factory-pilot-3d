/**
 * Motore_Anomalie (Req 3). Deterministic, no LLM calls.
 * Feed samples with ingest(); get state changes and alarms back.
 */
import { AlarmSchema } from '@/shared/schemas';
import type { Alarm, FactoryConfig, MachineStatus, Sample } from '@/shared/types';

export const WINDOW = 60;
export const CLEAR_STREAK = 10;
/** A statistical (z-score) warning must persist this many samples: at 1 Hz, noise alone crosses 2.5σ now and then. */
export const WARN_PERSIST = 3;

interface SensorState {
  /** Healthy reference values used for mean/std (anomalous samples are excluded). */
  ref: number[];
  /** Last samples regardless of health, for the alarm window. */
  recent: Sample[];
  level: 0 | 1 | 2; // 0 ok, 1 warn, 2 crit (current sample)
  clean: number; // consecutive clean samples
  warnRun: number; // consecutive samples above the z-score warning level
}

export interface EngineEvent {
  statusChanges: Array<{ machineId: string; status: MachineStatus; ts: number }>;
  alarms: Alarm[]; // new or updated alarms
  rejected: Array<{ sample: unknown; reason: string }>;
}

export function zScore(value: number, ref: readonly number[]): number | null {
  if (ref.length < WINDOW) return null;
  let sum = 0;
  for (const v of ref) sum += v;
  const mean = sum / ref.length;
  let sq = 0;
  for (const v of ref) sq += (v - mean) ** 2;
  const std = Math.sqrt(sq / ref.length);
  if (std === 0) return null;
  return (value - mean) / std;
}

export class AnomalyEngine {
  private sensors = new Map<string, SensorState>();
  private status = new Map<string, MachineStatus>();
  /** Timestamp of last green→non-green transition, used by root cause analysis. */
  private anomalyStart = new Map<string, number>();
  private openAlarms = new Map<string, Alarm>(); // key machine|sensor
  private alarmSeq = 0;
  private stopped = new Set<string>();
  private zWarn: number;
  private zCrit: number;

  constructor(private config: FactoryConfig) {
    this.zWarn = config.zThresholds.warn;
    this.zCrit = config.zThresholds.crit;
    for (const m of config.machines) this.status.set(m.id, 'verde');
  }

  /** Req 3.10: reject invalid z thresholds and keep the previous ones. */
  setZThresholds(warn: number, crit: number): { ok: true } | { ok: false; error: string } {
    if (!(warn >= 0.5 && warn <= 10 && crit >= 0.5 && crit <= 10))
      return { ok: false, error: 'z thresholds outside the 0.5–10.0 range' };
    if (warn >= crit) return { ok: false, error: 'the warning threshold must be lower than the critical threshold' };
    this.zWarn = warn;
    this.zCrit = crit;
    return { ok: true };
  }

  /** Machines whose samples are ignored while the line is stopped (empty = all running). */
  setStopped(machineIds: readonly string[]): void {
    this.stopped = new Set(machineIds);
  }

  getStatus(machineId: string): MachineStatus {
    return this.status.get(machineId) ?? 'verde';
  }

  getAllStatuses(): Record<string, MachineStatus> {
    return Object.fromEntries(this.status);
  }

  getAnomalyStarts(): Record<string, number> {
    return Object.fromEntries(this.anomalyStart);
  }

  getOpenAlarms(): Alarm[] {
    return [...this.openAlarms.values()];
  }

  private sensorConf(machineId: string, sensorId: string) {
    return this.config.machines.find((m) => m.id === machineId)?.sensors.find((s) => s.id === sensorId);
  }

  ingest(samples: readonly unknown[]): EngineEvent {
    const ev: EngineEvent = { statusChanges: [], alarms: [], rejected: [] };
    const touched = new Set<string>();

    for (const raw of samples) {
      const s = raw as Partial<Sample>;
      if (typeof s?.value !== 'number' || !Number.isFinite(s.value)) {
        ev.rejected.push({ sample: raw, reason: 'non-numeric or non-finite value' });
        continue;
      }
      if (typeof s.ts !== 'number') {
        ev.rejected.push({ sample: raw, reason: 'missing timestamp' });
        continue;
      }
      const conf = typeof s.machineId === 'string' && typeof s.sensorId === 'string' ? this.sensorConf(s.machineId, s.sensorId) : undefined;
      if (!conf) {
        ev.rejected.push({ sample: raw, reason: 'machine or sensor not in the active configuration' });
        continue;
      }
      const sample = s as Sample;
      const key = `${sample.machineId}|${sample.sensorId}`;
      let st = this.sensors.get(key);
      if (!st) {
        st = { ref: [], recent: [], level: 0, clean: 0, warnRun: 0 };
        this.sensors.set(key, st);
      }

      // Stopped machines (protective trip) keep their state: their coasting values are not anomalies.
      if (this.stopped.has(sample.machineId)) continue;

      const z = zScore(sample.value, st.ref);
      const absZ = z === null ? 0 : Math.abs(z);
      // Red only above the absolute (ISO / manual) limit, which is what trips the line.
      // The z-score is an early warning: at most yellow, but it already raises an alarm.
      const crit = sample.value > conf.crit;
      const zWarn = z !== null && absZ > this.zWarn;
      st.warnRun = zWarn ? st.warnRun + 1 : 0;
      const warn = !crit && ((zWarn && st.warnRun >= WARN_PERSIST) || sample.value > conf.warn);
      st.level = crit ? 2 : warn ? 1 : 0;
      st.clean = st.level === 0 ? st.clean + 1 : 0;

      st.recent.push(sample);
      if (st.recent.length > WINDOW) st.recent.shift();
      // Unconfirmed z-score excursions are kept out of the healthy reference too.
      if (st.level === 0 && !zWarn) {
        st.ref.push(sample.value);
        if (st.ref.length > WINDOW) st.ref.shift();
      }

      if (crit || warn) {
        const threshold = crit ? conf.crit : sample.value > conf.warn ? conf.warn : this.zWarn;
        const existing = this.openAlarms.get(key);
        const alarm: Alarm = {
          id: existing?.id ?? `alm-${sample.machineId}-${sample.sensorId}-${++this.alarmSeq}`,
          machineId: sample.machineId,
          sensorId: sample.sensorId,
          value: sample.value,
          zScore: Math.round((z ?? 0) * 1000) / 1000,
          threshold,
          severity: crit ? 'rosso' : 'giallo',
          openedAt: existing?.openedAt ?? new Date(sample.ts).toISOString(),
          window: [...st.recent],
        };
        const valid = AlarmSchema.safeParse(alarm);
        if (valid.success) {
          this.openAlarms.set(key, alarm);
          ev.alarms.push(alarm);
        } else {
          ev.rejected.push({ sample: alarm, reason: `invalid alarm: ${valid.error.issues[0]?.message}` });
        }
      }
      touched.add(sample.machineId);
    }

    for (const machineId of touched) {
      const machine = this.config.machines.find((m) => m.id === machineId)!;
      const states = machine.sensors.map((s) => this.sensors.get(`${machineId}|${s.id}`));
      const prev = this.status.get(machineId) ?? 'verde';
      let next: MachineStatus;
      if (states.some((s) => s?.level === 2)) next = 'rosso';
      else if (states.some((s) => s?.level === 1)) next = prev === 'rosso' ? 'rosso' : 'giallo';
      else if (prev !== 'verde' && states.every((s) => !s || s.clean >= CLEAR_STREAK)) next = 'verde';
      else next = prev;

      // A red machine stays red until it fully clears (avoids flapping on noisy crit borders).
      if (prev === 'rosso' && next === 'giallo' && states.some((s) => s && s.clean < CLEAR_STREAK)) next = 'rosso';

      if (next !== prev) {
        const ts = Math.max(...states.map((s) => s?.recent.at(-1)?.ts ?? 0));
        this.status.set(machineId, next);
        if (prev === 'verde') this.anomalyStart.set(machineId, ts);
        if (next === 'verde') {
          this.anomalyStart.delete(machineId);
          for (const s of machine.sensors) this.openAlarms.delete(`${machineId}|${s.id}`);
        }
        ev.statusChanges.push({ machineId, status: next, ts });
      }
    }
    return ev;
  }
}
