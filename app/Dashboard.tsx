'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useStore } from '@/modules/store';
import { MachineList } from '@/modules/monitoring/panels/MachineList';
import { MachineDetail } from '@/modules/monitoring/panels/MachineDetail';
import { MapErrorBoundary } from '@/modules/monitoring/map3d/MapErrorBoundary';
import { IncidentPanel } from '@/modules/incidents/ui/IncidentPanel';
import { MetricsPanel } from '@/modules/incidents/ui/MetricsPanel';
import { AutonomyEditor } from '@/modules/incidents/ui/AutonomyEditor';
import { handleAlarms } from '@/modules/incidents/orchestrator';
import { resetMemory } from '@/modules/incidents/memory/adapter';
import { startTour, Tour } from '@/modules/tour/Tour';

const FactoryMap = dynamic(() => import('@/modules/monitoring/map3d/FactoryMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading 3D map…</div>,
});

interface Health {
  amdKey: boolean;
  evolus: boolean;
  replayDefault: boolean;
}

type Tab = 'incidents' | 'metrics' | 'settings';

export function Dashboard() {
  const s = useStore();
  const [faultId, setFaultId] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [tab, setTab] = useState<Tab>('incidents');

  const needsYou = Object.values(s.incidents).filter((i) => i.status === 'in_coda' && i.escalation?.escalate).length;

  useEffect(() => {
    useStore.getState().hydrate();
    return useStore.getState().onAlarms(handleAlarms);
  }, []);
  // The tour switches to the right tab before it highlights that section.
  useEffect(() => {
    const onTab = (e: Event) => {
      const t = (e as CustomEvent<Tab>).detail;
      if (t === 'incidents' || t === 'metrics' || t === 'settings') setTab(t);
    };
    window.addEventListener('fp:tour-tab', onTab as EventListener);
    return () => window.removeEventListener('fp:tour-tab', onTab as EventListener);
  }, []);
  // Pop open the Incidents tab when a notification links to an incident.
  useEffect(() => {
    let prev = useStore.getState().selectedIncident;
    return useStore.subscribe((st) => {
      if (st.selectedIncident && st.selectedIncident !== prev) setTab('incidents');
      prev = st.selectedIncident;
    });
  }, []);
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: Health) => {
        setHealth(h);
        if (h.replayDefault || !h.amdKey) useStore.getState().setReplay(true);
      })
      .catch(() => useStore.getState().setAiReachable(false));
  }, []);
  useEffect(() => setFaultId(s.factory.faults[0]?.id ?? ''), [s.factory]);

  const memoryLabel = s.memorySource === 'evolus' ? 'Evolus RAG' : s.memorySource === 'locale' ? 'Local' : health?.evolus ? 'Evolus' : 'Local';

  return (
    <div className="flex h-dvh flex-col text-slate-100">
      <header className="z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 bg-slate-950/70 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-amd font-black text-white shadow-sm shadow-red-900/40">F</span>
          <h1 className="text-[15px] font-bold tracking-tight">
            FactoryPilot <span className="text-amd">3D</span>
          </h1>
        </div>

        <div className="h-5 w-px bg-white/10" />

        {/* Simulation controls */}
        <label className="sr-only" htmlFor="factory">
          Factory
        </label>
        <select id="factory" className="input w-auto" value={s.factory.id} onChange={(e) => s.setFactory(e.target.value)}>
          {s.factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button type="button" data-tour="start" className={s.running ? 'btn' : 'btn-primary'} onClick={() => s.setRunning(!s.running)}>
          {s.running ? '⏸ Pause' : '▶ Start'}
        </button>

        <div className="h-5 w-px bg-white/10" />

        <label className="sr-only" htmlFor="fault">
          Fault type
        </label>
        <select id="fault" className="input w-auto max-w-[15rem]" value={faultId} onChange={(e) => setFaultId(e.target.value)}>
          {s.factory.faults.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" data-tour="inject" className="btn-danger" onClick={() => s.injectFault(faultId)} disabled={!s.running}>
          ⚡ Inject fault
        </button>
        <button type="button" className="btn" onClick={() => s.resetSim()}>
          Reset
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            await resetMemory();
            s.setFactory(s.factory.id);
          }}
          title="Clear incidents and memory (keeps sample data)"
        >
          Reset demo
        </button>
        <Link href="/onboarding" className="btn-ghost">
          + New factory
        </Link>
        <button type="button" className="btn-ghost" onClick={startTour} title="Guided walkthrough">
          ? Tour
        </button>

        {/* Status chips */}
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => s.setReplay(!s.replay)}
            className={`pill ${s.replay ? 'bg-purple-500/20 text-purple-200 ring-1 ring-inset ring-purple-400/40' : 'bg-slate-800 text-slate-400 ring-1 ring-inset ring-white/10'}`}
            title="Serve recorded AMD responses instead of live calls"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${s.replay ? 'bg-purple-300' : 'bg-slate-500'}`} /> Replay {s.replay ? 'on' : 'off'}
          </button>
          <span className={`pill ${s.aiReachable ? 'bg-slate-800 text-slate-300 ring-1 ring-inset ring-white/10' : 'bg-red-500/20 text-red-200 ring-1 ring-inset ring-red-400/40'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.aiReachable ? 'bg-sky-400' : 'bg-red-400'}`} />
            {s.aiReachable ? (health?.amdKey ? 'AMD Token Factory' : 'No AMD key') : 'AI offline'}
          </span>
          <span className="pill bg-slate-800 text-slate-300 ring-1 ring-inset ring-white/10">Memory · {memoryLabel}</span>
          <span className="pill bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30" title="All sensor data in this demo is simulated">
            Synthetic data
          </span>
        </div>
      </header>

      {s.arming.length > 0 && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-sm text-amber-200">
          <span className="h-2 w-2 animate-ping rounded-full bg-amber-400" />
          Fault injected on {s.arming.map((a) => a.machineId).join(', ')}. Building up until the sensor crosses its threshold…
        </div>
      )}

      {s.lastError && (
        <div role="alert" className="flex items-center justify-between gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-sm text-red-200">
          <span>⚠ {s.lastError}</span>
          <button type="button" onClick={() => s.setError(null)} aria-label="Close message" className="text-red-300 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Toasts */}
      <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-80 flex-col gap-2">
        {s.notifications.map((n) => (
          <div
            key={n.id}
            role="status"
            className={`card pointer-events-auto animate-[fadeIn_0.2s_ease-out] border-l-4 p-2.5 text-sm ${n.kind === 'errore' ? 'border-l-red-500' : n.kind === 'autonomia' ? 'border-l-emerald-500' : 'border-l-sky-500'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{n.text}</span>
              <button type="button" onClick={() => s.dismiss(n.id)} aria-label="Dismiss" className="text-slate-500 hover:text-slate-200">
                ✕
              </button>
            </div>
            {n.incidentId && (
              <button type="button" className="mt-1 text-xs font-medium text-sky-400 hover:underline" onClick={() => s.selectIncident(n.incidentId!)}>
                View incident →
              </button>
            )}
          </div>
        ))}
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[248px_1fr_428px]">
        <aside className="flex flex-col gap-4 overflow-auto border-r border-white/10 p-3">
          <MachineList />
          <MachineDetail />
        </aside>
        <section className="relative min-h-[360px]" aria-label="3D factory map" data-tour="map">
          {!s.running && (
            <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg bg-slate-950/70 px-2.5 py-1 text-xs text-slate-300 ring-1 ring-inset ring-white/10 backdrop-blur">
              ⏸ Paused · tick {s.tick}
            </div>
          )}
          <MapErrorBoundary>
            <FactoryMap />
          </MapErrorBoundary>
        </section>
        <aside className="flex min-h-0 flex-col border-l border-white/10">
          <nav className="flex gap-1 border-b border-white/10 px-2 pt-2" role="tablist" aria-label="Panels">
            {([
              ['incidents', 'Incidents'],
              ['metrics', 'Metrics'],
              ['settings', 'Settings'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`relative rounded-t-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === id ? 'bg-white/5 text-slate-100 ring-1 ring-inset ring-white/10' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
                {id === 'incidents' && needsYou > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {needsYou}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div hidden={tab !== 'incidents'} data-tour="incidents">
              <IncidentPanel />
            </div>
            <div hidden={tab !== 'metrics'} data-tour="metrics">
              <MetricsPanel />
            </div>
            <div hidden={tab !== 'settings'}>
              <AutonomyEditor />
            </div>
          </div>
        </aside>
      </main>

      <Tour />
    </div>
  );
}
