'use client';
/**
 * Flusso_Eventi: a single Zustand store shared by Monitoring (A) and Incidents (B).
 * The simulation loop lives here (browser), ticking once per second.
 */
import { create } from 'zustand';
import bottling from '@/data/factories/bottling-line.json';
import twin from '@/data/factories/bottling-line-twin.json';
import { parseConfigValue } from '@/modules/monitoring/config/parser';
import { Simulator } from '@/modules/monitoring/simulator/simulator';
import { AnomalyEngine } from '@/modules/monitoring/anomaly/engine';
import type { Alarm, FactoryConfig, Incident, LlmCallMeta, MachineStatus, Sample } from '@/shared/types';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error(`Invalid configuration: ${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  return r.config;
}

export const BUILTIN_FACTORIES: FactoryConfig[] = [load(bottling), load(twin)];
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

/** Protective trip of the serial line (red = absolute limit exceeded ⇒ everything stops). */
export interface LineState {
  running: boolean;
  trippedBy: { machineId: string; sensorId: string; value: number; threshold: number } | null;
  /** Seconds stopped in the current stop and since the last reset. */
  stopSec: number;
  totalDowntimeSec: number;
}

const LINE_RUNNING: LineState = { running: true, trippedBy: null, stopSec: 0, totalDowntimeSec: 0 };

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
  line: LineState;
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
  /** Restart the line after a protective trip (it trips again if the fault is still there). */
  restartLine(): void;
  /** Repair completed on a machine: remove its fault and restart the line if it was the cause of the stop. */
  repairMachine(machineId: string): void;
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

    // Protective trip: the first absolute-limit (red) alarm stops the whole serial line.
    let line = get().line;
    const trip = line.running ? ev.alarms.find((a) => a.severity === 'rosso') : undefined;
    if (trip) {
      sim.setLineRunning(false);
      engine.setStopped(get().factory.machines.map((m) => m.id));
      // Shown by the app-wide LineBanner (no toast: it would duplicate it and cover its Restart button).
      line = { ...line, running: false, stopSec: 0, trippedBy: { machineId: trip.machineId, sensorId: trip.sensorId, value: trip.value, threshold: trip.threshold } };
    } else if (!line.running) {
      line = { ...line, stopSec: line.stopSec + 1, totalDowntimeSec: line.totalDowntimeSec + 1 };
    }

    set({
      line,
      tick: sim.tick,
      history: nextHistory,
      statuses: nextStatuses,
      anomalyStart: ev.statusChanges.length ? engine.getAnomalyStarts() : get().anomalyStart,
      activeFaultIds: sim.activeFaults.map((f) => f.id),
    });
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
    line: LINE_RUNNING,

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
      set({
        factory: f,
        tick: 0,
        statuses: engine!.getAllStatuses(),
        anomalyStart: {},
        history: emptyHistory(f),
        incidents: {},
        selectedMachine: null,
        selectedIncident: null,
        activeFaultIds: [],
        arming: [],
        line: LINE_RUNNING,
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
      sim?.reset();
      sim?.setLineRunning(true);
      engine?.setStopped([]);
      set({ activeFaultIds: [], arming: [], line: LINE_RUNNING });
    },
    clearArming(machineId) {
      const next = get().arming.filter((a) => a.machineId !== machineId);
      if (next.length !== get().arming.length) set({ arming: next });
    },
    restartLine() {
      if (get().line.running) return;
      sim?.setLineRunning(true);
      engine?.setStopped([]);
      set((s) => ({ line: { ...s.line, running: true, trippedBy: null, stopSec: 0 } }));
    },
    repairMachine(machineId) {
      sim?.clearFault(machineId);
      set({ activeFaultIds: sim?.activeFaults.map((f) => f.id) ?? [] });
      // Restart once nothing degrades the machine that tripped (directly or through a cascade).
      const tripped = get().line.trippedBy?.machineId;
      if (tripped && !sim?.affectedMachines().includes(tripped)) get().restartLine();
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
