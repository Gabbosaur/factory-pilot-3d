'use client';
/**
 * Orchestratore_Incidenti (Req 8, 9, 10, 12, 13, 14, 15). Browser-side.
 * Alarm → Incident → rootCause → impact → memory → /api/diagnose → verifyCitation → /api/safety
 *       → priority → escalation (code, final word) → autonomy.
 * Internal codes stay as defined in shared/schemas.ts; all user-facing text is English.
 */
import { MANUALS } from '@/data/manuals.generated';
import { DiagnosisSchema, RiskAssessmentSchema } from '@/shared/schemas';
import type { Alarm, Diagnosis, Incident, IncidentLogEntry, MemoryEntry, RiskAssessment, WorkOrder } from '@/shared/types';
import { useStore } from '@/modules/store';
import { rootCause } from './rootCause';
import { computeImpact, priorityScore } from './impact';
import { escalation, REASON_LABEL } from './escalation';
import { autonomyLevelFor, autonomyMode, ACTION_LABEL } from './autonomy';
import { RISK_LABEL } from './labels';
import { parsePages, selectPages, verifyCitation, type ManualPage } from './manual';
import { enqueuePost } from './requestQueue';
import { saveMemory, searchMemory } from './memory/adapter';

const MAX_LLM_CALLS = 3;
const pageCache = new Map<string, ManualPage[]>();

function manualPages(ref: string): ManualPage[] {
  const cached = pageCache.get(ref);
  if (cached) return cached;
  const md = MANUALS[ref];
  const r = md ? parsePages(md) : null;
  const pages = r && r.ok ? r.pages : [];
  pageCache.set(ref, pages);
  return pages;
}

const now = () => new Date().toISOString();
const entry = (kind: IncidentLogEntry['kind'], message: string, author: IncidentLogEntry['author'] = 'Sistema'): IncidentLogEntry => ({
  ts: now(),
  kind,
  message,
  author,
});

function addLog(id: string, ...entries: IncidentLogEntry[]) {
  useStore.getState().patchIncident(id, (i) => ({ log: [...i.log, ...entries] }));
}

function get(id: string): Incident | undefined {
  return useStore.getState().incidents[id];
}

/** Scenario id used to look up replay recordings: the active fault on the root cause, else machine+sensor. */
function scenarioFor(rootId: string, alarm: Alarm): string {
  const st = useStore.getState();
  const fault = st.factory.faults.find((f) => st.activeFaultIds.includes(f.id) && f.machineId === rootId);
  return fault?.id ?? `${alarm.machineId}-${alarm.sensorId}`;
}

let seq = 0;
const cascadeLogged = new Set<string>();

/** Entry point: called for each new or updated alarm from the anomaly engine. */
export function handleAlarms(alarms: Alarm[]) {
  for (const alarm of alarms) {
    // Fresh state per alarm: an incident created for the previous alarm in this batch must be visible.
    const st = useStore.getState();
    // Update an existing open incident for this machine instead of creating a new one.
    const open = Object.values(st.incidents).find((i) => i.machineId === alarm.machineId && i.status !== 'chiuso' && i.status !== 'rifiutato');
    if (open) {
      if (!open.alarmIds.includes(alarm.id) || !open.sensorIds.includes(alarm.sensorId))
        st.patchIncident(open.id, (i) => ({
          alarmIds: i.alarmIds.includes(alarm.id) ? i.alarmIds : [...i.alarmIds, alarm.id],
          sensorIds: i.sensorIds.includes(alarm.sensorId) ? i.sensorIds : [...i.sensorIds, alarm.sensorId],
        }));
      continue;
    }
    // A downstream machine whose root cause already has an open incident: attach, don't duplicate.
    const rc = rootCause(st.factory, st.statuses, st.anomalyStart, alarm.machineId);
    const parent = Object.values(st.incidents).find(
      (i) => i.status !== 'chiuso' && i.status !== 'rifiutato' && i.causalPath[0] === rc.rootCause && i.machineId !== alarm.machineId,
    );
    if (parent && rc.rootCause !== alarm.machineId) {
      // Alarms repeat every tick while the anomaly lasts: log each cascaded machine once per incident.
      const key = `${parent.id}|${alarm.machineId}`;
      if (!cascadeLogged.has(key)) {
        cascadeLogged.add(key);
        addLog(parent.id, entry('info', `Cascade effect: ${alarm.machineId} is now in alarm too (${alarm.sensorId})`));
      }
      continue;
    }
    void createIncident(alarm);
  }
}

