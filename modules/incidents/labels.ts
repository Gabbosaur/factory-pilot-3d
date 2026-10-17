/**
 * English display labels for internal codes. Codes (shared/schemas.ts) never change;
 * only these labels are shown to users.
 */
import type { IncidentLogEntry, IncidentStatus, MachineStatus, RiskLevel } from '@/shared/types';

export const RISK_LABEL: Record<RiskLevel, string> = { basso: 'Low', medio: 'Medium', alto: 'High' };

export const STATUS_LABEL: Record<MachineStatus, string> = { verde: 'OK', giallo: 'Warning', rosso: 'Alarm' };

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  analisi: 'analysing',
  in_coda: 'awaiting decision',
  autonomo: 'handled autonomously',
  approvato: 'approved',
  rifiutato: 'rejected',
  chiuso: 'closed',
};

export const AUTHOR_LABEL: Record<NonNullable<IncidentLogEntry['author']>, string> = {
  Tecnico: 'Technician',
  Responsabile: 'Manager',
  Gestore_Autonomia: 'Autopilot',
  Sistema: 'System',
};

/** Pill classes (background + text) per machine status, for consistent colour across the UI. */
export const STATUS_PILL: Record<MachineStatus, string> = {
  verde: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  giallo: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  rosso: 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30',
};

export const STATUS_DOT: Record<MachineStatus, string> = {
  verde: 'bg-emerald-400',
  giallo: 'bg-amber-400',
  rosso: 'bg-red-400',
};

export const RISK_PILL: Record<RiskLevel, string> = {
  basso: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  medio: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  alto: 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30',
};
