'use client';
/** Pannello_Metriche (Req 14). All values are estimates based on the factory configuration. */
import { useMemo } from 'react';
import { useStore } from '@/modules/store';
import { formatEur } from '../impact';

export function MetricsPanel() {
  // Select the stable map, derive the array outside the selector (a new array per call loops useSyncExternalStore).
  const byId = useStore((s) => s.incidents);
  const incidents = useMemo(() => Object.values(byId), [byId]);
  const ref = useStore((s) => s.factory.manualSearchRefSec);

  const diagnosed = incidents.filter((i) => typeof i.alarmToDiagnosisSec === 'number');
  const avg = diagnosed.length ? diagnosed.reduce((a, i) => a + i.alarmToDiagnosisSec!, 0) / diagnosed.length : null;
  const avoidedMin = ref ? diagnosed.reduce((a, i) => a + Math.max(0, ref - i.alarmToDiagnosisSec!) / 60, 0) : null;
  const savings = ref ? diagnosed.reduce((a, i) => a + (Math.max(0, ref - i.alarmToDiagnosisSec!) / 60) * i.impact.costPerMin, 0) : null;
  const autonomous = incidents.filter((i) => i.escalation && !i.escalation.escalate && i.autonomyMode === 'esegui_e_notifica').length;
  const escalated = incidents.filter((i) => i.escalation?.escalate).length;

  const cell = (label: string, value: string, sub?: string) => (
    <div className="rounded-md bg-slate-800 p-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );

  return (
    <section aria-labelledby="metrics-h">
      <h2 id="metrics-h" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Measured impact
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {cell('Alarm → diagnosis', avg === null ? 'no data' : `${avg.toFixed(1)} s`, ref ? `vs ${Math.round(ref / 60)} min of manual search` : 'manual reference not set')}
        {cell('Estimated downtime avoided', avoidedMin === null ? 'n/a' : diagnosed.length ? `${avoidedMin.toFixed(1)} min` : 'no data')}
        {cell('Estimated savings', savings === null ? 'n/a' : diagnosed.length ? formatEur(Math.round(savings)) : 'no data', 'estimate')}
        {cell('Handled autonomously / escalated', `${autonomous} / ${escalated}`)}
      </div>
    </section>
  );
}
