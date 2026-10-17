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
  Gestore_Autonomia: 'Autonomy manager',
  Sistema: 'System',
};
