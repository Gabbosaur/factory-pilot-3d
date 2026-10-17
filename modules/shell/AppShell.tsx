'use client';
/**
 * Shared app shell: top navigation, global simulation controls, status chips, banners and toasts.
 * Mounts the simulation loop and health check once, so state persists across page navigation.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '@/modules/store';
import { handleAlarms } from '@/modules/incidents/orchestrator';
import { resetMemory } from '@/modules/incidents/memory/adapter';
import { HistoryOverlay } from '@/modules/monitoring/panels/HistoryOverlay';
import { LineBanner } from '@/modules/monitoring/panels/LineBanner';

interface Health {
  amdKey: boolean;
  replayDefault: boolean;
}

// Incidents, metrics and configuration live on each machine page (filtered to that machine);
// the plant page lists everything waiting for a decision.
const NAV: Array<{ href: string; label: string; tour?: string }> = [
  { href: '/', label: 'Overview', tour: 'nav-overview' },
  { href: '/machines', label: 'Machines', tour: 'nav-machines' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const s = useStore();
  const pathname = usePathname();
  const router = useRouter();
  const [faultMenuOpen, setFaultMenuOpen] = useState(false);
  const faultMenuRef = useRef<HTMLDivElement>(null);
  const [health, setHealth] = useState<Health | null>(null);

  const needsYou = Object.values(s.incidents).filter((i) => i.status === 'in_coda' && i.escalation?.escalate).length;

  useEffect(() => {
    if (!faultMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (faultMenuRef.current && !faultMenuRef.current.contains(e.target as Node)) {
        setFaultMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFaultMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [faultMenuOpen]);

  useEffect(() => {
    useStore.getState().hydrate();
    // The plant is always producing: the simulation runs from the first load and is never paused.
    if (!useStore.getState().running) useStore.getState().setRunning(true);
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
  // When a notification opens an incident, show it where it lives: the plant page lists it, line pages
  // float it over the map, the machine page of that machine shows it; anywhere else go to its line.
  useEffect(() => {
    let prev = useStore.getState().selectedIncident;
    return useStore.subscribe((st) => {
      const inc = st.selectedIncident ? st.incidents[st.selectedIncident] : undefined;
      if (inc && st.selectedIncident !== prev) {
        const here = pathname === '/' || pathname.startsWith('/lines') || pathname === `/machines/${inc.machineId}`;
        if (!here) router.push(`/lines/${st.plant.lineOf[inc.machineId] ?? st.plant.lines[0]?.id ?? ''}`);
      }
      prev = st.selectedIncident;
    });
  }, [pathname, router]);

  const memoryLabel = 'Local';

  return (
    <div className="flex h-dvh flex-col text-slate-100">
      <header className="z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 bg-slate-950/70 px-4 py-2.5 backdrop-blur">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-amd font-black text-white shadow-sm shadow-red-900/40">F</span>
          <h1 className="text-[15px] font-bold tracking-tight">
            FactoryPilot <span className="text-amd">3D</span>
          </h1>
        </Link>

        {/* Global filter: every page shows the selected plant */}
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          Plant
          <select className="input w-auto py-1 text-sm" value={s.factory.id} onChange={(e) => s.setFactory(e.target.value)}>
            {s.factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>

        {/* Page navigation */}
        <nav className="flex items-center gap-1" aria-label="Pages">
          {NAV.map((n) => {
            const active = pathname === n.href || (n.href === '/' && pathname.startsWith('/lines')) || (n.href !== '/' && pathname.startsWith(`${n.href}/`));
            return (
              <Link
                key={n.href}
                href={n.href}
                data-tour={n.tour}
                aria-current={active ? 'page' : undefined}
                className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-white/10 text-slate-100 ring-1 ring-inset ring-white/15' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
              >
                {n.label}
                {n.href === '/' && needsYou > 0 && (
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
        </div>
      </header>

      {/* Demo controls (simulation only, not part of the product) */}
      <div className="z-10 flex flex-wrap items-center gap-2 border-b border-white/10 bg-slate-950/40 px-4 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500" title="Controls of the simulated plant used for the demo">
          Demo
        </span>

        <div className="relative inline-block" ref={faultMenuRef}>
          <button
            type="button"
            data-tour="inject"
            className="btn-danger flex items-center gap-1.5"
            onClick={() => setFaultMenuOpen((o) => !o)}
            aria-expanded={faultMenuOpen}
            aria-haspopup="menu"
            title="Simulate a fault"
          >
            <span>⚡ Simulate fault</span>
            <span className="text-[10px] opacity-75">▾</span>
          </button>
          {faultMenuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-30 mt-1 min-w-[260px] max-w-[340px] rounded-xl border border-white/15 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur"
            >
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Simulate a fault
              </div>
              <div className="flex flex-col gap-0.5">
                {s.factory.faults.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="menuitem"
                    className="flex flex-col rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                    onClick={() => {
                      if (!s.running) s.setRunning(true);
                      s.injectFault(f.id);
                      setFaultMenuOpen(false);
                    }}
                  >
                    <span className="font-semibold text-slate-100">{f.label}</span>
                    <span className="text-[10px] text-slate-400">
                      Machine <span className="font-mono text-slate-300">{f.machineId}</span> · {f.kind === 'cascata' ? 'Cascade fault' : 'Local fault'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn"
          onClick={() => s.resetSim()}
          title="Clear all active faults and return machines to nominal healthy conditions"
        >
          Simulate solved
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
            + New plant
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
    </div>
  );
}
