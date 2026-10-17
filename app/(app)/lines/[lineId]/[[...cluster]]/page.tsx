'use client';
/**
 * Line view (and cluster view when /lines/<line>/<cluster>): line KPIs, process clusters with capacity,
 * rejects and bottleneck, the digital twin of the line, machine list; machine detail and incident float
 * over the map (the detail panel can be dragged).
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/modules/store';
import { MachineList } from '@/modules/monitoring/panels/MachineList';
import { MachineDetail } from '@/modules/monitoring/panels/MachineDetail';
import { MapErrorBoundary } from '@/modules/monitoring/map3d/MapErrorBoundary';
import { ProductionBar } from '@/modules/monitoring/panels/ProductionBar';
import { IncidentCard } from '@/modules/incidents/ui/IncidentCard';
import { STATUS_DOT, STATUS_LABEL, STATUS_PILL } from '@/modules/incidents/labels';
import { Breadcrumb } from '@/modules/shell/Breadcrumb';
import { bottleneck, clusterMetrics } from '@/modules/plant/metrics';

const FactoryMap = dynamic(() => import('@/modules/monitoring/map3d/FactoryMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading 3D map…</div>,
});

const HOME = { dx: 0, dy: 0 };
const int = (n: number) => Math.round(n).toLocaleString('en-GB');

export default function LinePage() {
  const params = useParams<{ lineId: string; cluster?: string[] }>();
  const plant = useStore((s) => s.plant);
  const plantName = useStore((s) => s.factory.name.split(' – ')[0]!);
  const line = plant.lines.find((l) => l.id === params.lineId) ?? plant.lines[0]!;
  const clusterId = params.cluster?.[0];
  const cluster = line.clusters.find((c) => c.id === clusterId);
  const machineIds = cluster ? cluster.machineIds : line.machineIds;

  const statuses = useStore((s) => s.statuses);
  const speed = useStore((s) => s.speed);
  const production = useStore((s) => s.productions[line.id]);
  const lineRunning = useStore((s) => s.lines[line.id]?.running ?? true);
  const incidents = useStore((s) => s.incidents);
  const selectedRaw = useStore((s) => s.selectedMachine);
  const selected = selectedRaw && machineIds.includes(selectedRaw) ? selectedRaw : null;
  const selectMachine = useStore((s) => s.selectMachine);
  const incidentRaw = useStore((s) => (s.selectedIncident ? s.incidents[s.selectedIncident] : undefined));
  const incident = incidentRaw && line.machineIds.includes(incidentRaw.machineId) ? incidentRaw : undefined;
  const selectIncident = useStore((s) => s.selectIncident);
  const pending = Object.values(incidents).filter((i) => i.status === 'in_coda' && i.escalation?.escalate && line.machineIds.includes(i.machineId)).length;

  const bypassed = useStore((s) => s.bypassed);
  const metrics = useMemo(() => clusterMetrics(line, production, statuses, speed, lineRunning, new Set(Object.keys(bypassed))), [line, production, statuses, speed, lineRunning, bypassed]);
  const neck = bottleneck(metrics);

  // Drag offset of the detail panel from its home position (top-right of the map).
  const [offset, setOffset] = useState(HOME);
  const moved = offset.dx !== 0 || offset.dy !== 0;
  const mapRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    initDx: number;
    initDy: number;
    homeLeft: number;
    homeTop: number;
  } | null>(null);

  const onDragStart = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const panel = panelRef.current?.getBoundingClientRect();
    const homeLeft = panel ? panel.left - offset.dx : 0;
    const homeTop = panel ? panel.top - offset.dy : 0;
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      initDx: offset.dx,
      initDy: offset.dy,
      homeLeft,
      homeTop,
    };
  };

  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const map = mapRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!d || !map || !panel) return;

    const rawDx = d.initDx + e.clientX - d.startX;
    const rawDy = d.initDy + e.clientY - d.startY;

    const panelWidth = panel.offsetWidth || 360;
    const panelHeight = panel.offsetHeight || 400;

    const minDx = map.left + 8 - d.homeLeft;
    const maxDx = map.right - 8 - panelWidth - d.homeLeft;
    const minDy = map.top + 8 - d.homeTop;
    const maxDy = Math.max(minDy, map.bottom - 48 - panelHeight - d.homeTop);

    const clampedDx = Math.min(Math.max(rawDx, Math.min(minDx, maxDx)), Math.max(minDx, maxDx));
    const clampedDy = Math.min(Math.max(rawDy, Math.min(minDy, maxDy)), Math.max(minDy, maxDy));
    setOffset({ dx: clampedDx, dy: clampedDy });
  };

  const onDragEnd = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
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

  const lineHref = `/lines/${line.id}`;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[260px_1fr]">
      <aside className="flex flex-col gap-3 overflow-auto border-r border-white/10 p-3">
        <MachineList machineIds={machineIds} title={cluster ? cluster.name : 'Machines'} />
        {!selected && <p className="px-1 text-xs text-slate-500">Select a machine on the map or in the list to see its live sensors and history.</p>}
        {selected && moved && (
          <button
            type="button"
            className="btn-ghost self-start text-xs text-sky-400 hover:text-sky-300"
            onClick={() => setOffset(HOME)}
            title="Move the machine detail panel back to the top-right of the map"
          >
            ↺ Reset panel position
          </button>
        )}
      </aside>
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2">
          <Breadcrumb items={[{ label: plantName, href: '/' }, { label: line.name, href: lineHref }, ...(cluster ? [{ label: cluster.name }] : [])]} />
        </div>
        <ProductionBar lineId={line.id} />
        {/* Process clusters of the line */}
        <div className="grid grid-cols-1 gap-2 border-b border-white/10 p-2 sm:grid-cols-3">
          {metrics.map((cm) => {
            const active = cm.cluster.id === clusterId;
            const isNeck = neck?.cluster.id === cm.cluster.id;
            return (
              <Link
                key={cm.cluster.id}
                href={active ? lineHref : `${lineHref}/${cm.cluster.id}`}
                className={`rounded-lg px-3 py-2 text-xs ring-1 ring-inset transition ${active ? 'bg-sky-500/10 ring-sky-400/60' : 'bg-slate-900/50 ring-white/10 hover:ring-white/25'}`}
                aria-current={active ? 'page' : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{cm.cluster.name}</span>
                  <span className="flex items-center gap-1.5">
                    {isNeck && <span className="pill bg-amber-500/15 text-amber-300 ring-amber-400/40">Bottleneck</span>}
                    <span className={`pill ${STATUS_PILL[cm.worst]}`}>{STATUS_LABEL[cm.worst]}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  {cm.cluster.machineIds.map((id) => (
                    <span key={id} className="flex items-center gap-1 font-mono text-[10px] text-slate-400">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[statuses[id] ?? 'verde']}`} />
                      {id}
                    </span>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-2 text-[11px] text-slate-400">
                  <span>
                    Capacity <span className={`font-mono ${cm.capacityPerHour < cm.nominalPerHour ? 'text-amber-300' : 'text-slate-200'}`}>{int(cm.capacityPerHour)}</span>/h
                  </span>
                  <span className="text-right">
                    Rejects <span className="font-mono text-slate-200">{int(cm.rejects)}</span> · {cm.rejectPct.toFixed(2)}%
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
        <section ref={mapRef} className="relative min-h-[360px] flex-1" aria-label="Line digital twin" data-tour="map">
          <MapErrorBoundary>
            <FactoryMap machineIds={machineIds} />
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
                aria-label="Drag to move the panel, double-click to reset"
                title="Drag to move · Double-click to reset position"
                className="flex shrink-0 cursor-grab touch-none items-center justify-center py-1.5 text-slate-500 hover:bg-white/5 active:cursor-grabbing"
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                onDoubleClick={() => setOffset(HOME)}
              >
                <span className="h-1 w-10 rounded-full bg-slate-600" />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <MachineDetail
                  onClose={() => selectMachine(null)}
                  onResetPosition={moved ? () => setOffset(HOME) : undefined}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
