/**
 * Regola_Escalation (Req 9). Pure and deterministic. The autonomy level is intentionally NOT
 * an input: the safety invariant (high risk or low confidence ⇒ human) holds by construction.
 */
import { WHITELIST } from '@/shared/schemas';
import type { Diagnosis, EscalationDecision, EscalationReason, RiskAssessment } from '@/shared/types';

export function isValidConfidence(c: unknown): c is number {
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1;
}

export function escalation(
  diagnosis: Diagnosis | null | 'non_disponibile',
  risk: RiskAssessment | null,
  confidenceThreshold: number,
): EscalationDecision {
  const reasons: EscalationReason[] = [];
  const diag = diagnosis && diagnosis !== 'non_disponibile' && isValidConfidence(diagnosis.confidenza) ? diagnosis : null;

  // Missing/invalid risk assessment counts as high risk (Req 9.2, 9.7).
  if (!risk || risk.livello_rischio === 'alto') reasons.push('rischio_alto');
  if (!diag) reasons.push('diagnosi_non_disponibile');
  else {
    if (diag.confidenza < confidenceThreshold) reasons.push('confidenza_bassa');
    if (!(WHITELIST as readonly string[]).includes(diag.codice_azione)) reasons.push('azione_non_whitelist');
  }
  return { escalate: reasons.length > 0, reasons };
}

export const REASON_LABEL: Record<EscalationReason, string> = {
  rischio_alto: 'High risk',
  confidenza_bassa: 'Confidence below threshold',
  diagnosi_non_disponibile: 'AI diagnosis unavailable',
  azione_non_whitelist: 'Action not allowed for automatic execution',
};
