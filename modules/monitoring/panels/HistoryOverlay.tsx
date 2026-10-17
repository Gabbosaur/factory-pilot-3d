'use client';
/**
 * Right-click menu on a machine (list or 3D map): history dialog, details, open incidents, fault injection.
 * UI-only state, kept out of the main store.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { create } from 'zustand';
import { useStore } from '@/modules/store';
import { MachineHistory } from './MachineHistory';

interface HistoryUi {
  menu: { machineId: string; x: number; y: number } | null;
  open: string | null;
  openMenu(machineId: string, x: number, y: number): void;
  closeMenu(): void;
  showHistory(machineId: string | null): void;
}

export const useHistoryUi = create<HistoryUi>((set) => ({
  menu: null,
  open: null,
  openMenu: (machineId, x, y) => set({ menu: { machineId, x, y } }),
  closeMenu: () => set({ menu: null }),
  showHistory: (open) => set({ open, menu: null }),
}));

function MenuItem({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="menuitem"
      className="block w-full px-3 py-1.5 text-left hover:bg-slate-800 focus:bg-slate-800 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
      {...props}
    >
      {children}
    </button>
  );
}

export function HistoryOverlay() {
  const { menu, open, closeMenu, showHistory } = useHistoryUi();
  const router = useRouter();
  const factory = useStore((s) => s.factory);
  const selectMachine = useStore((s) => s.selectMachine);
  const selectedMachine = useStore((s) => s.selectedMachine);
  const selectIncident = useStore((s) => s.selectIncident);
  const injectFault = useStore((s) => s.injectFault);
  const running = useStore((s) => s.running);
  const activeFaultIds = useStore((s) => s.activeFaultIds);
  const incidents = useStore((s) => s.incidents);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuMachine = factory.machines.find((m) => m.id === menu?.machineId);
  const menuFaults = factory.faults.filter((f) => f.machineId === menu?.machineId);
  const menuIncidents = Object.values(incidents).filter(
    (i) => (i.machineId === menu?.machineId || i.causalPath[0] === menu?.machineId) && i.status !== 'chiuso' && i.status !== 'rifiutato',
  );
  const openMachine = factory.machines.find((m) => m.id === open);

  // Close the menu on outside click, scroll or Escape; focus its first item for keyboard users.
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && menuRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('wheel', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu, closeMenu]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (openMachine && !d.open) d.showModal();
    if (!openMachine && d.open) d.close();
  }, [openMachine]);

  return (
    <>
      {menu && menuMachine && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${menuMachine.id} actions`}
          className="fixed z-50 min-w-56 max-w-72 rounded-md border border-slate-700 bg-slate-900 py-1 text-sm shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 300), top: Math.min(menu.y, window.innerHeight - 220) }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="px-3 py-1 text-[11px] text-slate-500">
            {menuMachine.id} · {menuMachine.name}
          </div>
          <MenuItem onClick={() => showHistory(menuMachine.id)}>History (48 h)</MenuItem>
          <MenuItem
            onClick={() => {
              closeMenu();
              router.push(`/machines/${menuMachine.id}`);
            }}
          >
            Open machine page
          </MenuItem>
          {selectedMachine !== menuMachine.id && (
            <MenuItem
              onClick={() => {
                selectMachine(menuMachine.id);
                closeMenu();
              }}
            >
              Show details
            </MenuItem>
          )}
          {menuIncidents.map((i) => (
            <MenuItem
              key={i.id}
              onClick={() => {
                selectIncident(i.id);
                closeMenu();
              }}
            >
              Open incident {i.id}
              {i.machineId !== menuMachine.id && <span className="text-slate-500"> · on {i.machineId}</span>}
            </MenuItem>
          ))}
          {menuFaults.length > 0 && <div role="separator" className="my-1 border-t border-slate-800" />}
          {menuFaults.map((f) => {
            const busy = activeFaultIds.some((id) => factory.faults.find((x) => x.id === id)?.machineId === menuMachine.id);
            return (
              <MenuItem
                key={f.id}
                disabled={!running || busy}
                title={!running ? 'Start the simulation first' : busy ? 'This machine already has an active fault' : undefined}
                onClick={() => {
                  injectFault(f.id);
                  selectMachine(menuMachine.id);
                  closeMenu();
                }}
              >
                <span className="text-red-400">⚡</span> Inject: {f.label}
              </MenuItem>
            );
          })}
          {menuFaults.length > 0 && !running && <div className="px-3 pb-1 text-[11px] text-slate-500">Start the simulation to inject faults</div>}
        </div>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby="history-h"
        onClose={() => showHistory(null)}
        onClick={(e) => e.target === dialogRef.current && showHistory(null)}
        className="m-auto w-[min(960px,calc(100vw-32px))] rounded-lg border border-slate-700 bg-slate-950 p-4 text-slate-100 backdrop:bg-black/60"
      >
        {openMachine && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 id="history-h" className="text-sm font-semibold">
                {openMachine.id} · {openMachine.name} · history
              </h2>
              <button type="button" className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800" onClick={() => showHistory(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <MachineHistory machine={openMachine} large />
          </>
        )}
      </dialog>
    </>
  );
}
