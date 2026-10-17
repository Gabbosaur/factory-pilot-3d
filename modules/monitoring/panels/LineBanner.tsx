'use client';
/** App-wide banner (under the toolbar, on every page): lines stopped by a protective trip, machines bypassed to a twin. */
import { useStore } from '@/modules/store';
import { capacityFactor } from '@/modules/plant/plant';

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

export function LineBanner() {
  const lines = useStore((s) => s.lines);
  const plant = useStore((s) => s.plant);
  const factory = useStore((s) => s.factory);
  const restartLine = useStore((s) => s.restartLine);
  const activeFaultIds = useStore((s) => s.activeFaultIds);
  const stopped = plant.lines.filter((l) => lines[l.id] && !lines[l.id]!.running && lines[l.id]!.trippedBy);
  const bypassed = useStore((s) => s.bypassed);
  const bypasses = Object.entries(bypassed);
  if (!stopped.length && !bypasses.length) return null;

  return (
    <>
    {bypasses.length > 0 && (
      <div role="status" className="divide-y divide-amber-500/30 border-b border-amber-500/50 bg-amber-950/80 text-sm">
        {bypasses.map(([id, b]) => {
          const machine = factory.machines.find((m) => m.id === id);
          const sensor = machine?.sensors.find((x) => x.id === b.sensorId);
          const line = plant.lines.find((l) => l.id === b.lineId);
          const pct = line ? Math.round(capacityFactor(line.config, new Set(bypasses.filter(([, x]) => x.lineId === b.lineId).map(([k]) => k))) * 100) : 0;
          return (
            <div key={id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5">
              <strong className="text-amber-300">↪ {b.lineId} REROUTED</strong>
              <span>
                <strong>{id}</strong> {machine?.name} bypassed ({sensor?.name ?? b.sensorId} {b.value} {sensor?.unit} above {b.threshold}): flow diverted to <strong>{b.sibling}</strong>
              </span>
              <span className="font-mono text-amber-300">line at {pct}% capacity</span>
              <span className="ml-auto text-xs text-amber-200/80">Close the repair on {id} to put it back in the flow.</span>
            </div>
          );
        })}
      </div>
    )}
    {stopped.length > 0 && (
    <div role="alert" className="divide-y divide-red-500/30 border-b border-red-500/60 bg-red-950/90 text-sm">
      {stopped.map((pl) => {
        const ls = lines[pl.id]!;
        const t = ls.trippedBy!;
        const machine = factory.machines.find((m) => m.id === t.machineId);
        const sensor = machine?.sensors.find((s) => s.id === t.sensorId);
        // Serial line: a stop idles every machine of the line, so the downtime cost is the sum over the line.
        const costPerMin = pl.config.machines.reduce((sum, m) => sum + m.downtimeCostPerMin, 0);
        const lost = Math.round((ls.stopSec / 60) * costPerMin);
        const faultStillActive = activeFaultIds.some((id) => pl.config.faults.some((f) => f.id === id));
        return (
          <div key={pl.id} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <strong className="text-red-300">⛔ {plant.lines.length > 1 ? `${pl.id} ` : ''}LINE STOPPED</strong>
              <span>
                Protective trip on <strong>{t.machineId}</strong> {machine?.name}: {sensor?.name ?? t.sensorId} {t.value} {sensor?.unit} above the limit of {t.threshold}{' '}
                {sensor?.unit}
              </span>
              <span className="font-mono">stopped {mmss(ls.stopSec)}</span>
              <span className="font-mono text-red-300">≈ €{lost.toLocaleString('en-GB')} lost</span>
              <button
                type="button"
                className="btn ml-auto"
                onClick={() => restartLine(pl.id)}
                title={faultStillActive ? 'The fault is still there: the line will trip again' : undefined}
              >
                Restart {plant.lines.length > 1 ? pl.id : 'line'}
              </button>
            </div>
            <p className="mt-1 text-xs text-red-200/80">
              {faultStillActive
                ? 'The cause is still present: approve the work order and close it after the repair to restart safely.'
                : 'Cause removed: the line can be restarted.'}
            </p>
          </div>
        );
      })}
    </div>
    )}
    </>
  );
}
