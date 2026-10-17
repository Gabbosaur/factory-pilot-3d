/**
 * Statistical process control for the machine view: control limits, live statistics, Cpk and
 * Western Electric / Nelson out-of-control rules. Pure.
 */
import type { MemoryEntry, SensorConfig } from '@/shared/types';

export interface ControlLimits {
  center: number;
  sigma: number;
  ucl: number;
  lcl: number;
}

/** Process limits from the sensor configuration: centre of the nominal band, σ of its noise (uniform ⇒ a/√3). */
export function controlLimits(s: SensorConfig): ControlLimits {
  const [lo, hi] = s.nominal;
  const center = (lo + hi) / 2;
  const sigma = Math.max(Math.min(s.noise, (hi - lo) / 2) / Math.sqrt(3), 1e-9);
  return { center, sigma, ucl: center + 3 * sigma, lcl: center - 3 * sigma };
}

export function stats(values: readonly number[]): { mean: number; sd: number } {
  if (!values.length) return { mean: NaN, sd: NaN };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1));
  return { mean, sd };
}

/** Product quality characteristics (fill volume, capping torque) carry declared specification limits. */
export const isProductCharacteristic = (s: SensorConfig) => Boolean(s.spec);

/**
 * Process capability vs the declared specification (≥ 1.33 capable, 1–1.33 marginal, < 1 not capable).
 * Only for product characteristics: machine condition signals (vibration, temperature) have no spec.
 */
export function cpk(values: readonly number[], s: SensorConfig): number | null {
  if (!s.spec || values.length < 10) return null;
  const { mean, sd } = stats(values);
  if (!(sd > 0)) return null;
  return Math.min((s.spec.usl - mean) / (3 * sd), (mean - s.spec.lsl) / (3 * sd));
}

/** Share of the window outside the specification (an estimate of defect rate on the characteristic). */
export function outOfSpecPct(values: readonly number[], s: SensorConfig): number | null {
  if (!s.spec || !values.length) return null;
  return (values.filter((v) => v < s.spec!.lsl || v > s.spec!.usl).length / values.length) * 100;
}

export interface Condition {
  zone: 'normal' | 'warning' | 'trip';
  /** Linear trend over the window, units per minute. */
  slopePerMin: number;
  /** Minutes until the trip limit at the current trend (null when not rising towards it). */
  minutesToTrip: number | null;
}

/** Condition monitoring for machine signals: zone vs limits, trend, time to the trip limit. */
export function condition(values: readonly number[], s: SensorConfig, sampleSec = 1): Condition | null {
  const last = values.at(-1);
  if (last === undefined) return null;
  const zone = last > s.crit ? 'trip' : last > s.warn ? 'warning' : 'normal';
  let slopePerMin = 0;
  if (values.length >= 10) {
    const n = values.length, mx = (n - 1) / 2, my = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    values.forEach((v, i) => ((num += (i - mx) * (v - my)), (den += (i - mx) ** 2)));
    slopePerMin = den ? (num / den) * (60 / sampleSec) : 0;
  }
  const minutesToTrip = slopePerMin > 1e-9 && last < s.crit ? (s.crit - last) / slopePerMin : null;
  return { zone, slopePerMin, minutesToTrip };
}

export type SpcSignal = { rule: 'beyond_limits' | 'run_of_9'; message: string } | null;

/** Rule 1: a point beyond ±3σ; Nelson rule 2: 9 consecutive points on one side of the centre (1/s sampling makes 7 too noisy). */
export function spcSignal(values: readonly number[], l: ControlLimits): SpcSignal {
  const last = values.at(-1);
  if (last === undefined) return null;
  if (last > l.ucl || last < l.lcl) return { rule: 'beyond_limits', message: `Last point ${last > l.ucl ? 'above UCL' : 'below LCL'}` };
  const tail = values.slice(-9);
  if (tail.length === 9 && (tail.every((v) => v > l.center) || tail.every((v) => v < l.center)))
    return { rule: 'run_of_9', message: `9 points in a row ${tail[0]! > l.center ? 'above' : 'below'} the centre line (drift)` };
  return null;
}

/** MTBF (days between failures over the observed period) and MTTR (minutes) from closed interventions. */
export function reliability(entries: readonly MemoryEntry[], now = Date.now()): { failures: number; mtbfDays: number | null; mttrMin: number | null } {
  if (!entries.length) return { failures: 0, mtbfDays: null, mttrMin: null };
  const first = Math.min(...entries.map((e) => Date.parse(e.closedAt)));
  const mttrMin = entries.reduce((s, e) => s + e.durationMin, 0) / entries.length;
  const days = Math.max(0, (now - first) / 86_400_000);
  return { failures: entries.length, mtbfDays: days > 0 ? days / entries.length : null, mttrMin };
}
