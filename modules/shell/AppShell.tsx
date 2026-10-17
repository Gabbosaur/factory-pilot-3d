'use client';
/**
 * Shared app shell: top navigation, global simulation controls, status chips, banners and toasts.
 * Mounts the simulation loop and health check once, so state persists across page navigation.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '@/modules/store';
import { handleAlarms } from '@/modules/incidents/orchestrator';
import { resetMemory } from '@/modules/incidents/memory/adapter';
import { startTour, Tour } from '@/modules/tour/Tour';
import { HistoryOverlay } from '@/modules/monitoring/panels/HistoryOverlay';
import { LineBanner } from '@/modules/monitoring/panels/LineBanner';

interface Health {
  amdKey: boolean;
  evolus: boolean;
  replayDefault: boolean;
}

const NAV: Array<{ href: string; label: string; tour?: string }> = [
  { href: '/', label: 'Overview', tour: 'nav-overview' },
  { href: '/machines', label: 'Machines', tour: 'nav-machines' },
  { href: '/incidents', label: 'Incidents', tour: 'nav-incidents' },
  { href: '/metrics', label: 'Metrics', tour: 'nav-metrics' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const s = useStore();
  const pathname = usePathname();
  const router = useRouter();
  const [faultId, setFaultId] = useState('');
  const [health, setHealth] = useState<Health | null>(null);

  const needsYou = Object.values(s.incidents).filter((i) => i.status === 'in_coda' && i.escalation?.escalate).length;

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
  // When a notification opens an incident, route to the Incidents page.
  // The Overview shows the incident in its own floating panel, so it stays put.
  useEffect(() => {
    let prev = useStore.getState().selectedIncident;
    return useStore.subscribe((st) => {
      if (st.selectedIncident && st.selectedIncident !== prev && pathname !== '/incidents' && pathname !== '/') router.push('/incidents');
      prev = st.selectedIncident;
    });
  }, [pathname, router]);

  const memoryLabel = s.memorySource === 'evolus' ? 'Evolus RAG' : s.memorySource === 'locale' ? 'Local' : health?.evolus ? 'Evolus' : 'Local';

  return (
    <div className="flex h-dvh flex-col text-slate-100">
      <header className="z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 bg-slate-950/70 px-4 py-2.5 backdrop-blur">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-amd font-black text-white shadow-sm shadow-red-900/40">F</span>
          <h1 className="text-[15px] font-bold tracking-tight">
            FactoryPilot <span className="text-amd">3D</span>
          </h1>
        </Link>

        {/* Page navigation */}
        <nav className="flex items-center gap-1" aria-label="Pages">
          {NAV.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                data-tour={n.tour}
                aria-current={active ? 'page' : undefined}
                className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-white/10 text-slate-100 ring-1 ring-inset ring-white/15' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
              >
                {n.label}
                {n.href === '/incidents' && needsYou > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{needsYou}</span>
                )}
              </Link>
            );
          })}
        </nav>

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
          <button type="button" className="btn-ghost" onClick={startTour} title="Guided walkthrough">
            ? Tour
          </button>
        </div>
      </header>

      {/* Simulation control bar */}
      <div className="z-10 flex flex-wrap items-center gap-2 border-b border-white/10 bg-slate-950/40 px-4 py-2">
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

        <div className="ml-auto flex items-center gap-2">
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
          <span className="pill bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30" title="All sensor data in this demo is simulated">
            Synthetic data
          </span>
        </div>
      </div>

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

      <LineBanner />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>

      <HistoryOverlay />
      <Tour />
    </div>
  );
}