async function createIncident(alarm: Alarm) {
  const st = useStore.getState();
  const factory = st.effectiveFactory();
  const machine = factory.machines.find((m) => m.id === alarm.machineId)!;
  const rc = rootCause(factory, st.statuses, st.anomalyStart, alarm.machineId); // Req 12.1
  const impact = computeImpact(factory, rc.path, alarm.machineId); // Req 13.1
  const id = `INC-${String(++seq).padStart(3, '0')}`;
  const root = factory.machines.find((m) => m.id === rc.rootCause)!;

  const inc: Incident = {
    id,
    scenarioId: scenarioFor(rc.rootCause, alarm),
    machineId: alarm.machineId,
    alarmIds: [alarm.id],
    sensorIds: [alarm.sensorId],
    createdAt: alarm.openedAt,
    status: 'analisi',
    causalPath: rc.path,
    rootCauseComplete: rc.complete,
    impact,
    priority: priorityScore(impact.costPerMin, null), // provisional: risk unknown ⇒ high (Req 13.7)
    diagnosis: null,
    risk: null,
    escalation: null,
    autonomyLevel: 'L0',
    similar: [],
    log: [
      entry('info', `Alarm ${alarm.sensorId} = ${alarm.value} on ${machine.name} (threshold ${alarm.threshold})`),
      entry(
        'info',
        rc.path.length > 1
          ? `Root cause traced back along the line: ${rc.path.join(' → ')}`
          : rc.complete
            ? 'No upstream anomaly: the cause is on the machine in alarm'
            : 'Root cause analysis not completed: assuming the machine in alarm',
      ),
    ],
    llmCalls: 0,
  };
  st.upsertIncident(inc);
  if (!st.selectedIncident) st.selectIncident(id);

  // Memory (Evolus RAG with local fallback) – sensors of the root cause machine.
  const rootSensors = rc.rootCause === alarm.machineId ? [alarm.sensorId] : root.sensors.map((s) => s.id);
  const symptom = `${alarm.sensorId} ${alarm.value} above threshold ${alarm.threshold}; path ${rc.path.join('→')}`;
  const mem = await searchMemory({ machineId: root.id, machineType: root.type, sensorIds: rootSensors, symptom });
  useStore.getState().setMemorySource(mem.source);
  useStore.getState().patchIncident(id, { similar: mem.entries });
  addLog(id, entry('info', `Memory (${mem.source === 'evolus' ? 'Evolus RAG' : 'local'}): ${mem.entries.length} similar interventions`));

  await runDiagnosis(id, alarm, mem.entries);
}

/** Error strings from the API routes that mean "the model answered but the output was invalid". */
const INVALID_OUTPUT = /Invalid (schema|JSON)/;

async function runDiagnosis(id: string, alarm: Alarm, similar: MemoryEntry[]) {
  const st = useStore.getState();
  const factory = st.effectiveFactory();
  const inc = get(id)!;
  const byId = new Map(factory.machines.map((m) => [m.id, m]));
  const alarmMachine = byId.get(alarm.machineId)!;
  const root = byId.get(inc.causalPath[0]!)!;
  const sensor = alarmMachine.sensors.find((s) => s.id === alarm.sensorId)!;
  const allPages = manualPages(root.manualRef);
  const pages = selectPages(allPages, [...root.sensors.map((s) => s.name), sensor.name, 'vibration', 'bearing', 'temperature', 'flow', 'reject']);
  const pathMachines = inc.causalPath.map((mid) => {
    const m = byId.get(mid)!;
    return { id: m.id, name: m.name, type: m.type, status: useStore.getState().statuses[m.id] ?? 'verde' };
  });

  let diagnosis: Diagnosis | 'non_disponibile' = 'non_disponibile';
  // Req 8.3/8.7: one retry on invalid output, max 3 LLM calls per incident (safety needs one).
  for (let attempt = 0; attempt < 2 && (get(id)?.llmCalls ?? 0) < MAX_LLM_CALLS - 1; attempt++) {
    useStore.getState().patchIncident(id, (i) => ({ llmCalls: i.llmCalls + 1 }));
    const res = await enqueuePost<Diagnosis>('/api/diagnose', {
      incidentId: id,
      scenarioId: inc.scenarioId,
      alarm,
      alarmMachine: pathMachines.at(-1),
      causalPath: pathMachines,
      sensorName: sensor.name,
      sensorUnit: sensor.unit,
      manualPages: pages,
      similar,
      replay: useStore.getState().replay,
    });
    useStore.getState().setAiReachable(res.ok || !/unreachable/.test(res.error));
    if (res.ok) {
      if (res.meta) useStore.getState().logLlm(res.meta);
      const parsed = DiagnosisSchema.safeParse(res.data);
      if (parsed.success) {
        diagnosis = verifyCitation(parsed.data, allPages); // Req 8.5
        addLog(id, entry('llm', `Diagnosis by ${res.meta?.model ?? 'model'}${res.meta?.replay ? ' (replay)' : ''} in ${((res.meta?.latencyMs ?? 0) / 1000).toFixed(1)} s`));
        break;
      }
    }
    addLog(id, entry('errore', `Diagnosis invalid or unavailable: ${res.ok ? 'schema' : res.error}`));
    if (!res.ok && !INVALID_OUTPUT.test(res.error)) break; // only retry on invalid output
  }

  const alarmToDiagnosisSec =
    diagnosis !== 'non_disponibile' ? Math.max(0, Math.round((Date.now() - new Date(inc.createdAt).getTime()) / 1000)) : undefined;
  useStore.getState().patchIncident(id, { diagnosis, alarmToDiagnosisSec });
  if (diagnosis !== 'non_disponibile' && diagnosis.citazione_verificata === false)
    addLog(id, entry('errore', `Page ${diagnosis.pagina_manuale} is not in the manual: citation not verified, confidence set to 0`));

  const risk = diagnosis === 'non_disponibile' ? null : await runSafety(id, diagnosis, alarm, pathMachines[0]!);
  decide(id, diagnosis, risk);
}

