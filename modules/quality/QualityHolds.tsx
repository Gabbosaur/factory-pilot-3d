'use client';
/** Quality holds: lots of suspect bottles waiting for a quality decision (release after inspection, or scrap). */
import { useStore } from '@/modules/store';
import type { HoldStatus } from './holds';

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const STATUS: Record<HoldStatus, { label: string; tone: string }> = {
  collecting: { label: 'Collecting', tone: 'bg-amber-500/15 text-amber-300 ring-amber-400/40' },
  quarantined: { label: 'Quarantined', tone: 'bg-red-500/15 text-red-300 ring-red-400/40' },
  released: { label: 'Released', tone: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40' },
  scrapped: { label: 'Scrapped', tone: 'bg-slate-500/20 text-slate-300 ring-white/10' },
};

export function QualityHolds({ machineId }: { machineId?: string } = {}) {
  const all = useStore((s) => s.holds);
  const factory = useStore((s) => s.factory);
  const tick = useStore((s) => s.tick);
  const decideHold = useStore((s) => s.decideHold);
  const holds = all.filter((h) => !machineId || h.machineId === machineId).slice().reverse();
  const waiting = holds.filter((h) => h.status === 'quarantined').length;

  return (
    <section className="card p-3" aria-label="Quality holds">
      <h2 className="section-title mb-1">
        Quality holds {waiting > 0 && <span className="text-red-300">· {waiting} awaiting decision</span>}
      </h2>
      <p className="mb-2 text-[11px] text-slate-500">
        Good bottles produced while a product characteristic (fill volume, rejects, inlet flow, capping torque) was abnormal are quarantined as a lot until
        quality releases or scraps it.
      </p>
      {holds.length === 0 ? (
        <p className="text-xs text-slate-500">No suspect lots this shift.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th scope="col" className="font-normal">Lot</th>
              <th scope="col" className="font-normal">Trigger</th>
              <th scope="col" className="font-normal">Window (shift time)</th>
              <th scope="col" className="text-right font-normal">Suspect bottles</th>
              <th scope="col" className="font-normal" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {holds.map((h) => {
              const m = factory.machines.find((x) => x.id === h.machineId);
              const sensor = m?.sensors.find((x) => x.id === h.sensorId);
              const st = STATUS[h.status];
              return (
                <tr key={h.id}>
                  <td className="py-1.5 font-mono text-slate-300">{h.id}</td>
                  <td className="py-1.5">
                    <span className="font-mono text-slate-400">{h.machineId}</span> · {sensor?.name ?? h.sensorId}
                  </td>
                  <td className="py-1.5 font-mono text-slate-400">
                    {mmss(h.startTick)} → {h.endTick === null ? `now (${mmss(tick - h.startTick)})` : mmss(h.endTick)}
                  </td>
                  <td className="py-1.5 text-right font-mono">{Math.round(h.suspect).toLocaleString('en-GB')}</td>
                  <td className="py-1.5 text-right">
                    {h.status === 'quarantined' ? (
                      <span className="flex justify-end gap-1">
                        <button type="button" className="btn-ghost text-xs" onClick={() => decideHold(h.id, 'released')} title="Inspection passed: ship the lot">
                          Release
                        </button>
                        <button type="button" className="btn-ghost text-xs text-red-300" onClick={() => decideHold(h.id, 'scrapped')} title="Discard the lot: counted as rejects">
                          Scrap
                        </button>
                      </span>
                    ) : (
                      <span className={`pill ${st.tone}`}>{st.label}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
