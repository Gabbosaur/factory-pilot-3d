'use client';
/** Overview: the digital twin (3D factory hall) with the machine list and detail. */
import dynamic from 'next/dynamic';
import { useStore } from '@/modules/store';
import { MachineList } from '@/modules/monitoring/panels/MachineList';
import { MachineDetail } from '@/modules/monitoring/panels/MachineDetail';
import { MapErrorBoundary } from '@/modules/monitoring/map3d/MapErrorBoundary';
const FactoryMap = dynamic(() => import('@/modules/monitoring/map3d/FactoryMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading 3D map…</div>,
});

export default function OverviewPage() {
  const running = useStore((s) => s.running);
  const tick = useStore((s) => s.tick);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[280px_1fr]">
      <aside className="flex flex-col gap-4 overflow-auto border-r border-white/10 p-3">
        <MachineList />
        <MachineDetail />
      </aside>
      <section className="relative min-h-[360px]" aria-label="3D factory map" data-tour="map">
        {!running && (
          <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg bg-slate-950/70 px-2.5 py-1 text-xs text-slate-300 ring-1 ring-inset ring-white/10 backdrop-blur">
            ⏸ Paused · tick {tick}
          </div>
        )}
        <MapErrorBoundary>
          <FactoryMap />
        </MapErrorBoundary>
      </section>
    </div>
  );
}
