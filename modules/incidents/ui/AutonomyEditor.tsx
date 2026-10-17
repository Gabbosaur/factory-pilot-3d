'use client';
/** Req 10.1, 10.9: manager edits autonomy level per (machine type, action). Applies to new incidents only. */
import { useStore } from '@/modules/store';
import { ACTION_LABEL } from '../autonomy';
import type { ActionCode, AutonomyLevel } from '@/shared/types';

const ACTIONS: ActionCode[] = ['riduci_velocita', 'apri_ticket', 'pianifica_ispezione'];
const LEVELS: AutonomyLevel[] = ['L0', 'L1', 'L2', 'L3'];

export function AutonomyEditor() {
  const factory = useStore((s) => s.factory);
  const overrides = useStore((s) => s.autonomyOverrides[s.factory.id]);
  const setAutonomy = useStore((s) => s.setAutonomy);
  const autonomy = overrides ?? factory.autonomy;
  const types = [...new Set(factory.machines.map((m) => m.type))];

  return (
    <details className="rounded-md border border-slate-800 p-2">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">Autonomy levels</summary>
      <p className="my-1 text-[11px] text-slate-500">
        L0 suggests · L1 drafts · L2 one click · L3 executes and notifies. Maintenance interventions and risky cases always go to the manager. Changes apply to new incidents.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400">
            <th scope="col" className="text-left font-normal">
              Machine type
            </th>
            {ACTIONS.map((a) => (
              <th key={a} scope="col" className="font-normal">
                {ACTION_LABEL[a]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t}>
              <th scope="row" className="py-0.5 text-left font-normal">
                {t.replace(/_/g, ' ')}
              </th>
              {ACTIONS.map((a) => (
                <td key={a} className="text-center">
                  <select
                    aria-label={`Autonomy ${t} – ${ACTION_LABEL[a]}`}
                    className="rounded bg-slate-900 px-1"
                    value={autonomy[t]?.[a] ?? 'L0'}
                    onChange={(e) => setAutonomy(t, a, e.target.value)}
                  >
                    {LEVELS.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
