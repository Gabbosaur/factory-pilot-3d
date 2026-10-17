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

  const cell = (label: string, value: string, accent: string, sub?: string) => (
    <div className="stat">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${accent}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );

  return (
    <section aria-labelledby="metrics-h" className="card p-3">
      <h2 id="metrics-h" className="section-title mb-2">
        Measured impact
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {cell('Alarm → diagnosis', avg === null ? '—' : `${avg.toFixed(1)}s`, 'text-sky-300', ref ? `vs ${Math.round(ref / 60)} min manual` : 'no reference')}
        {cell('Downtime avoided', avoidedMin && diagnosed.length ? `${avoidedMin.toFixed(0)} min` : '—', 'text-emerald-300')}
        {cell('Savings (est.)', savings && diagnosed.length ? formatEur(Math.round(savings)) : '—', 'text-emerald-300')}
        {cell('Auto / escalated', `${autonomous} / ${escalated}`, 'text-slate-100')}
      </div>
    </section>
  );
}
