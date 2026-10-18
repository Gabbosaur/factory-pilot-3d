'use client';
/**
 * Flusso_Eventi: a single Zustand store shared by Monitoring (A) and Incidents (B).
 * The simulation loop lives here (browser), ticking once per second.
 */
import { create } from 'zustand';
import bottling from '@/data/factories/bottling-line.json';
import twin from '@/data/factories/bottling-line-twin.json';
import juice from '@/data/factories/juice-line.json';
import { parseConfigValue } from '@/modules/monitoring/config/parser';
import { Simulator } from '@/modules/monitoring/simulator/simulator';
import { AnomalyEngine } from '@/modules/monitoring/anomaly/engine';
import { initProduction, kpis, REDUCED_SPEED, stepProduction, type ProductionState } from '@/modules/monitoring/production/production';
import { buildPlant, capacityFactor, plantModel, siblingsOf, type PlantModel } from '@/modules/plant/plant';
import { isQualitySensor, stepHolds, type HoldSample, type QualityHold } from '@/modules/quality/holds';
import type { Alarm, FactoryConfig, Incident, LlmCallMeta, MachineStatus, Sample } from '@/shared/types';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error(`Invalid configuration: ${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  return r.config;
}

/**
 * Plants (the global filter of the app). Built-in: one plant with two bottling lines simulated together;
 * lines live inside the plant. Factories created with onboarding are added as single-line plants.
 */
export const BUILTIN_FACTORIES: FactoryConfig[] = [
  buildPlant('milan-plant', 'Genova plant – 2 water lines', [load(bottling), load(twin)]),
  buildPlant('imperia-plant', 'Imperia plant – juice line', [load(juice)]),
];
/** Kept for backwards compatibility; prefer useStore(s => s.factories). */
export const FACTORIES = BUILTIN_FACTORIES;

const CUSTOM_KEY = 'fp.factories.custom';
function readCustomFactories(): FactoryConfig[] {
  if (typeof window === 'undefined') return [];
  try {
    return (JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as unknown[]).flatMap((v) => {
      const r = parseConfigValue(v);
      return r.ok ? [r.config] : [];
    });
  } catch {
    return [];
  }
}

export const HISTORY = 60;

/** Protective trip of a serial line (red = absolute limit exceeded ⇒ that line stops; other lines keep running). */
export interface LineState {
  running: boolean;
  trippedBy: { machineId: string; sensorId: string; value: number; threshold: number } | null;
  /** Seconds stopped in the current stop and since the last reset. */
  stopSec: number;
  totalDowntimeSec: number;
}

const LINE_RUNNING: LineState = { running: true, trippedBy: null, stopSec: 0, totalDowntimeSec: 0 };

/** One protective stop, for the downtime Pareto. */
export interface StopRecord {
  lineId: string;
  machineId: string;
  sensorId: string;
  startTick: number;
  endTick: number | null;
}

/** A machine taken out of the flow because a redundant twin can take over (the line keeps running). */
export interface Bypass {
  lineId: string;
  sibling: string;
  sensorId: string;
  value: number;
  threshold: number;
  tick: number;
}

/** Shift trend sample (every TREND_EVERY seconds). */
export interface TrendPoint {
  tick: number;
  lines: Record<string, { oee: number; good: number }>;
}

const TREND_EVERY = 30;

/** Machines whose samples the anomaly engine ignores: stopped lines and bypassed machines. */
function stoppedIds(plant: PlantModel, lines: Record<string, LineState>, bypassed: Record<string, Bypass>): string[] {
  return [...new Set([...plant.lines.filter((l) => !lines[l.id]?.running).flatMap((l) => l.machineIds), ...Object.keys(bypassed)])];
}

function perLine<T>(plant: PlantModel, make: () => T): Record<string, T> {
  return Object.fromEntries(plant.lines.map((l) => [l.id, make()]));
}

/** Line state of the line a machine belongs to. */
export function lineStateOf(s: { plant: PlantModel; lines: Record<string, LineState> }, machineId: string): LineState {
  return s.lines[s.plant.lineOf[machineId] ?? ''] ?? LINE_RUNNING;
}

export interface Notification {
  id: string;
  ts: number;
  kind: 'info' | 'autonomia' | 'errore';
  text: string;
  incidentId?: string;
}

interface State {
  factories: FactoryConfig[];
  factory: FactoryConfig;
  running: boolean;
  seed: number;
  tick: number;
  statuses: Record<string, MachineStatus>;
  anomalyStart: Record<string, number>;
  /** machineId -> sensorId -> last samples */
  history: Record<string, Record<string, Sample[]>>;
  incidents: Record<string, Incident>;
  selectedMachine: string | null;
  selectedIncident: string | null;
  replay: boolean;
  aiReachable: boolean;
  memorySource: 'evolus' | 'locale' | null;
  notifications: Notification[];
  llmLog: LlmCallMeta[];
  activeFaultIds: string[];
  /** Faults injected but not yet alarmed (drives the "building up" badge). */
  arming: Array<{ faultId: string; label: string; machineId: string; at: number }>;
  lastError: string | null;
  autonomyOverrides: Record<string, FactoryConfig['autonomy']>;
  plant: PlantModel;
  lines: Record<string, LineState>;
  productions: Record<string, ProductionState>;
  stops: StopRecord[];
  /** machineId -> automatic bypass to its redundant twin. */
  bypassed: Record<string, Bypass>;
  /** Lots of suspect bottles produced while a product quality signal was abnormal. */
  holds: QualityHold[];
  trend: TrendPoint[];
  /** Speed factor per machine (riduci_velocita lowers it); the serial line runs at the slowest one. */
  speed: Record<string, number>;
}

interface Actions {
  setFactory(id: string): void;
  addFactory(f: FactoryConfig): void;
  setRunning(running: boolean): void;
  injectFault(faultId: string): void;
  clearArming(machineId: string): void;
  resetSim(): void;
  selectMachine(id: string | null): void;
  selectIncident(id: string | null): void;
  setReplay(on: boolean): void;
  upsertIncident(inc: Incident): void;
  patchIncident(id: string, patch: Partial<Incident> | ((i: Incident) => Partial<Incident>)): void;
  notify(n: Omit<Notification, 'id' | 'ts'>): void;
  dismiss(id: string): void;
  logLlm(meta: LlmCallMeta): void;
  setAiReachable(ok: boolean): void;
  setMemorySource(s: 'evolus' | 'locale'): void;
  setError(e: string | null): void;
  setDriftFactor(machineId: string, factor: number): number;
  /** Restart a line after a protective trip (all stopped lines when omitted); it trips again if the fault is still there. */
  restartLine(lineId?: string): void;
  /** Repair completed on a machine: remove its fault and restart the line if it was the cause of the stop. */
  repairMachine(machineId: string): void;
  /** Quality decision on a quarantined lot: released after inspection, or scrapped (counted as rejects). */
  decideHold(id: string, decision: 'released' | 'scrapped'): void;
  /** A sample bottle of a quarantined lot inspected from a photo. */
  addHoldSample(id: string, sample: HoldSample): void;
  setAutonomy(machineType: string, action: string, level: string): void;
  effectiveFactory(): FactoryConfig;
  onAlarms(cb: (alarms: Alarm[]) => void): () => void;
  hydrate(): void;
}

// Engine objects are mutable and not part of React state.
let sim: Simulator | null = null;
let engine: AnomalyEngine | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
const alarmListeners = new Set<(a: Alarm[]) => void>();

function initEngines(f: FactoryConfig, seed: number) {
  sim = new Simulator(f, seed, Date.now());
  engine = new AnomalyEngine(f);
}

function emptyHistory(f: FactoryConfig): State['history'] {
  return Object.fromEntries(f.machines.map((m) => [m.id, Object.fromEntries(m.sensors.map((s) => [s.id, [] as Sample[]]))]));
}

function readAutonomyOverrides(): State['autonomyOverrides'] {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem('fp.autonomy') ?? '{}');
  } catch {
    return {};
  }
}

export const useStore = create<State & Actions>((set, get) => {
  const factory = BUILTIN_FACTORIES[0]!;
  const seed = 42;
  initEngines(factory, seed);

  const doTick = () => {
    if (!sim || !engine) return;
    const samples = sim.step();
    const ev = engine.ingest(samples);
    const { history, statuses } = get();
    const nextHistory: State['history'] = {};
    for (const [mid, sensors] of Object.entries(history)) {
      nextHistory[mid] = {};
      for (const [sid, arr] of Object.entries(sensors)) nextHistory[mid]![sid] = arr;
    }
    for (const s of samples) {
      const arr = nextHistory[s.machineId]?.[s.sensorId];
      if (!arr) continue;
      const copy = arr.length >= HISTORY ? arr.slice(arr.length - HISTORY + 1) : arr.slice();
      copy.push(s);
      nextHistory[s.machineId]![s.sensorId] = copy;
    }
    const nextStatuses = ev.statusChanges.length ? { ...statuses } : statuses;
    for (const ch of ev.statusChanges) nextStatuses[ch.machineId] = ch.status;

    // Protective trip: the first absolute-limit (red) alarm of a line stops that whole serial line.
    // Shown by the app-wide LineBanner (no toast: it would duplicate it and cover its Restart button).
    const { plant, speed } = get();
    const lines = { ...get().lines };
    const productions = { ...get().productions };
    let stops = get().stops;
    const values: Record<string, number> = {};
    for (const smp of samples) values[`${smp.machineId}|${smp.sensorId}`] = smp.value;
    const bypassed = { ...get().bypassed };
    const newBypasses: string[] = [];
    let holds = get().holds;
    const openedHolds: QualityHold[] = [];
    for (const pl of plant.lines) {
      let ls = lines[pl.id] ?? LINE_RUNNING;
      const reds = ls.running ? ev.alarms.filter((a) => a.severity === 'rosso' && plant.lineOf[a.machineId] === pl.id && !bypassed[a.machineId]) : [];
      // Redundancy first: a machine with a healthy twin in parallel is bypassed instead of stopping the line.
      for (const a of reds) {
        const sibling = siblingsOf(pl.config, a.machineId).find((id) => !bypassed[id] && nextStatuses[id] !== 'rosso');
        if (!sibling) continue;
        sim.setLineRunning(false, [a.machineId]);
        bypassed[a.machineId] = { lineId: pl.id, sibling, sensorId: a.sensorId, value: a.value, threshold: a.threshold, tick: sim.tick };
        newBypasses.push(a.machineId);
      }
      const trip = reds.find((a) => !bypassed[a.machineId]);
      if (trip) {
        sim.setLineRunning(false, pl.machineIds);
        ls = { ...ls, running: false, stopSec: 0, trippedBy: { machineId: trip.machineId, sensorId: trip.sensorId, value: trip.value, threshold: trip.threshold } };
        stops = [...stops, { lineId: pl.id, machineId: trip.machineId, sensorId: trip.sensorId, startTick: sim.tick, endTick: null }];
      } else if (!ls.running) {
        ls = { ...ls, stopSec: ls.stopSec + 1, totalDowntimeSec: ls.totalDowntimeSec + 1 };
      }
      lines[pl.id] = ls;
      const lineBypassed = new Set(pl.machineIds.filter((id) => bypassed[id]));
      const lineSpeed = Math.min(1, capacityFactor(pl.config, lineBypassed), ...pl.machineIds.map((id) => speed[id] ?? 1));
      const prevGood = productions[pl.id]?.good ?? 0;
      productions[pl.id] = stepProduction(productions[pl.id] ?? initProduction(), pl.config, { lineRunning: ls.running, speed: lineSpeed, values });
      // Quality hold: good bottles made while a product characteristic of the line is abnormal are suspect.
      const q = ev.alarms.find((a) => plant.lineOf[a.machineId] === pl.id && isQualitySensor(a.sensorId) && !bypassed[a.machineId]);
      const hs = stepHolds(holds, {
        lineId: pl.id,
        tick: sim.tick,
        lineRunning: ls.running,
        goodNow: productions[pl.id]!.good - prevGood,
        signal: q ? { machineId: q.machineId, sensorId: q.sensorId } : null,
      });
      holds = hs.holds;
      if (hs.opened) openedHolds.push(hs.opened);
    }
    engine.setStopped(stoppedIds(plant, lines, bypassed));
    const trend =
      sim.tick % TREND_EVERY === 0
        ? [
            ...get().trend,
            {
              tick: sim.tick,
              lines: Object.fromEntries(plant.lines.map((l) => [l.id, { oee: kpis(productions[l.id]!, l.config).oee, good: productions[l.id]!.good }])),
            },
          ].slice(-480)
        : get().trend;

    set({
      lines,
      productions,
      stops,
      bypassed,
      holds,
      trend,
      tick: sim.tick,
      history: nextHistory,
      statuses: nextStatuses,
      anomalyStart: ev.statusChanges.length ? engine.getAnomalyStarts() : get().anomalyStart,
      activeFaultIds: sim.activeFaults.map((f) => f.id),
    });
    // Log the automatic bypass on the machine's incident and tell the operator.
    for (const id of newBypasses) {
      const b = bypassed[id]!;
      const pct = Math.round(capacityFactor(plant.lines.find((l) => l.id === b.lineId)!.config, new Set(Object.keys(bypassed).filter((k) => bypassed[k]!.lineId === b.lineId))) * 100);
      const text = `${id} bypassed: flow rerouted to ${b.sibling}, ${b.lineId} keeps running at ${pct}% capacity`;
      const inc = Object.values(get().incidents).find((i) => (i.machineId === id || i.causalPath[0] === id) && i.status !== 'chiuso' && i.status !== 'rifiutato');
      if (inc)
        get().patchIncident(inc.id, (i) => ({ log: [...i.log, { ts: new Date().toISOString(), kind: 'azione', message: `Automatic reroute (code rule): ${text}`, author: 'Gestore_Autonomia' }] }));
      get().notify({ kind: 'autonomia', text, incidentId: inc?.id });
    }
    for (const h of openedHolds) {
      const m = get().factory.machines.find((x) => x.id === h.machineId);
      const sensor = m?.sensors.find((x) => x.id === h.sensorId);
      get().notify({ kind: 'info', text: `Quality hold ${h.id}: bottles from ${h.lineId} are quarantined while ${h.machineId} ${sensor?.name.toLowerCase() ?? h.sensorId} is abnormal` });
    }
    if (ev.rejected.length) console.warn('[engine] campioni scartati', ev.rejected.slice(0, 3));
    if (ev.alarms.length) for (const l of alarmListeners) l(ev.alarms);
  };

  return {
    factories: BUILTIN_FACTORIES,
    factory,
    running: false,
    seed,
    tick: 0,
    statuses: engine!.getAllStatuses(),
    anomalyStart: {},
    history: emptyHistory(factory),
    incidents: {},
    selectedMachine: null,
    selectedIncident: null,
    replay: false,
    aiReachable: true,
    memorySource: null,
    notifications: [],
    llmLog: [],
    activeFaultIds: [],
    arming: [],
    lastError: null,
    autonomyOverrides: {},
    plant: plantModel(factory),
    lines: perLine(plantModel(factory), () => LINE_RUNNING),
    productions: perLine(plantModel(factory), initProduction),
    stops: [],
    bypassed: {},
    holds: [],
    trend: [],
    speed: {},

    addFactory(f) {
      const custom = [...readCustomFactories().filter((x) => x.id !== f.id), f];
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
      set({ factories: [...BUILTIN_FACTORIES, ...custom.filter((c) => !BUILTIN_FACTORIES.some((b) => b.id === c.id))] });
      get().setFactory(f.id);
    },
    setFactory(id) {
      const f = get().factories.find((x) => x.id === id);
      if (!f) return;
      initEngines(f, get().seed);
      const plant = plantModel(f);
      set({
        factory: f,
        plant,
        tick: 0,
        statuses: engine!.getAllStatuses(),
        anomalyStart: {},
        history: emptyHistory(f),
        incidents: {},
        selectedMachine: null,
        selectedIncident: null,
        activeFaultIds: [],
        arming: [],
        lines: perLine(plant, () => LINE_RUNNING),
        productions: perLine(plant, initProduction),
        stops: [],
        bypassed: {},
        holds: [],
        trend: [],
        speed: {},
      });
    },
    setRunning(running) {
      if (running && !interval) {
        // Drift-corrected loop: catches up if the tab was throttled in background (Req 4.5).
        let next = performance.now() + 1000;
        interval = setInterval(() => {
          let n = 0;
          while (performance.now() >= next && n < 30) {
            doTick();
            next += 1000;
            n++;
          }
        }, 250);
      }
      if (!running && interval) {
        clearInterval(interval);
        interval = null;
      }
      set({ running });
    },
    injectFault(faultId) {
      const r = sim?.inject(faultId);
      if (r && !r.ok) set({ lastError: r.reason });
      else {
        const fault = get().factory.faults.find((f) => f.id === faultId);
        set({
          activeFaultIds: sim?.activeFaults.map((f) => f.id) ?? [],
          lastError: null,
          // Show a "building up" badge until this machine raises its first alarm.
          arming: fault ? [...get().arming.filter((a) => a.machineId !== fault.machineId), { faultId, label: fault.label, machineId: fault.machineId, at: Date.now() }] : get().arming,
        });
        // Safety net: never let the badge linger if the alarm never fires.
        if (fault) setTimeout(() => get().clearArming(fault.machineId), 60_000);
      }
    },
    resetSim() {
      const before = get();
      const faulty = new Set([...before.arming.map((x) => x.machineId), ...Object.keys(before.bypassed), ...Object.entries(before.statuses).filter(([, v]) => v !== 'verde').map(([k]) => k)]);
      const stoppedLines = Object.values(before.lines).filter((l) => !l.running).length;
      const openIncidents = Object.values(before.incidents).filter((i) => i.status !== 'chiuso' && i.status !== 'rifiutato');
      sim?.reset();
      sim?.setLineRunning(true);
      // A fresh detector: machines turn green at once instead of waiting for the statistics to settle.
      engine = new AnomalyEngine(before.effectiveFactory());
      // Counters keep running (same shift); speed reductions are undone with the faults.
      const t = sim?.tick ?? 0;
      const now = new Date().toISOString();
      set((st) => ({
        statuses: engine!.getAllStatuses(),
        anomalyStart: {},
        incidents: Object.fromEntries(Object.entries(st.incidents).map(([id, i]) => [id, openIncidents.some((o) => o.id === id) ? { ...i, status: 'chiuso' as const, log: [...i.log, { ts: now, kind: 'decisione' as const, message: 'Closed by Simulate solved (demo reset, no repair report)', author: 'Sistema' as const }] } : i])),
        activeFaultIds: [],
        arming: [],
        lines: Object.fromEntries(Object.entries(st.lines).map(([id, l]) => [id, { ...l, running: true, trippedBy: null, stopSec: 0 }])),
        stops: st.stops.map((x) => (x.endTick === null ? { ...x, endTick: t } : x)),
        bypassed: {},
        speed: {},
      }));
      const parts = [
        faulty.size ? `${faulty.size} machine${faulty.size === 1 ? '' : 's'} back to normal` : '',
        stoppedLines ? `${stoppedLines} line${stoppedLines === 1 ? '' : 's'} restarted` : '',
        openIncidents.length ? `${openIncidents.length} incident${openIncidents.length === 1 ? '' : 's'} closed` : '',
      ].filter(Boolean);
      get().notify({ kind: 'autonomia', text: parts.length ? `✓ Faults solved: ${parts.join(', ')}.` : '✓ Nothing to solve: every machine is already healthy.' });
    },
    clearArming(machineId) {
      const next = get().arming.filter((a) => a.machineId !== machineId);
      if (next.length !== get().arming.length) set({ arming: next });
    },
    restartLine(lineId) {
      const { plant } = get();
      const targets = plant.lines.filter((l) => (lineId ? l.id === lineId : true) && get().lines[l.id] && !get().lines[l.id]!.running);
      if (!targets.length) return;
      const t = sim?.tick ?? 0;
      for (const l of targets) sim?.setLineRunning(true, l.machineIds.filter((id) => !get().bypassed[id]));
      set((st) => {
        const lines = { ...st.lines };
        for (const l of targets) lines[l.id] = { ...lines[l.id]!, running: true, trippedBy: null, stopSec: 0 };
        const ids = new Set(targets.map((l) => l.id));
        return { lines, stops: st.stops.map((x) => (x.endTick === null && ids.has(x.lineId) ? { ...x, endTick: t } : x)) };
      });
      engine?.setStopped(stoppedIds(plant, get().lines, get().bypassed));
    },
    repairMachine(machineId) {
      sim?.clearFault(machineId);
      set({ activeFaultIds: sim?.activeFaults.map((f) => f.id) ?? [] });
      // A repaired bypassed machine goes back into the flow.
      if (get().bypassed[machineId]) {
        const { [machineId]: _done, ...rest } = get().bypassed;
        set({ bypassed: rest });
        if (lineStateOf(get(), machineId).running) sim?.setLineRunning(true, [machineId]);
        engine?.setStopped(stoppedIds(get().plant, get().lines, rest));
      }
      // Restart the machine's line once nothing degrades the machine that tripped it (directly or through a cascade).
      const lineId = get().plant.lineOf[machineId];
      const tripped = lineId ? get().lines[lineId]?.trippedBy?.machineId : undefined;
      if (lineId && tripped && !sim?.affectedMachines().includes(tripped)) get().restartLine(lineId);
    },
    addHoldSample(id, sample) {
      set((st) => ({ holds: st.holds.map((h) => (h.id === id ? { ...h, samples: [...(h.samples ?? []), sample] } : h)) }));
    },
    decideHold(id, decision) {
      const h = get().holds.find((x) => x.id === id);
      if (!h || h.status !== 'quarantined') return;
      const holds = get().holds.map((x) => (x.id === id ? { ...x, status: decision } : x));
      if (decision === 'released') return set({ holds });
      // Scrapped lot: those bottles are no longer good output (FPY and OEE quality drop).
      const p = get().productions[h.lineId];
      if (!p) return set({ holds });
      const n = Math.min(h.suspect, p.good);
      set({
        holds,
        productions: { ...get().productions, [h.lineId]: { ...p, good: p.good - n, rejects: { ...p.rejects, 'quality-hold': (p.rejects['quality-hold'] ?? 0) + n } } },
      });
    },
    selectMachine(id) {
      set({ selectedMachine: id });
    },
    selectIncident(id) {
      set({ selectedIncident: id });
    },
    setReplay(on) {
      set({ replay: on });
    },
    upsertIncident(inc) {
      set((s) => ({ incidents: { ...s.incidents, [inc.id]: inc } }));
    },
    patchIncident(id, patch) {
      set((s) => {
        const cur = s.incidents[id];
        if (!cur) return s;
        const p = typeof patch === 'function' ? patch(cur) : patch;
        return { incidents: { ...s.incidents, [id]: { ...cur, ...p } } };
      });
    },
    notify(n) {
      const note = { ...n, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() };
      set((s) => ({ notifications: [note, ...s.notifications].slice(0, 8) }));
    },
    dismiss(id) {
      set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
    },
    logLlm(meta) {
      set((s) => ({ llmLog: [...s.llmLog, meta].slice(-200) }));
    },
    setAiReachable(ok) {
      if (get().aiReachable !== ok) set({ aiReachable: ok });
    },
    setMemorySource(src) {
      set({ memorySource: src });
    },
    setError(e) {
      set({ lastError: e });
    },
    setDriftFactor(machineId, factor) {
      // Drift factor < 1 comes from riduci_velocita: the machine (and so the line) runs slower.
      const speed = { ...get().speed };
      if (factor < 1) speed[machineId] = REDUCED_SPEED;
      else delete speed[machineId];
      set({ speed });
      return sim?.setDriftFactor(machineId, factor) ?? 1;
    },
    setAutonomy(machineType, action, level) {
      const f = get().factory;
      const all = { ...get().autonomyOverrides };
      const cur = { ...(all[f.id] ?? f.autonomy) };
      cur[machineType] = { ...(cur[machineType] ?? {}), [action]: level };
      all[f.id] = cur;
      localStorage.setItem('fp.autonomy', JSON.stringify(all));
      set({ autonomyOverrides: all });
    },
    effectiveFactory() {
      const { factory, autonomyOverrides } = get();
      const ov = autonomyOverrides[factory.id];
      return ov ? { ...factory, autonomy: ov } : factory;
    },
    onAlarms(cb) {
      alarmListeners.add(cb);
      return () => alarmListeners.delete(cb);
    },
    /** Client-only: load persisted autonomy levels after mount (avoids SSR/localStorage mismatch). */
    hydrate() {
      const custom = readCustomFactories().filter((c) => !BUILTIN_FACTORIES.some((b) => b.id === c.id));
      set({ autonomyOverrides: readAutonomyOverrides(), factories: [...BUILTIN_FACTORIES, ...custom] });
    },
  };
});
