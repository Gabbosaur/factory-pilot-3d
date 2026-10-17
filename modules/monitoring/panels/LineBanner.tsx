'use client';
/** App-wide banner (under the toolbar, on every page) while the line is stopped by a protective trip. */
import { useStore } from '@/modules/store';

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

export function LineBanner() {
  const line = useStore((s) => s.line);
  const factory = useStore((s) => s.factory);
  const restartLine = useStore((s) => s.restartLine);
  const faultStillActive = useStore((s) => s.activeFaultIds.length > 0);
  if (line.running || !line.trippedBy) return null;

  const t = line.trippedBy;
  const machine = factory.machines.find((m) => m.id === t.machineId);
  const sensor = machine?.sensors.find((s) => s.id === t.sensorId);
  // Serial line: a stop idles every machine, so the downtime cost is the sum over the line.
  const costPerMin = factory.machines.reduce((sum, m) => sum + m.downtimeCostPerMin, 0);
  const lost = Math.round((line.stopSec / 60) * costPerMin);

  return (
    <div role="alert" className="border-b border-red-500/60 bg-red-950/90 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <strong className="text-red-300">⛔ LINE STOPPED</strong>
        <span>
          Protective trip on <strong>{t.machineId}</strong> {machine?.name}: {sensor?.name ?? t.sensorId} {t.value} {sensor?.unit} above the limit of {t.threshold}{' '}
          {sensor?.unit}
        </span>
        <span className="font-mono">stopped {mmss(line.stopSec)}</span>
        <span className="font-mono text-red-300">≈ €{lost.toLocaleString('en-GB')} lost</span>
        <button type="button" className="btn ml-auto" onClick={restartLine} title={faultStillActive ? 'The fault is still there: the line will trip again' : undefined}>
          Restart line
        </button>
      </div>
      <p className="mt-1 text-xs text-red-200/80">
        {faultStillActive
          ? 'The cause is still present: approve the work order and close it after the repair to restart safely.'
          : 'Cause removed: the line can be restarted.'}
      </p>
    </div>
  );
}
