'use client';
/**
 * "Ask FactoryPilot": natural-language questions answered by the AI from the live plant data (AMD Token Factory).
 * The panel holds the question box; the conversation opens in a modal (follow-up questions can be asked there).
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/modules/store';
import { enqueuePost } from '@/modules/incidents/requestQueue';
import { localMemory } from '@/modules/incidents/memory/local';
import type { AskAnswer, LlmCallMeta } from '@/shared/types';
import { buildContext } from './context';
import { retrieve, verifySource } from './retrieval';
import { MANUALS } from '@/data/manuals.generated';

const PLANT_EXAMPLES = ['Why is the plant OEE below target right now?', 'Which line or machine should I look at first, and why?', 'Summarise quality this shift: FPY, rejects and lots on hold.'];
const MACHINE_EXAMPLES = ['Is this machine OK? What is trending in the wrong direction?', 'If nothing changes, when will it trip and what do I do now?', 'Is the process capable on the product characteristics?'];

interface Turn {
  q: string;
  a?: AskAnswer;
  meta?: LlmCallMeta;
  error?: string;
  pending?: boolean;
  /** Evolus knowledge-library search run alongside (manual passages, past interventions). */
  kb?: { pending?: boolean; text?: string; latencyMs?: number; error?: string; off?: boolean };
}

function QuestionForm({ id, busy, onAsk, placeholder, autoFocus }: { id: string; busy: boolean; onAsk: (q: string) => void; placeholder: string; autoFocus?: boolean }) {
  const [question, setQuestion] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (question.trim().length < 3) return;
        onAsk(question);
        setQuestion('');
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Question
      </label>
      <input id={id} className="input flex-1" placeholder={placeholder} value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} disabled={busy} autoFocus={autoFocus} />
      <button type="submit" className="btn-primary" disabled={busy || question.trim().length < 3}>
        {busy ? 'Thinking…' : 'Ask'}
      </button>
    </form>
  );
}

