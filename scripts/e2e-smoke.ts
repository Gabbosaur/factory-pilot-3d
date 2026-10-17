/**
 * End-to-end smoke test against a running server (default http://localhost:3100).
 * Runs the real scenario A pipeline headlessly: simulator → engine → root cause → /api/diagnose → /api/safety → escalation.
 * With RECORD_MODE=1 on the server, the responses are recorded for replay.
 *   npx tsx scripts/e2e-smoke.ts [baseUrl] [faultId]
 */
import bottling from '../data/factories/bottling-line.json';
import { MANUALS } from '../data/manuals.generated';
import { parseConfigValue } from '../modules/monitoring/config/parser';
import { Simulator } from '../modules/monitoring/simulator/simulator';
import { AnomalyEngine } from '../modules/monitoring/anomaly/engine';
import { rootCause } from '../modules/incidents/rootCause';
import { computeImpact } from '../modules/incidents/impact';
import { escalation } from '../modules/incidents/escalation';
import { autonomyLevelFor, autonomyMode } from '../modules/incidents/autonomy';
import { parsePages, selectPages, verifyCitation } from '../modules/incidents/manual';
import { filterSimilar } from '../modules/incidents/memory/filter';
import seed from '../data/memory-seed.json';
import type { Alarm, MemoryEntry } from '../shared/types';

const base = process.argv[2] ?? 'http://localhost:3100';
const faultId = process.argv[3] ?? 'p1-bearing';

/** Same contract as the browser queue: re-send when the route answers { retryable, retryAfterMs }. */
async function post(path: string, body: unknown) {
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok && j.retryable && attempt < 3) {
      console.log(`  ${path} retryable (${j.error}), retry in ${j.retryAfterMs ?? 2000} ms`);
      await new Promise((res) => setTimeout(res, j.retryAfterMs ?? 2000));
      continue;
    }
    return { status: r.status, ms: Date.now() - t0, body: j };
  }
}

async function main() {
  const health = await (await fetch(base + '/api/health')).json();
  console.log('health', JSON.stringify(health));

  const pc = parseConfigValue(bottling);
  if (!pc.ok) throw new Error('config');
  const cfg = pc.config;
  const sim = new Simulator(cfg, 42, Date.now() - 200_000);
  const eng = new AnomalyEngine(cfg);
  for (let t = 0; t < 70; t++) eng.ingest(sim.step());
  sim.inject(faultId);
  const fault = cfg.faults.find((f) => f.id === faultId)!;
  // Wait until the downstream symptom alarms (cascade) or the faulty machine itself (local).
  const target = fault.kind === 'cascata' ? cfg.machines.find((m) => m.id === fault.machineId)!.downstream[0]! : fault.machineId;
  let alarm: Alarm | undefined;
  for (let t = 0; t < 120 && !alarm; t++) alarm = eng.ingest(sim.step()).alarms.find((a) => a.machineId === target);
  if (!alarm) throw new Error('no alarm');
  const statuses = eng.getAllStatuses();
  const rc = rootCause(cfg, statuses, eng.getAnomalyStarts(), alarm.machineId);
  const impact = computeImpact(cfg, rc.path, alarm.machineId);
  console.log('alarm', alarm.machineId, alarm.sensorId, alarm.value, '| path', rc.path.join('→'), '| €/min', impact.costPerMin);

  const byId = new Map(cfg.machines.map((m) => [m.id, m]));
  const root = byId.get(rc.rootCause)!;
  const am = byId.get(alarm.machineId)!;
  const sensor = am.sensors.find((s) => s.id === alarm!.sensorId)!;
  const pr = parsePages(MANUALS[root.manualRef]!);
  if (!pr.ok) throw new Error(pr.error);
  const pages = selectPages(pr.pages, root.sensors.map((s) => s.name));
  const similar = filterSimilar(seed as MemoryEntry[], { machineId: root.id, machineType: root.type, sensorIds: root.sensors.map((s) => s.id) });
  const pathMachines = rc.path.map((id) => ({ id, name: byId.get(id)!.name, type: byId.get(id)!.type, status: statuses[id] ?? 'verde' }));

  const d = await post('/api/diagnose', {
    incidentId: 'SMOKE-1',
    scenarioId: faultId,
    alarm,
    alarmMachine: pathMachines.at(-1),
    causalPath: pathMachines,
    sensorName: sensor.name,
    sensorUnit: sensor.unit,
    manualPages: pages,
    similar,
  });
  console.log('diagnose', d.status, `${d.ms}ms`, JSON.stringify(d.body).slice(0, 900));
  if (!d.body.ok) process.exit(1);
  const diag = verifyCitation(d.body.data, pr.pages);

  const s = await post('/api/safety', {
    incidentId: 'SMOKE-1',
    scenarioId: faultId,
    diagnosis: diag,
    machine: pathMachines[0],
    impact,
    alarmValue: alarm.value,
    sensor: alarm.sensorId,
  });
  console.log('safety', s.status, `${s.ms}ms`, JSON.stringify(s.body).slice(0, 500));
  const risk = s.body.ok ? s.body.data : null;
  const dec = escalation(diag, risk, cfg.confidenceThreshold);
  const level = autonomyLevelFor(cfg, root.type, diag.codice_azione);
  console.log('citation verified', diag.citazione_verificata, '| escalation', JSON.stringify(dec), '| autonomy', level, autonomyMode(level, dec, diag.codice_azione));
}

main().catch((e) => {
  console.error('SMOKE FAILED', e);
  process.exit(1);
});
