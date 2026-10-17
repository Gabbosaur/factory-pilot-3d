/**
 * Shared contracts between Monitoring (A) and Incidents (B).
 * zod schemas are the single source of truth; TS types are inferred in shared/types.ts.
 * Pure module: safe for browser and server. Never import from server/** here.
 */
import { z } from 'zod';

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const id = z.string().min(1).max(64);

export const MachineStatusSchema = z.enum(['verde', 'giallo', 'rosso']);
export const RiskLevelSchema = z.enum(['basso', 'medio', 'alto']);
export const AutonomyLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3']);
export const ActionCodeSchema = z.enum([
  'riduci_velocita',
  'apri_ticket',
  'pianifica_ispezione',
  'intervento_manutentivo',
]);

/** Low-risk, reversible actions allowed for L2/L3 execution (Req 10.6). */
export const WHITELIST = ['riduci_velocita', 'apri_ticket', 'pianifica_ispezione'] as const;

// ---------- Samples and alarms (Req 4) ----------

export const SampleSchema = z.object({
  machineId: id,
  sensorId: id,
  value: finite,
  ts: z.number().int().nonnegative(), // epoch ms
});

const isoWithOffset = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, 'ISO 8601 with timezone');

export const AlarmSchema = z
  .object({
    id,
    machineId: id,
    sensorId: id,
    value: finite,
    zScore: finite,
    threshold: finite,
    severity: z.enum(['giallo', 'rosso']),
    openedAt: isoWithOffset,
    window: z.array(SampleSchema).min(1).max(60),
  })
  .superRefine((a, ctx) => {
    for (let i = 0; i < a.window.length; i++) {
      const s = a.window[i]!;
      if (s.machineId !== a.machineId || s.sensorId !== a.sensorId) {
        ctx.addIssue({ code: 'custom', path: ['window', i], message: 'sample from a different sensor' });
      }
      if (i > 0 && s.ts < a.window[i - 1]!.ts) {
        ctx.addIssue({ code: 'custom', path: ['window', i, 'ts'], message: 'window not sorted by ts' });
      }
    }
  });

// ---------- LLM outputs (Req 8, 9) ----------

const nonBlank = z.string().refine((s) => s.trim().length > 0, 'must not be empty');

export const DiagnosisSchema = z.object({
  causa_probabile: nonBlank,
  pagina_manuale: z.number().int().min(1),
  citazione: nonBlank,
  confidenza: z.number().min(0).max(1),
  azione_raccomandata: nonBlank,
  codice_azione: ActionCodeSchema,
  ricambi: z.array(z.string()),
  /** Set by the client after checking the manual, never by the model. */
  citazione_verificata: z.boolean().optional(),
});

export const RiskAssessmentSchema = z.object({
  livello_rischio: RiskLevelSchema,
  motivazione: nonBlank,
});

// ---------- Factory configuration (Req 1) ----------

export const SensorConfigSchema = z
  .object({
    id,
    name: z.string().min(1).max(100),
    unit: z.string().min(1).max(20),
    nominal: z.tuple([finite, finite]),
    warn: finite,
    crit: finite,
    noise: finite.refine((n) => n >= 0, 'noise must be >= 0'),
    /** Product quality characteristic (e.g. fill volume, capping torque): specification limits for Cpk. */
    spec: z.object({ lsl: finite, usl: finite }).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.nominal[0] > s.nominal[1]) ctx.addIssue({ code: 'custom', path: ['nominal'], message: 'min > max' });
    if (s.warn > s.crit) ctx.addIssue({ code: 'custom', path: ['warn'], message: 'warn threshold above crit' });
    if (s.nominal[1] > s.warn) ctx.addIssue({ code: 'custom', path: ['nominal'], message: 'nominal range exceeds warn threshold' });
    if (s.spec && s.spec.lsl >= s.spec.usl) ctx.addIssue({ code: 'custom', path: ['spec'], message: 'lsl must be below usl' });
  });

export const MachineConfigSchema = z.object({
  id,
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(50),
  position: z.tuple([finite, finite, finite]),
  size: z.tuple([finite, finite, finite]).refine((s) => s.every((v) => v > 0), 'size must be > 0'),
  upstream: z.array(id),
  downstream: z.array(id),
  downtimeCostPerMin: z.number().min(0).max(1_000_000),
  partsPerMin: z.number().min(0).max(10_000),
  manualRef: z.string().min(1),
  sensors: z.array(SensorConfigSchema).max(20),
  /** Plant hierarchy (optional): production line and process cluster. Derived when missing. */
  line: z.string().min(1).max(50).optional(),
  cluster: z.string().min(1).max(50).optional(),
});

export const FaultConfigSchema = z.object({
  id,
  label: z.string().min(1),
  machineId: id,
  kind: z.enum(['locale', 'cascata']),
  effects: z.array(z.object({ sensorId: id, ratePerSec: finite })).min(1),
  /** Effects applied to each downstream machine for cascade faults. */
  downstreamEffects: z.array(z.object({ sensorId: id, ratePerSec: finite })).optional(),
});

export const FactoryConfigSchema = z.object({
  id,
  name: z.string().min(1).max(100),
  manualSearchRefSec: z.number().positive().optional(),
  impactHorizonMin: z.number().min(1).max(1440).default(60),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  zThresholds: z
    .object({ warn: z.number().min(0.5).max(10), crit: z.number().min(0.5).max(10) })
    .refine((z) => z.warn < z.crit, 'warn must be < crit')
    .default({ warn: 2.5, crit: 3.5 }),
  autonomy: z.record(z.string(), z.partialRecord(ActionCodeSchema, AutonomyLevelSchema)).default({}),
  machines: z.array(MachineConfigSchema).min(1).max(50),
  faults: z.array(FaultConfigSchema).default([]),
  /** Display names of the production lines of a multi-line plant (optional). */
  lines: z.array(z.object({ id, name: z.string().min(1).max(100) })).optional(),
});

// ---------- Memory (Req 15) ----------

export const MemoryEntrySchema = z.object({
  id,
  machineId: id,
  machineType: z.string().min(1),
  sensorIds: z.array(id),
  realCause: z.string().min(1).max(500),
  fix: z.string().min(1).max(1000),
  durationMin: z.number().int().min(1).max(1440),
  closedAt: isoWithOffset,
  isSample: z.boolean(),
});
