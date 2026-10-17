'use client';
/** Overview: production KPIs, the digital twin (3D/2D) and the machine list; machine detail floats over the map and can be dragged. */
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/modules/store';
import { MachineList } from '@/modules/monitoring/panels/MachineList';
import { MachineDetail } from '@/modules/monitoring/panels/MachineDetail';
import { MapErrorBoundary } from '@/modules/monitoring/map3d/MapErrorBoundary';
import { ProductionBar } from '@/modules/monitoring/panels/ProductionBar';
import { IncidentCard } from '@/modules/incidents/ui/IncidentCard';
const FactoryMap = dynamic(() => import('@/modules/monitoring/map3d/FactoryMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading 3D map…</div>,
});

const HOME = { dx: 0, dy: 0 };

export default function OverviewPage() {
  const running = useStore((s) => s.running);
  const tick = useStore((s) => s.tick);
  const selected = useStore((s) => s.selectedMachine);
  const selectMachine = useStore((s) => s.selectMachine);
  const incident = useStore((s) => (s.selectedIncident ? s.incidents[s.selectedIncident] : undefined));
  const selectIncident = useStore((s) => s.selectIncident);
  const pending = useStore((s) => Object.values(s.incidents).filter((i) => i.status === 'in_coda' && i.escalation?.escalate).length);

  // Drag offset of the detail panel from its home position (top-right of the map).
  const [offset, setOffset] = useState(HOME);
  const moved = offset.dx !== 0 || offset.dy !== 0;
  const mapRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  const onDragStart = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, dx: offset.dx, dy: offset.dy };
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const map = mapRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!d || !map || !panel) return;
    let dx = d.dx + e.clientX - d.x;
    let dy = d.dy + e.clientY - d.y;
    // Keep the panel inside the map area.
    const homeLeft = panel.left - offset.dx;
    const homeTop = panel.top - offset.dy;
    dx = Math.min(Math.max(dx, map.left + 8 - homeLeft), map.right - 8 - panel.width - homeLeft);
    dy = Math.min(Math.max(dy, map.top + 8 - homeTop), map.bottom - 48 - homeTop);
    setOffset({ dx, dy });
  };
  const onDragEnd = () => {
    drag.current = null;
  };

  // Esc closes the detail panel (unless a dialog or menu is handling it).
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open], [role="menu"]')) return;
      selectMachine(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, selectMachine]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[260px_1fr]">
      <aside className="flex flex-col gap-3 overflow-auto border-r border-white/10 p-3">
        <MachineList />
        {!selected && <p className="px-1 text-xs text-slate-500">Select a machine on the map or in the list to see its live sensors and history.</p>}
        <button
          type="button"
          className="btn-ghost self-start text-xs disabled:opacity-40"
          onClick={() => setOffset(HOME)}
          disabled={!moved}
          title="Move the machine detail panel back to the top-right of the map"
        >
          ↺ Reset panel position
        </button>
      </aside>
      <div className="flex min-h-0 flex-col">
        <ProductionBar />
        <section ref={mapRef} className="relative min-h-[360px] flex-1" aria-label="3D factory map" data-tour="map">
          {!running && (
            <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg bg-slate-950/70 px-2.5 py-1 text-xs text-slate-300 ring-1 ring-inset ring-white/10 backdrop-blur">
              ⏸ Paused · tick {tick}
            </div>
          )}
          <MapErrorBoundary>
            <FactoryMap />
          </MapErrorBoundary>
          {incident && (
            <div className="absolute left-4 top-14 z-20 flex max-h-[calc(100%-72px)] w-[min(420px,calc(100%-32px))] flex-col overflow-hidden rounded-xl bg-slate-950/90 shadow-2xl ring-1 ring-inset ring-white/10 backdrop-blur">
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Incident {pending > 1 && <span className="text-amber-300">· {pending} need a decision</span>}
                </span>
                <button type="button" onClick={() => selectIncident(null)} aria-label="Close incident" className="rounded px-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100">
                  ✕
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <IncidentCard inc={incident} />
              </div>
            </div>
          )}
          {selected && (
            <div
              ref={panelRef}
              className="absolute right-4 top-14 z-20 flex max-h-[calc(100%-72px)] w-[min(360px,calc(100%-32px))] flex-col overflow-hidden rounded-xl bg-slate-950/85 shadow-2xl ring-1 ring-inset ring-white/10 backdrop-blur"
              style={{ transform: `translate(${offset.dx}px, ${offset.dy}px)` }}
            >
              <div
                role="separator"
                aria-label="Drag to move the panel"
                title="Drag to move"
                className="flex shrink-0 cursor-grab touch-none items-center justify-center py-1 text-slate-500 hover:bg-white/5 active:cursor-grabbing"
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
              >
                <span className="h-1 w-10 rounded-full bg-slate-600" />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <MachineDetail onClose={() => selectMachine(null)} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
