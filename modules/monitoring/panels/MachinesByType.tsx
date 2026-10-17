'use client';
/** Machines page content: machines grouped by type, with a per-group status summary. */
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/modules/store';
import { STATUS_DOT, STATUS_LABEL, STATUS_PILL } from '@/modules/incidents/labels';
import { formatEur } from '@/modules/incidents/impact';
import type { MachineConfig, MachineStatus } from '@/shared/types';

const STATUS_ORDER: Record<MachineStatus, number> = { rosso: 0, giallo: 1, verde: 2 };

export function MachinesByType() {
  const factory = useStore((s) => s.factory);
  const statuses = useStore((s) => s.statuses);
  const incidents = useStore((s) => s.incidents);
  const select = useStore((s) => s.selectMachine);
  const router = useRouter();

  const groups = useMemo(() => {
    const by = new Map<string, MachineConfig[]>();
    for (const m of factory.machines) {
      const arr = by.get(m.type) ?? [];
      arr.push(m);
      by.set(m.type, arr);
    }
    return [...by.entries()]
      .map(([type, machines]) => ({
        type,
        machines: [...machines].sort((a, b) => STATUS_ORDER[statuses[a.id] ?? 'verde'] - STATUS_ORDER[statuses[b.id] ?? 'verde']),
      }))
      .sort((a, b) => a.type.localeCompare(b.type));
  }, [factory, statuses]);

  const openIncidents = (id: string) => Object.values(incidents).filter((i) => (i.machineId === id || i.causalPath[0] === id) && i.status !== 'chiuso').length;

  const inspect = (id: string) => {
    select(id);
    router.push(`/machines/${id}`);
  };

  // Many machine types? Collapse groups by default so the page stays scannable.
  const collapsed = groups.length > 4;

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const counts = g.machines.reduce(
          (acc, m) => {
            acc[statuses[m.id] ?? 'verde']++;
            return acc;
          },
          { verde: 0, giallo: 0, rosso: 0 } as Record<MachineStatus, number>,
        );
        return (
          <details key={g.type} open={!collapsed || counts.rosso > 0 || counts.giallo > 0} className="card p-0">
            <summary className="flex cursor-pointer select-none items-center gap-3 p-3">
              <span className="text-sm font-semibold capitalize">{g.type.replace(/_/g, ' ')}</span>
              <span className="text-xs text-slate-500">{g.machines.length}</span>
              <span className="ml-auto flex items-center gap-2 text-xs">
                {(['rosso', 'giallo', 'verde'] as const).map((st) =>
                  counts[st] > 0 ? (
                    <span key={st} className="flex items-center gap-1 text-slate-400">
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[st]} ${st === 'rosso' ? 'animate-pulse' : ''}`} />
                      {counts[st]}
                    </span>
                  ) : null,
                )}
              </span>
            </summary>

            <ul className="grid gap-2 border-t border-white/5 p-3 sm:grid-cols-2">
              {g.machines.map((m) => {
                const st = statuses[m.id] ?? 'verde';
                const open = openIncidents(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => inspect(m.id)}
                      className="flex w-full flex-col gap-2 rounded-lg border border-white/5 bg-slate-950/40 p-3 text-left transition hover:ring-1 hover:ring-inset hover:ring-white/20"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[st]} ${st === 'rosso' ? 'animate-pulse' : ''}`} />
                        <span className="font-mono text-xs text-slate-500">{m.id}</span>
                        <span className="truncate text-sm font-medium">{m.name}</span>
                        <span className={`pill ml-auto ${STATUS_PILL[st]}`}>{STATUS_LABEL[st]}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{m.sensors.length} sensors</span>
                        <span>{formatEur(m.downtimeCostPerMin)}/min down</span>
                        {open > 0 && <span className="font-semibold text-red-300">{open} open incident{open > 1 ? 's' : ''}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