async function runSafety(id: string, diagnosis: Diagnosis, alarm: Alarm, rootMachine: { id: string; name: string; type: string; status: string }) {
  const inc = get(id)!;
  if (inc.llmCalls >= MAX_LLM_CALLS) return null;
  useStore.getState().patchIncident(id, (i) => ({ llmCalls: i.llmCalls + 1 }));
  const res = await enqueuePost<RiskAssessment>('/api/safety', {
    incidentId: id,
    scenarioId: inc.scenarioId,
    diagnosis,
    machine: rootMachine,
    impact: inc.impact,
    alarmValue: alarm.value,
    sensor: alarm.sensorId,
    replay: useStore.getState().replay,
  });
  if (res.ok) {
    if (res.meta) useStore.getState().logLlm(res.meta);
    const parsed = RiskAssessmentSchema.safeParse(res.data);
    if (parsed.success) {
      addLog(id, entry('llm', `${RISK_LABEL[parsed.data.livello_rischio]} risk from ${res.meta?.model ?? 'Gemma'}: ${parsed.data.motivazione}`));
      return parsed.data;
    }
  }
  addLog(id, entry('errore', `Risk assessment unavailable or invalid: treated as high risk${res.ok ? '' : ` (${res.error})`}`));
  return null; // ⇒ high in escalation and priority (Req 9.2, 9.7)
}

function decide(id: string, diagnosis: Diagnosis | 'non_disponibile', risk: RiskAssessment | null) {
  const st = useStore.getState();
  const factory = st.effectiveFactory();
  const inc = get(id)!;
  const decision = escalation(diagnosis, risk, factory.confidenceThreshold); // code has the final word
  const priority = priorityScore(inc.impact.costPerMin, risk?.livello_rischio ?? null);
  const root = factory.machines.find((m) => m.id === inc.causalPath[0])!;
  const action = diagnosis === 'non_disponibile' ? 'intervento_manutentivo' : diagnosis.codice_azione;
  const level = autonomyLevelFor(factory, root.type, action); // frozen for this incident (Req 10.9)
  const mode = autonomyMode(level, decision, action);

  st.patchIncident(id, {
    risk,
    escalation: decision,
    priority,
    autonomyLevel: level,
    autonomyMode: mode,
    // 'autonomo' is set only once the action actually runs (executeAction); otherwise a human acts.
    status: 'in_coda',
  });
  addLog(
    id,
    entry(
      'decisione',
      decision.escalate
        ? `Escalated to the manager: ${decision.reasons.map((r) => REASON_LABEL[r]).join(', ')}`
        : `No escalation required · autonomy level ${level}`,
    ),
  );
  if (!decision.escalate && mode === 'esegui_e_notifica') executeAction(id, 'Gestore_Autonomia');
}

const undoStack = new Map<string, () => void>();

/** Executes a whitelisted action (L2 after one click, L3 autonomously). Req 10.4, 10.5, 10.7. */
export function executeAction(id: string, author: 'Gestore_Autonomia' | 'Responsabile' | 'Tecnico') {
  const st = useStore.getState();
  const inc = get(id);
  if (!inc || inc.diagnosis === null || inc.diagnosis === 'non_disponibile') return;
  const action = inc.diagnosis.codice_azione;
  const target = inc.causalPath[0]!;
  try {
    if (action === 'riduci_velocita') {
      // Lower speed ⇒ lower thermal/mechanical load: the degradation stops progressing (avoids the trip).
      const prev = st.setDriftFactor(target, 0);
      undoStack.set(id, () => useStore.getState().setDriftFactor(target, prev));
    } else {
      undoStack.set(id, () => undefined);
    }
    st.patchIncident(id, { status: 'autonomo' });
    addLog(id, entry('azione', `Executed: ${ACTION_LABEL[action]} on ${target} (level ${inc.autonomyLevel}) · succeeded`, author));
    if (author === 'Gestore_Autonomia')
      st.notify({ kind: 'autonomia', incidentId: id, text: `${ACTION_LABEL[action]} on ${target} executed autonomously (${id}). You can undo it.` });
  } catch (err) {
    addLog(id, entry('errore', `Action failed: ${err instanceof Error ? err.message : String(err)}`, author));
    st.notify({ kind: 'errore', incidentId: id, text: `${ACTION_LABEL[action]} failed on ${target}` });
  }
}

