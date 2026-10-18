'use client';
/**
 * Quality holds: lots of suspect bottles waiting for a quality decision. The technician photographs sample
 * bottles of the lot; Gemma inspects each one and the samples suggest release or scrap (people decide).
 */
import { useRef, useState } from 'react';
import { useStore } from '@/modules/store';
import { DEFECT_LABEL, inspectPhoto } from '@/modules/vision/inspect';
import { suggestDisposition, type HoldStatus, type QualityHold } from './holds';

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const STATUS: Record<HoldStatus, { label: string; tone: string }> = {
  collecting: { label: 'Collecting', tone: 'bg-amber-500/15 text-amber-300 ring-amber-400/40' },
  quarantined: { label: 'Quarantined', tone: 'bg-red-500/15 text-red-300 ring-red-400/40' },
  released: { label: 'Released', tone: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40' },
  scrapped: { label: 'Scrapped', tone: 'bg-slate-500/20 text-slate-300 ring-white/10' },
};

function HoldRow({ h }: { h: QualityHold }) {
  const factory = useStore((s) => s.factory);
  const tick = useStore((s) => s.tick);
  const decideHold = useStore((s) => s.decideHold);
  const addHoldSample = useStore((s) => s.addHoldSample);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const m = factory.machines.find((x) => x.id === h.machineId);
  const sensor = m?.sensors.find((x) => x.id === h.sensorId);
  const st = STATUS[h.status];
  const samples = h.samples ?? [];
  const disposition = suggestDisposition(samples);

  const inspect = async (files: FileList) => {
    if (!m) return;
    setError(null);
    for (const file of Array.from(files).slice(0, 10)) {
      setBusy((b) => b + 1);
      // No hint about the quarantine in the request: the model must judge the photo alone.
      const r = await inspectPhoto(file, m);
      setBusy((b) => b - 1);
      if (!r.result) {
        setError(r.error ?? 'Inspection failed');
        continue;
      }
      addHoldSample(h.id, {
        id: `${h.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        verdict: r.result.verdict,
        defectType: r.result.defect_type,
        confidence: r.result.confidence,
        affectsQuality: r.result.affects_quality,
        thumb: r.thumb,
        model: r.meta?.model ?? 'Gemma',
        replay: r.meta?.replay ?? false,
      });
    }
  };

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-mono text-slate-300">{h.id}</span>
        <span>
          <span className="font-mono text-slate-400">{h.machineId}</span> · {sensor?.name ?? h.sensorId}
        </span>
        <span className="font-mono text-slate-500">
          {mmss(h.startTick)} → {h.endTick === null ? `now (${mmss(tick - h.startTick)})` : mmss(h.endTick)}
        </span>
        <span className="font-mono">{Math.round(h.suspect).toLocaleString('en-GB')} suspect bottles</span>
        <span className={`pill ml-auto ${st.tone}`}>{st.label}</span>
      </div>

      {(h.status === 'quarantined' || samples.length > 0) && (
        <div className="mt-2 rounded-lg bg-slate-950/50 p-2 ring-1 ring-inset ring-white/5">
          <div className="flex flex-wrap items-center gap-2">
            {samples.map((x) => (
              <figure key={x.id} className="relative" title={`${DEFECT_LABEL[x.defectType as keyof typeof DEFECT_LABEL] ?? x.defectType} · ${Math.round(x.confidence * 100)}% ${x.replay ? '(replay)' : ''}`}>
                {x.thumb ? <img src={x.thumb} alt={`Sample: ${x.verdict}`} className="h-14 w-14 rounded object-cover" /> : <div className="h-14 w-14 rounded bg-slate-800" />}
                <figcaption
                  className={`absolute inset-x-0 bottom-0 rounded-b px-1 text-center text-[9px] font-bold ${x.verdict === 'ok' && !x.affectsQuality ? 'bg-emerald-600/90' : x.verdict === 'uncertain' && !x.affectsQuality ? 'bg-amber-600/90' : 'bg-red-600/90'}`}
                >
                  {x.verdict === 'ok' && !x.affectsQuality ? 'OK' : x.verdict === 'uncertain' && !x.affectsQuality ? '?' : 'DEFECT'}
                </figcaption>
              </figure>
            ))}
            {h.status === 'quarantined' && (
              <>
                <input
                  ref={input}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void inspect(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button type="button" className="flex h-14 items-center rounded border border-dashed border-white/20 px-3 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50" onClick={() => input.current?.click()} disabled={busy > 0}>
                  {busy > 0 ? `AI inspecting ${busy}…` : '+ Inspect samples (photos)'}
                </button>
              </>
            )}
          </div>
          {error && <p className="mt-1 text-[11px] text-amber-300">{error}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className={disposition.suggest === 'scrap' ? 'text-red-300' : disposition.suggest === 'release' ? 'text-emerald-300' : 'text-slate-400'}>
              {disposition.suggest === 'inspect_more' ? '' : 'Suggested: '}
              <strong>{disposition.suggest === 'scrap' ? 'Scrap' : disposition.suggest === 'release' ? 'Release' : disposition.reason}</strong>
              {disposition.suggest !== 'inspect_more' && ` · ${disposition.reason}`}
            </span>
            {h.status === 'quarantined' && (
              <span className="ml-auto flex gap-1">
                <button type="button" className={disposition.suggest === 'release' ? 'btn-primary text-xs' : 'btn-ghost text-xs'} onClick={() => decideHold(h.id, 'released')} title="Ship the lot">
                  Release
                </button>
                <button type="button" className={disposition.suggest === 'scrap' ? 'btn-danger text-xs' : 'btn-ghost text-xs text-red-300'} onClick={() => decideHold(h.id, 'scrapped')} title="Discard the lot: counted as rejects">
                  Scrap
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function QualityHolds({ machineId }: { machineId?: string } = {}) {
  const all = useStore((s) => s.holds);
  const holds = all.filter((h) => !machineId || h.machineId === machineId).slice().reverse();
  const waiting = holds.filter((h) => h.status === 'quarantined').length;

  return (
    <section className="card p-3" aria-label="Quality holds" data-tour="holds">
      <h2 className="section-title mb-1">
        Quality holds {waiting > 0 && <span className="text-red-300">· {waiting} awaiting decision</span>}
      </h2>
      <p className="mb-1 text-[11px] text-slate-500">
        Bottles made while a product characteristic was abnormal are quarantined. Photograph a few sample bottles: the AI inspects each one and the samples suggest
        release or scrap; quality decides.
      </p>
      {holds.length === 0 ? <p className="text-xs text-slate-500">No suspect lots this shift.</p> : <ul className="divide-y divide-white/5">{holds.map((h) => <HoldRow key={h.id} h={h} />)}</ul>}
    </section>
  );
}
