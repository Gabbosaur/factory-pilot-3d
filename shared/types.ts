/**
 * Shared TypeScript types. Data types are inferred from shared/schemas.ts;
 * runtime-only types (incidents, decisions) are declared here.
 */
import type { z } from 'zod';
import type {
  ActionCodeSchema,
  AlarmSchema,
  AutonomyLevelSchema,
  DiagnosisSchema,
  FactoryConfigSchema,
  FaultConfigSchema,
  MachineConfigSchema,
  MachineStatusSchema,
  MemoryEntrySchema,
  RiskAssessmentSchema,
  RiskLevelSchema,
  SampleSchema,
  SensorConfigSchema,
} from './schemas';

export { WHITELIST } from './schemas';

export type MachineStatus = z.infer<typeof MachineStatusSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;
export type ActionCode = z.infer<typeof ActionCodeSchema>;
export type Sample = z.infer<typeof SampleSchema>;
export type Alarm = z.infer<typeof AlarmSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type SensorConfig = z.infer<typeof SensorConfigSchema>;
export type MachineConfig = z.infer<typeof MachineConfigSchema>;
export type FaultConfig = z.infer<typeof FaultConfigSchema>;
export type FactoryConfig = z.infer<typeof FactoryConfigSchema>;
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export interface Impact {
  costPerMin: number;
  partsAtRiskPerMin: number;
  savingsEur: number;
  horizonMin: number;
}

export type EscalationReason =
  | 'rischio_alto'
  | 'confidenza_bassa'
  | 'diagnosi_non_disponibile'
  | 'azione_non_whitelist';

export interface EscalationDecision {
  escalate: boolean;
  reasons: EscalationReason[];
}

export type AutonomyMode = 'suggerisci' | 'bozza' | 'approva_un_clic' | 'esegui_e_notifica';

export type IncidentStatus = 'analisi' | 'in_coda' | 'autonomo' | 'approvato' | 'rifiutato' | 'chiuso';

export interface IncidentLogEntry {
  ts: string;
  kind: 'info' | 'llm' | 'azione' | 'decisione' | 'errore';
  message: string;
  author?: 'Tecnico' | 'Responsabile' | 'Gestore_Autonomia' | 'Sistema';
}

export interface WorkOrder {
  id: string;
  machineId: string;
  cause: string;
  action: string;
  parts: string[];
  priority: RiskLevel;
  assignee: string;
  manualPage: number | null;
  createdAt: string;
  closedAt?: string;
}

export interface Incident {
  id: string;
  scenarioId: string;
  machineId: string;
  alarmIds: string[];
  sensorIds: string[];
  createdAt: string;
  status: IncidentStatus;
  /** [root cause, ..., machineId] */
  causalPath: string[];
  rootCauseComplete: boolean;
  impact: Impact;
  priority: number;
  diagnosis: Diagnosis | null | 'non_disponibile';
  risk: RiskAssessment | null;
  escalation: EscalationDecision | null;
  /** Frozen at creation (Req 10.9). */
  autonomyLevel: AutonomyLevel;
  autonomyMode?: AutonomyMode;
  similar: MemoryEntry[];
  log: IncidentLogEntry[];
  llmCalls: number;
  alarmToDiagnosisSec?: number;
  workOrder?: WorkOrder;
}

/** Response envelope of all inference API routes. */
export type ApiResult<T> =
  | { ok: true; data: T; meta?: LlmCallMeta }
  | { ok: false; retryable: boolean; retryAfterMs?: number; error: string };

export interface LlmCallMeta {
  agent: 'diagnosi' | 'sicurezza' | 'onboarding' | 'memoria';
  model: string;
  latencyMs: number;
  inTok: number;
  outTok: number;
  replay: boolean;
}
