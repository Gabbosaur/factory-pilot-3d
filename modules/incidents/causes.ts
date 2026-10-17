/**
 * Root-cause choices offered when a technician closes an intervention: the AI diagnosis first,
 * then causes already confirmed on this machine (factory memory), then the typical causes for the
 * machine type (from the manuals' troubleshooting sections). "Other" lets the technician type one.
 */
import type { MemoryEntry } from '@/shared/types';

/** Typical root causes per machine type (keys matched by substring, e.g. "centrifugal_pump" ⊃ "pump"). */
export const KNOWN_CAUSES: Record<string, string[]> = {
  pump: [
    'Worn or damaged bearing (insufficient lubrication)',
    'Bearing over- or under-greased',
    'Coupling misalignment',
    'Impeller imbalance or debris on the impeller',
    'Cavitation (low NPSH / low tank level)',
    'Mechanical seal leak',
    'Motor electrical fault',
  ],
  filler: [
    'Unstable supply from the feed pump (upstream cause)',
    'Worn or dirty filling valve',
    'Level probe out of calibration',
    'Product temperature out of range',
  ],
  capper: [
    'Worn magnetic clutch on the capping heads',
    'Heads out of calibration (torque setting)',
    'Crooked caps from the cap chute',
    'Irregular fill level from the filler (upstream cause)',
  ],
  conveyor: [
    'Motor fan or grille clogged with cardboard dust',
    'Overload due to excessive speed',
    'Belt tension or tracking problem',
    'Worn gear motor or bearing',
  ],
};

export const OTHER_CAUSE = '__other__';

export interface CauseOption {
  value: string;
  label: string;
  source: 'ai' | 'memory' | 'manual';
}

export function causeOptions(machineType: string, aiCause: string | null, similar: readonly MemoryEntry[]): CauseOption[] {
  const out: CauseOption[] = [];
  const seen = new Set<string>();
  const add = (value: string, source: CauseOption['source'], label = value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ value: value.trim(), label, source });
  };
  if (aiCause) add(aiCause, 'ai');
  for (const m of similar) add(m.realCause, 'memory');
  const typical = Object.entries(KNOWN_CAUSES).find(([k]) => machineType.includes(k))?.[1] ?? [];
  for (const c of typical) add(c, 'manual');
  return out;
}
