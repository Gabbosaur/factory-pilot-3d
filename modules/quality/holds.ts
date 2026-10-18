/**
 * Quality holds: bottles produced while a product quality signal of the line is abnormal are suspect.
 * They are quarantined as a lot until quality releases (after inspection) or scraps them. Pure.
 */

/** Sensors describing the product (fill volume/level, rejects, inlet flow stability, capping torque). */
export const isQualitySensor = (sensorId: string) => /reject|fill|flow|torque/i.test(sensorId);

/** Seconds without signal before the suspect window is closed. */
export const HOLD_CLEAR_SEC = 10;

export type HoldStatus = 'collecting' | 'quarantined' | 'released' | 'scrapped';

export interface QualityHold {
  id: string;
  lineId: string;
  machineId: string;
  sensorId: string;
  startTick: number;
  endTick: number | null;
  lastSignalTick: number;
  /** Good bottles produced inside the window (they passed inspection but come from an unstable process). */
  suspect: number;
  status: HoldStatus;
  /** Sample bottles of the lot inspected from photos (Gemma). */
  samples?: HoldSample[];
}

export interface HoldSample {
  id: string;
  verdict: 'ok' | 'defect' | 'uncertain';
  defectType: string;
  confidence: number;
  affectsQuality: boolean;
  /** Small JPEG data URL for the thumbnail. */
  thumb: string;
  model: string;
  replay: boolean;
}

/** Minimum inspected samples before suggesting a disposition, and defect share that suggests scrapping. */
export const MIN_SAMPLES = 3;
export const SCRAP_DEFECT_SHARE = 0.2;

export type Disposition = { suggest: 'release' | 'scrap' | 'inspect_more'; reason: string };

/** Suggested decision on a quarantined lot from its inspected samples (the decision stays with quality). */
export function suggestDisposition(samples: readonly HoldSample[] = []): Disposition {
  const n = samples.length;
  const bad = samples.filter((x) => x.verdict === 'defect' || x.affectsQuality).length;
  const unsure = samples.filter((x) => x.verdict === 'uncertain' && !x.affectsQuality).length;
  if (n < MIN_SAMPLES) return { suggest: 'inspect_more', reason: `Inspect at least ${MIN_SAMPLES} samples (${n} so far)` };
  if (bad / n >= SCRAP_DEFECT_SHARE) return { suggest: 'scrap', reason: `${bad}/${n} samples defective (≥ ${SCRAP_DEFECT_SHARE * 100}%)` };
  if (unsure > 0) return { suggest: 'inspect_more', reason: `${unsure}/${n} samples uncertain: inspect more` };
  return { suggest: 'release', reason: `${n}/${n} samples OK` };
}

export interface HoldStep {
  lineId: string;
  tick: number;
  lineRunning: boolean;
  /** Good bottles produced by the line in this tick. */
  goodNow: number;
  /** First product-quality alarm of the line in this tick, if any. */
  signal: { machineId: string; sensorId: string } | null;
}

/** Advances the holds of one line by one tick; returns the new list and the id of a hold opened now. */
export function stepHolds(holds: readonly QualityHold[], s: HoldStep): { holds: QualityHold[]; opened: QualityHold | null } {
  let opened: QualityHold | null = null;
  const next = holds.map((h) => {
    if (h.lineId !== s.lineId || h.status !== 'collecting') return h;
    const lastSignalTick = s.signal ? s.tick : h.lastSignalTick;
    const suspect = h.suspect + (s.lineRunning ? s.goodNow : 0);
    // The window closes when the signal is gone for a while, or the line stops (no more production).
    if (!s.lineRunning || s.tick - lastSignalTick > HOLD_CLEAR_SEC) return { ...h, suspect, lastSignalTick, endTick: s.tick, status: 'quarantined' as const };
    return { ...h, suspect, lastSignalTick };
  });
  const collecting = next.some((h) => h.lineId === s.lineId && h.status === 'collecting');
  if (s.signal && s.lineRunning && !collecting) {
    const n = holds.filter((h) => h.lineId === s.lineId).length + 1;
    opened = {
      id: `QH-${s.lineId}-${String(n).padStart(3, '0')}`,
      lineId: s.lineId,
      machineId: s.signal.machineId,
      sensorId: s.signal.sensorId,
      startTick: s.tick,
      endTick: null,
      lastSignalTick: s.tick,
      suspect: s.goodNow,
      status: 'collecting',
    };
    next.push(opened);
  }
  return { holds: next, opened };
}
