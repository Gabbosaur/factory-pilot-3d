/**
 * Gestore_Autonomia (Req 10). Pure decision function; execution side effects live in the orchestrator.
 */
import { WHITELIST } from '@/shared/schemas';
import type { ActionCode, AutonomyLevel, AutonomyMode, EscalationDecision, FactoryConfig } from '@/shared/types';

/** Level configured for (machine type, action), default L0 (Req 10.1). */
export function autonomyLevelFor(config: FactoryConfig, machineType: string, action: ActionCode): AutonomyLevel {
  return config.autonomy[machineType]?.[action] ?? 'L0';
}

export function autonomyMode(level: AutonomyLevel, decision: EscalationDecision, action: ActionCode): AutonomyMode {
  const whitelisted = (WHITELIST as readonly string[]).includes(action);
  // L0: alert only, the AI just suggests.
  if (level === 'L0') return 'suggerisci';
  // Non-whitelisted actions never run on their own: at most a manual draft the technician executes (Req 10.6).
  if (!whitelisted) return 'bozza';
  // L1: ready action, one click from a human to run it.
  if (level === 'L1') return 'approva_un_clic';
  // L2: fully autonomous, but only when the safety rule does not require a human (Req 10.5).
  return decision.escalate ? 'approva_un_clic' : 'esegui_e_notifica';
}

export const MODE_LABEL: Record<AutonomyMode, string> = {
  suggerisci: 'L0 · Alert only',
  bozza: 'L1 · Draft, run manually',
  approva_un_clic: 'L1 · Approve to act',
  esegui_e_notifica: 'L2 · Autonomous',
};

export const ACTION_LABEL: Record<ActionCode, string> = {
  riduci_velocita: 'Reduce line speed',
  apri_ticket: 'Open maintenance ticket',
  pianifica_ispezione: 'Schedule inspection',
  intervento_manutentivo: 'Maintenance intervention',
};
