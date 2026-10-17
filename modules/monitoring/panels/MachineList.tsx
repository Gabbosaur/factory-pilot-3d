'use client';
/** Req 5.7: accessible text list of machines with status in text, keyboard navigable, aria-live on red. */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/modules/store';
import type { MachineStatus } from '@/shared/types';
import { STATUS_LABEL } from '@/modules/incidents/labels';
import { useHistoryUi } from './HistoryOverlay';

const BADGE: Record<MachineStatus, string> = {
  verde: 'bg-green-600 text-white',
  giallo: 'bg-yellow-400 text-black',
  rosso: 'bg-red-600 text-white',
};
const LABEL = STATUS_LABEL;

export function MachineList() {
  const factory = useStore((s) => s.factory);
  const statuses = useStore((s) => s.statuses);
  const selected = useStore((s) => s.selectedMachine);
  const select = useStore((s) => s.selectMachine);
  const openMenu = useHistoryUi((s) => s.openMenu);
  const [announce, setAnnounce] = useState('');
  const prev = useRef<Record<string, MachineStatus>>({});

  useEffect(() => {
    for (const m of factory.machines) {
      const st = statuses[m.id];
      if (st === 'rosso' && prev.current[m.id] !== 'rosso') setAnnounce(`${m.name} in alarm`);
    }
    prev.current = { ...statuses };
  }, [statuses, factory]);

  return (
    <section aria-labelledby="machines-h">
      <h2 id="machines-h" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Machines
      </h2>
      <ul role="list" className="space-y-1">
        {factory.machines.map((m) => {
          const st = statuses[m.id] ?? 'verde';
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => select(m.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // keyboard context-menu key reports (0, 0): anchor the menu to the button instead
                  const r = e.currentTarget.getBoundingClientRect();
                  openMenu(m.id, e.clientX || r.left + 16, e.clientY || r.bottom);
                }}
                aria-pressed={selected === m.id}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${selected === m.id ? 'bg-slate-700' : 'hover:bg-slate-800'}`}
              >
                <span>
                  <span className="font-mono text-slate-400">{m.id}</span> {m.name}
                </span>
                <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${BADGE[st]}`}>{LABEL[st]}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </section>
  );
}
