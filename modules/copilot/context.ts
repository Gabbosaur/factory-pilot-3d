/**
 * Compact JSON snapshot of the live plant for "Ask FactoryPilot": what an engineer would look at
 * (KPIs, lines, clusters, incidents, quality holds, Paretos; sensors for a machine). Pure.
 */
import type { Incident, MachineStatus, MemoryEntry, Sample } from '@/shared/types';
import type { ProductionState } from '@/modules/monitoring/production/production';
import { kpis } from '@/modules/monitoring/production/production';
import { condition, cpk, outOfSpecPct, stats } from '@/modules/monitoring/quality/spc';
import { bottleneck, clusterMetrics, downtimePareto, plantKpis, rejectPareto } from '@/modules/plant/metrics';
import { capacityFactor, type PlantModel } from '@/modules/plant/plant';
import type { FactoryConfig } from '@/shared/types';
import type { QualityHold } from '@/modules/quality/holds';

export interface ContextInput {
  factory: FactoryConfig;
  plant: PlantModel;
  tick: number;
  statuses: Record<string, MachineStatus>;
  speed: Record<string, number>;
  lines: Record<string, { running: boolean; trippedBy: { machineId: string; sensorId: string; value: number; threshold: number } | null; stopSec: number }>;
  productions: Record<string, ProductionState>;
  stops: Array<{ lineId: string; machineId: string; sensorId: string; startTick: number; endTick: number | null }>;
  bypassed: Record<string, { lineId: string; sibling: string; sensorId: string }>;
  holds: QualityHold[];
  incidents: Record<string, Incident>;
  history: Record<string, Record<string, Sample[]>>;
}