/** Req 10.8: undo an autonomously executed action. */
export function undoAction(id: string) {
  const undo = undoStack.get(id);
  if (!undo) return;
  try {
    undo();
    undoStack.delete(id);
    useStore.getState().patchIncident(id, { status: 'in_coda' });
    addLog(id, entry('azione', 'Action undone by the manager, previous state restored', 'Responsabile'));
  } catch {
    addLog(id, entry('errore', 'Undo failed, state unchanged', 'Responsabile'));
  }
}

export function canUndo(id: string) {
  return undoStack.has(id);
}

/** Req 11.2: approval generates a work order. */
export function approve(id: string, assignee = 'Maintenance crew – shift A') {
  const inc = get(id);
  if (!inc) return;
  const d = inc.diagnosis && inc.diagnosis !== 'non_disponibile' ? inc.diagnosis : null;
  const wo: WorkOrder = {
    id: `WO-${id.slice(4)}`,
    machineId: inc.causalPath[0]!,
    cause: d?.causa_probabile ?? 'To be diagnosed (AI analysis unavailable)',
    action: d?.azione_raccomandata ?? 'Inspection by a technician',
    parts: d?.ricambi ?? [],
    priority: inc.risk?.livello_rischio ?? 'alto',
    assignee,
    manualPage: d?.citazione_verificata ? d.pagina_manuale : null,
    createdAt: now(),
  };
  useStore.getState().patchIncident(id, { status: 'approvato', workOrder: wo });
  addLog(id, entry('decisione', `Approved. Work order ${wo.id} created and assigned to ${assignee}`, 'Responsabile'));
  if (d && (d.codice_azione === 'riduci_velocita' || d.codice_azione === 'apri_ticket' || d.codice_azione === 'pianifica_ispezione') && inc.autonomyMode === 'approva_un_clic')
    executeAction(id, 'Responsabile');
}

/** Req 11.3, 11.5 */
export function reject(id: string, reason: string): string | null {
  const r = reason.trim();
  if (r.length < 1 || r.length > 500) return 'The reason must be 1 to 500 characters long';
  useStore.getState().patchIncident(id, { status: 'rifiutato' });
  addLog(id, entry('decisione', `Rejected: ${r}`, 'Responsabile'));
  return null;
}

/** Req 11.4, 11.6, 11.7, 15.1 */
export async function closeWorkOrder(id: string, input: { realCause: string; fix: string; durationMin: number }): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  if (!input.realCause.trim() || input.realCause.length > 500) errors.realCause = '1 to 500 characters';
  if (!input.fix.trim() || input.fix.length > 1000) errors.fix = '1 to 1000 characters';
  if (!Number.isInteger(input.durationMin) || input.durationMin < 1 || input.durationMin > 1440) errors.durationMin = 'Whole number from 1 to 1440';
  if (Object.keys(errors).length) return errors;
  const inc = get(id)!;
  const factory = useStore.getState().factory;
  const root = factory.machines.find((m) => m.id === inc.causalPath[0])!;
  const closedAt = now();
  const mem: MemoryEntry = {
    id: `int-${id}-${Date.now()}`,
    machineId: root.id,
    machineType: root.type,
    sensorIds: inc.causalPath[0] === inc.machineId ? inc.sensorIds : root.sensors.map((s) => s.id),
    realCause: input.realCause.trim(),
    fix: input.fix.trim(),
    durationMin: input.durationMin,
    closedAt,
    isSample: false,
  };
  try {
    const r = await saveMemory(mem);
    useStore.getState().patchIncident(id, (i) => ({
      status: 'chiuso',
      workOrder: i.workOrder ? { ...i.workOrder, closedAt } : i.workOrder,
    }));
    addLog(id, entry('decisione', `Intervention closed (${input.durationMin} min) and saved to memory${r.evolus ? ' (Evolus + local)' : ' (local)'}`, 'Tecnico'));
    // The repair removes the fault; a line stopped by it restarts.
    const wasStopped = !useStore.getState().line.running;
    useStore.getState().repairMachine(root.id);
    if (wasStopped && useStore.getState().line.running) addLog(id, entry('azione', `${root.id} repaired: line restarted`, 'Tecnico'));
    return {};
  } catch {
    return { _form: 'Could not save to memory, please retry' }; // Req 15.8
  }
}
