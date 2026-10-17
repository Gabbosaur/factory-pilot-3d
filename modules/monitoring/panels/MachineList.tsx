'use client';
/** Req 5.7: accessible text list of machines with status in text, keyboard navigable, aria-live on red. */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/modules/store';
import type { MachineStatus } from '@/shared/types';
import { STATUS_DOT, STATUS_LABEL, STATUS_PILL } from '@/modules/incidents/labels';
import { useHistoryUi } from './HistoryOverlay';

export function MachineList({ machineIds, title = 'Machines' }: { machineIds?: string[]; title?: string } = {}) {
  const factory = useStore((s) => s.factory);
  const machines = machineIds ? factory.machines.filter((m) => machineIds.includes(m.id)) : factory.machines;
  const statuses = useStore((s) => s.statuses);
  const selected = useStore((s) => s.selectedMachine);
  const select = useStore((s) => s.selectMachine);
  const openMenu = useHistoryUi((s) => s.openMenu);
  const [announce, setAnnounce] = useState('');
  const prev = useRef<Record<string, MachineStatus>>({});

  useEffect(() => {
    for (const m of machines) {
      const st = statuses[m.id];
      if (st === 'rosso' && prev.current[m.id] !== 'rosso') setAnnounce(`${m.name} in alarm`);
    }
    prev.current = { ...statuses };
  }, [statuses, factory]);

  return (
    <section aria-labelledby="machines-h">
      <h2 id="machines-h" className="section-title mb-2">
        {title}
      </h2>
      <ul role="list" className="space-y-1">
        {machines.map((m) => {
          const st = statuses[m.id] ?? 'verde';
          const active = selected === m.id;
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
                aria-pressed={active}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${active ? 'bg-white/10 ring-1 ring-inset ring-white/15' : 'hover:bg-white/5'}`}
              >
                <span className="flex items-center gap-2 truncate">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[st]} ${st === 'rosso' ? 'animate-pulse' : ''}`} />
                  <span className="font-mono text-xs text-slate-500">{m.id}</span>
                  <span className="truncate">{m.name}</span>
                </span>
                <span className={`pill ${STATUS_PILL[st]}`}>{STATUS_LABEL[st]}</span>
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
