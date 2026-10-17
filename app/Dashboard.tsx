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

const FactoryMap = dynamic(() => import('@/modules/monitoring/map3d/FactoryMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-slate-400">Loading 3D map…</div>,
});

interface Health {
  amdKey: boolean;
  evolus: boolean;
  replayDefault: boolean;
}

export function Dashboard() {
  const s = useStore();
  const [faultId, setFaultId] = useState('');
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    useStore.getState().hydrate();
    return useStore.getState().onAlarms(handleAlarms);
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

  const memoryLabel = s.memorySource === 'evolus' ? 'Evolus RAG' : s.memorySource === 'locale' ? 'local' : health?.evolus ? 'Evolus' : 'local';

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2">
        <h1 className="mr-2 text-base font-bold">
          FactoryPilot <span className="text-red-500">3D</span>
        </h1>
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
        <button type="button" className="btn-primary" onClick={() => s.setRunning(!s.running)}>
          {s.running ? '⏸ Pause' : '▶ Start'}
        </button>
        <label className="sr-only" htmlFor="fault">
          Fault type
        </label>
        <select id="fault" className="input w-auto" value={faultId} onChange={(e) => setFaultId(e.target.value)}>
          {s.factory.faults.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn bg-red-700 hover:bg-red-600" onClick={() => s.injectFault(faultId)} disabled={!s.running}>
          ⚡ Inject fault
        </button>
        <button type="button" className="btn" onClick={() => s.resetSim()}>
          Reset machines
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
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={s.replay} onChange={(e) => s.setReplay(e.target.checked)} /> Replay
          </label>
          {s.replay && <span className="rounded bg-purple-700 px-1.5 py-0.5 font-semibold">REPLAY</span>}
          <span className={`rounded px-1.5 py-0.5 ${s.aiReachable ? 'bg-slate-800' : 'bg-red-800'}`}>
            AI: {s.aiReachable ? (health?.amdKey ? 'AMD Token Factory' : 'key missing') : 'unreachable'}
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5">Memory: {memoryLabel}</span>
          <span className="rounded bg-amber-600 px-1.5 py-0.5 font-semibold text-black">SYNTHETIC DATA</span>
        </div>
      </header>

      {s.lastError && (
        <div role="alert" className="flex justify-between bg-red-900 px-3 py-1 text-sm">
          {s.lastError}
          <button type="button" onClick={() => s.setError(null)} aria-label="Close message">
            ✕
          </button>
        </div>
      )}

      <div className="pointer-events-none fixed right-3 top-14 z-50 w-80 space-y-2">
        {s.notifications.map((n) => (
          <div key={n.id} role="status" className={`pointer-events-auto rounded-md p-2 text-sm shadow-lg ${n.kind === 'errore' ? 'bg-red-800' : 'bg-emerald-800'}`}>
            <div className="flex justify-between gap-2">
              <span>{n.text}</span>
              <button type="button" onClick={() => s.dismiss(n.id)} aria-label="Close notification">
                ✕
              </button>
            </div>
            {n.incidentId && (
              <button type="button" className="mt-1 text-xs underline" onClick={() => s.selectIncident(n.incidentId!)}>
                Open incident
              </button>
            )}
          </div>
        ))}
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_1fr_420px]">
        <aside className="space-y-4 overflow-auto border-r border-slate-800 p-3">
          <MachineList />
          <MachineDetail />
        </aside>
        <section className="relative min-h-[360px]" aria-label="3D factory map">
          {!s.running && (
            <div className="absolute left-3 top-3 z-10 rounded bg-slate-800/90 px-2 py-1 text-xs">Simulation paused · tick {s.tick}</div>
          )}
          <MapErrorBoundary>
            <FactoryMap />
          </MapErrorBoundary>
        </section>
        <aside className="space-y-4 overflow-auto border-l border-slate-800 p-3">
          <MetricsPanel />
          <IncidentPanel />
          <AutonomyEditor />
        </aside>
      </main>
    </div>
  );
}