const r = (x: number, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const pct = (x: number) => r(x * 100, 1);

function incidentSummary(i: Incident) {
  const d = i.diagnosis && i.diagnosis !== 'non_disponibile' ? i.diagnosis : null;
  return {
    id: i.id,
    machine: i.machineId,
    status: i.status,
    causalPath: i.causalPath,
    cause: d?.causa_probabile ?? (i.diagnosis === 'non_disponibile' ? 'AI diagnosis unavailable' : 'analysing'),
    confidence: d ? r(d.confidenza) : null,
    action: d?.azione_raccomandata ?? null,
    manualPage: d?.pagina_manuale ?? null,
    risk: i.risk?.livello_rischio ?? null,
    escalated: i.escalation?.escalate ?? null,
    escalationReasons: i.escalation?.reasons ?? [],
    costPerMinEur: i.impact.costPerMin,
  };
}

export function buildContext(s: ContextInput, machineId?: string, memory: MemoryEntry[] = []) {
  const pk = plantKpis(s.plant, s.productions);
  const bypassedIds = new Set(Object.keys(s.bypassed));
  const lines = s.plant.lines.map((l) => {
    const p = s.productions[l.id];
    const k = p ? kpis(p, l.config) : null;
    const ls = s.lines[l.id];
    const cms = clusterMetrics(l, p, s.statuses, s.speed, ls?.running ?? true, bypassedIds);
    const neck = bottleneck(cms);
    return {
      id: l.id,
      name: l.name,
      state: !ls?.running ? `stopped by protective trip on ${ls?.trippedBy?.machineId} (${ls?.trippedBy?.sensorId} ${ls?.trippedBy?.value} > ${ls?.trippedBy?.threshold}) for ${ls?.stopSec}s` : 'running',
      capacityPct: pct(capacityFactor(l.config, new Set(l.machineIds.filter((id) => bypassedIds.has(id))))),
      oeePct: k ? pct(k.oee) : null,
      availabilityPct: k ? pct(k.availability) : null,
      performancePct: k ? pct(k.performance) : null,
      qualityPct: k ? pct(k.quality) : null,
      throughputPerHour: k ? Math.round(k.throughputPerHour) : null,
      targetPerHour: k ? Math.round(k.targetPerHour) : null,
      goodBottles: p ? Math.round(p.good) : 0,
      downtimeSec: p ? p.plannedSec - p.runSec : 0,
      bottleneck: neck?.cluster.name ?? null,
      clusters: cms.map((c) => ({ name: c.cluster.name, machines: c.cluster.machineIds, worstStatus: c.worst, capacityPerHour: Math.round(c.capacityPerHour), rejectPct: r(c.rejectPct) })),
      machines: l.machineIds.map((id) => ({ id, status: s.statuses[id] ?? 'verde', speedPct: pct(s.speed[id] ?? 1), bypassedTo: s.bypassed[id]?.sibling ?? null })),
    };
  });

  const ctx: Record<string, unknown> = {
    plant: s.factory.name,
    shiftSec: Math.max(0, ...s.plant.lines.map((l) => s.productions[l.id]?.plannedSec ?? 0)),
    statusLegend: { verde: 'OK', giallo: 'warning (statistical early warning)', rosso: 'alarm (absolute limit)' },
    kpis: {
      oeePct: pct(pk.oee),
      availabilityPct: pct(pk.availability),
      performancePct: pct(pk.performance),
      fpyPct: pct(pk.quality),
      goodBottles: Math.round(pk.good),
      rejects: Math.round(pk.rejected),
      throughputPerHour: Math.round(pk.throughputPerHour),
      targetPerHour: Math.round(pk.targetPerHour),
    },
    lines,
    openIncidents: Object.values(s.incidents)
      .filter((i) => i.status !== 'chiuso' && i.status !== 'rifiutato')
      .map(incidentSummary),
    qualityHolds: s.holds.map((h) => ({ lot: h.id, line: h.lineId, trigger: `${h.machineId} ${h.sensorId}`, suspectBottles: Math.round(h.suspect), status: h.status })),
    downtimePareto: downtimePareto(s.stops, s.tick, s.factory).slice(0, 5).map((p) => ({ cause: p.label, seconds: p.value })),
    rejectPareto: rejectPareto(s.plant, s.productions, s.factory).slice(0, 5).map((p) => ({ station: p.label, bottles: Math.round(p.value) })),
  };

  if (machineId) {
    const m = s.factory.machines.find((x) => x.id === machineId);
    if (m) {
      ctx.machine = {
        id: m.id,
        name: m.name,
        type: m.type,
        line: s.plant.lineOf[m.id],
        status: s.statuses[m.id] ?? 'verde',
        nominalRatePerHour: m.partsPerMin * 60,
        downtimeCostPerMinEur: m.downtimeCostPerMin,
        bypassedTo: s.bypassed[m.id]?.sibling ?? null,
        sensors: m.sensors.map((sen) => {
          const values = (s.history[m.id]?.[sen.id] ?? []).map((x) => x.value);
          const st = stats(values);
          const c = condition(values, sen);
          return {
            id: sen.id,
            name: sen.name,
            unit: sen.unit,
            last: r(values.at(-1) ?? NaN),
            mean60s: r(st.mean),
            nominal: sen.nominal,
            warn: sen.warn,
            trip: sen.crit,
            zone: c?.zone ?? null,
            trendPerMin: c ? r(c.slopePerMin, 3) : null,
            minutesToTrip: c?.minutesToTrip != null && c.minutesToTrip < 120 ? r(c.minutesToTrip, 1) : null,
            ...(sen.spec ? { spec: sen.spec, cpk: r(cpk(values, sen) ?? NaN), outOfSpecPct: r(outOfSpecPct(values, sen) ?? NaN, 1) } : {}),
          };
        }),
        incidents: Object.values(s.incidents)
          .filter((i) => i.machineId === m.id || i.causalPath[0] === m.id)
          .map(incidentSummary),
        maintenanceHistory: memory.filter((e) => e.machineId === m.id).map((e) => ({ date: e.closedAt.slice(0, 10), cause: e.realCause, fix: e.fix, durationMin: e.durationMin })),
      };
    }
  }
  return ctx;
}
