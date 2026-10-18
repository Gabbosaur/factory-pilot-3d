'use client';
/** "Add photo evidence" on an incident: the AI inspects the photo and the result is written in the incident log. */
import { useRef, useState } from 'react';
import { useStore } from '@/modules/store';
import type { Incident } from '@/shared/types';
import { describeInspection, inspectPhoto } from './inspect';

export function PhotoEvidence({ inc }: { inc: Incident }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const machine = useStore((s) => s.factory.machines.find((m) => m.id === inc.machineId));
  if (!machine) return null;

  const run = async (file: File) => {
    setBusy(true);
    const r = await inspectPhoto(file, machine, `evidence for incident ${inc.id}`);
    setBusy(false);
    const text = r.result ? describeInspection(r.result) : `Photo not inspected: ${r.error}`;
    setLast(text);
    if (r.result)
      useStore.getState().patchIncident(inc.id, (i) => ({ log: [...i.log, { ts: new Date().toISOString(), kind: 'llm', message: text, author: 'Tecnico' }] }));
  };

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run(f);
          e.target.value = '';
        }}
      />
      <button type="button" className="btn-ghost" onClick={() => input.current?.click()} disabled={busy} title="Photo of the product or the part: inspected by the AI and added to the incident log">
        {busy ? 'Inspecting photo…' : '📷 Add photo evidence'}
      </button>
      {last && <span className="text-[11px] text-slate-400">{last}</span>}
    </span>
  );
}