export function AskPanel({ machineId }: { machineId?: string } = {}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busy = turns.some((t) => t.pending);
  const examples = machineId ? MACHINE_EXAMPLES : PLANT_EXAMPLES;
  const title = `✦ Ask FactoryPilot ${machineId ? `about ${machineId}` : 'about the plant'}`;
  const placeholder = machineId ? 'Ask about this machine…' : 'Ask about production, quality, incidents…';

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    setOpen(true);
    setTurns((t) => [{ q: text, pending: true }, ...t].slice(0, 6));
    const st = useStore.getState();
    const memory = localMemory.all();
    // RAG: manual pages and past interventions relevant to this question and the machines in trouble.
    const inTrouble = [
      ...Object.values(st.incidents).filter((i) => i.status !== 'chiuso' && i.status !== 'rifiutato').map((i) => i.causalPath[0] ?? i.machineId),
      ...Object.keys(st.bypassed),
      ...Object.values(st.lines).flatMap((l) => (l.trippedBy ? [l.trippedBy.machineId] : [])),
    ];
    const docs = retrieve(text, st.factory, MANUALS, memory, inTrouble, machineId);
    const context = { ...buildContext(st, machineId, machineId ? memory : []), documents: { about: docs.machines, manualPages: docs.manualPages, pastInterventions: docs.interventions } };
    // In parallel: the Evolus knowledge library searches the manuals and past interventions (slower, shown when ready).
    setTurns((t) => t.map((x) => (x.q === text && x.pending ? { ...x, kb: { pending: true } } : x)));
    void fetch('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, machines: docs.machines }) })
      .then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as { ok?: boolean; data?: { text: string; latencyMs: number }; error?: string } }))
      .catch(() => ({ status: 0, body: { ok: false, error: 'Knowledge library unreachable' } as { ok?: boolean; data?: { text: string; latencyMs: number }; error?: string } }))
      .then(({ status, body }) =>
        setTurns((t) =>
          t.map((x) =>
            x.q === text ? { ...x, kb: status === 503 ? { off: true } : body.ok && body.data ? { text: body.data.text, latencyMs: body.data.latencyMs } : { error: body.error ?? 'Knowledge library error' } } : x,
          ),
        ),
      );
    // The scope carries the coarse plant state, so a recorded answer is only replayed in the same situation.
    const plantState =
      st.plant.lines
        .map((l) => (!st.lines[l.id]?.running ? `${l.id} stopped` : Object.values(st.bypassed).some((b) => b.lineId === l.id) ? `${l.id} bypass` : null))
        .filter(Boolean)
        .join(', ') || 'all lines running';
    const scope = machineId ? `machine ${machineId} (${st.statuses[machineId] ?? 'unknown'})` : `plant ${st.factory.id} (${plantState})`;
    const res = await enqueuePost<AskAnswer>('/api/ask', { question: text, scope, context, replay: st.replay });
    if (res.ok && res.meta) st.logLlm(res.meta);
    setTurns((t) => t.map((x) => (x.q === text && x.pending ? (res.ok ? { q: text, a: res.data, meta: res.meta, kb: x.kb } : { q: text, error: res.error, kb: x.kb }) : x)));
  };

  const chips = (
    <div className="flex flex-wrap gap-1.5">
      {examples.map((q) => (
        <button key={q} type="button" className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/10 disabled:opacity-50" onClick={() => void ask(q)} disabled={busy}>
          {q}
        </button>
      ))}
    </div>
  );

  return (
    <section className="card p-3" aria-label="Ask FactoryPilot" data-tour="ask">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-title">{title}</h2>
        <span className="text-[10px] text-slate-500">AI on AMD Token Factory · answers from the live data, the technical manuals and the factory memory, with verified sources</span>
      </div>
      <QuestionForm id={`ask-${machineId ?? 'plant'}`} busy={busy} onAsk={(q) => void ask(q)} placeholder={placeholder} />
      <div className="mt-2">{chips}</div>
      {turns.length > 0 && !open && (
        <button type="button" className="mt-2 text-xs text-sky-400 hover:underline" onClick={() => setOpen(true)}>
          Show the conversation ({turns.length})
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-label={title}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialogRef.current && setOpen(false)}
        className="m-auto w-[min(760px,calc(100vw-32px))] rounded-xl border border-slate-700 bg-slate-950 p-0 text-slate-100 backdrop:bg-black/60"
      >
        <div className="flex max-h-[80vh] flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button type="button" className="rounded px-2 py-1 text-slate-400 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>
          <ol className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
            {turns.map((t, i) => (
              <li key={`${t.q}-${i}`} className="rounded-lg bg-slate-900/70 p-3 ring-1 ring-inset ring-white/5">
                <p className="text-sm font-medium text-sky-300">{t.q}</p>
                {t.pending && <p className="mt-1 animate-pulse text-sm text-slate-400">Reading the plant data…</p>}
                {t.kb && !t.kb.off && (
                  <div className="order-last mt-2 rounded-md border border-violet-400/20 bg-violet-500/5 p-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">📚 Knowledge library · Evolus</p>
                    {t.kb.pending && <p className="mt-1 animate-pulse text-xs text-slate-400">Searching the manuals and past interventions…</p>}
                    {t.kb.error && <p className="mt-1 text-xs text-amber-300">{t.kb.error}</p>}
                    {t.kb.text && (
                      <>
                        <p className="mt-1 max-h-60 overflow-auto whitespace-pre-line text-xs leading-relaxed text-slate-200">{t.kb.text}</p>
                        <p className="mt-1 text-[10px] text-slate-500">{((t.kb.latencyMs ?? 0) / 1000).toFixed(1)} s · RAG over the uploaded manuals and closed interventions</p>
                      </>
                    )}
                  </div>
                )}
                {t.error && <p className="mt-1 text-sm text-amber-300">{t.error}</p>}
                {t.a && (
                  <div className="mt-1.5 space-y-2 text-sm">
                    <p className="whitespace-pre-line leading-relaxed text-slate-100">{t.a.answer}</p>
                    {t.a.evidence.length > 0 && (
                      <ul className="flex flex-wrap gap-1">
                        {t.a.evidence.map((e) => (
                          <li key={e} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
                            {e}
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.a.sources?.length > 0 && (
                      <ul className="flex flex-wrap gap-1" aria-label="Sources">
                        {t.a.sources.map((src, k) => {
                          const st = useStore.getState();
                          const ok = verifySource(src, st.factory, MANUALS, localMemory.all());
                          const mem = src.type === 'memory' ? localMemory.all().find((e) => e.id === src.ref) : undefined;
                          return (
                            <li
                              key={k}
                              className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${ok ? 'bg-sky-500/10 text-sky-200 ring-sky-400/30' : 'bg-amber-500/10 text-amber-200 ring-amber-400/30'}`}
                              title={ok ? 'Source verified' : 'This source does not exist: not verified'}
                            >
                              {src.type === 'manual' ? `📖 ${src.ref} manual p. ${src.page ?? '?'}` : `🗂 intervention ${mem ? mem.closedAt.slice(0, 10) : src.ref}`} {ok ? '✓' : '⚠ not verified'}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {t.a.next_step && (
                      <p className="rounded-md bg-emerald-500/10 px-2 py-1.5 text-sm text-emerald-200">
                        <span className="font-semibold">Next step:</span> {t.a.next_step}
                      </p>
                    )}
                    {t.meta && (
                      <p className="text-[11px] text-slate-500">
                        {(t.meta.latencyMs / 1000).toFixed(1)} s{t.meta.replay ? ' · recorded answer (replay)' : ' · live on AMD'}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="space-y-2 border-t border-white/10 p-4">
            <QuestionForm id={`ask-modal-${machineId ?? 'plant'}`} busy={busy} onAsk={(q) => void ask(q)} placeholder="Ask a follow-up question…" autoFocus />
            {chips}
          </div>
        </div>
      </dialog>
    </section>
  );
}
