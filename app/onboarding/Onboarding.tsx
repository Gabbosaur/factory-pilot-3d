'use client';
/** Modulo_Onboarding UI (Req 16): PDF + CSV → AI draft → edit thresholds/links → validate → activate. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { parseCsv } from '@/modules/onboarding/csv';
import { pdfToMarkdown } from '@/modules/onboarding/pdfText';
import { parseConfigValue } from '@/modules/monitoring/config/parser';
import { useStore } from '@/modules/store';
import type { FactoryConfig } from '@/shared/types';

const TIMEOUT_MS = 300_000; // Req 16.7

export function Onboarding() {
  const router = useRouter();
  const addFactory = useStore((s) => s.addFactory);
  const replay = useStore((s) => s.replay);
  const [name, setName] = useState('New factory');
  const [pdf, setPdf] = useState<File | null>(null);
  const [csvText, setCsvText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [draft, setDraft] = useState<FactoryConfig | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => useStore.getState().hydrate(), []);

  async function loadSample() {
    setCsvText(await (await fetch('/onboarding-sample.csv')).text());
    setName('CNC machining cell');
  }

  async function generate() {
    setErrors([]);
    setDraft(null);
    const csv = parseCsv(csvText);
    if (!csv.ok) return setErrors([csv.error]); // Req 16.4, 16.8 – no API call
    let manualText = '';
    const t0 = Date.now();
    try {
      if (pdf) {
        setBusy('Extracting text from the PDF in your browser…');
        manualText = await pdfToMarkdown(pdf);
      }
      setBusy('Generating the configuration on AMD Token Factory…');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let body: { ok: boolean; data?: FactoryConfig; error?: string; details?: string[]; retryable?: boolean; retryAfterMs?: number };
      // Browser-side retry for the serverless deadline contract (Req 17.14)
      for (let attempt = 0; ; attempt++) {
        const res = await fetch('/api/onboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ factoryName: name, manualText, rows: csv.rows, replay }),
          signal: ctrl.signal,
        });
        body = await res.json();
        if (!body.ok && body.retryable && attempt < 3) {
          await new Promise((r) => setTimeout(r, body.retryAfterMs ?? 3000));
          continue;
        }
        break;
      }
      clearTimeout(timer);
      if (!body.ok || !body.data) return setErrors([body.error ?? 'Automatic generation unavailable', ...(body.details ?? [])]);
      setDraft(body.data);
      setElapsed(Math.round((Date.now() - t0) / 1000));
    } catch (e) {
      setErrors([e instanceof DOMException && e.name === 'AbortError' ? 'Generation took more than 5 minutes and was stopped' : e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(null);
    }
  }

  function activate() {
    if (!draft) return;
    const r = parseConfigValue(draft); // Req 16.10
    if (!r.ok) return setErrors(r.errors.map((e) => `${e.path}: ${e.message}`));
    addFactory(r.config);
    router.push('/');
  }

  const updateSensor = (mi: number, si: number, key: 'warn' | 'crit', v: number) =>
    setDraft((d) => {
      if (!d) return d;
      const c = structuredClone(d);
      c.machines[mi]!.sensors[si]![key] = v;
      return c;
    });

  const toggleLink = (from: string, to: string) =>
    setDraft((d) => {
      if (!d) return d;
      const c = structuredClone(d);
      const a = c.machines.find((m) => m.id === from)!;
      const b = c.machines.find((m) => m.id === to)!;
      if (a.downstream.includes(to)) {
        a.downstream = a.downstream.filter((x) => x !== to);
        b.upstream = b.upstream.filter((x) => x !== from);
      } else {
        a.downstream.push(to);
        b.upstream.push(from);
      }
      return c;
    });

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Onboard a factory in 5 minutes</h1>
        <Link href="/" className="btn-ghost">
          ← Back to the map
        </Link>
      </div>
      <p className="text-sm text-slate-400">
        Upload the equipment manual (a PDF with real text) and the sensor list (CSV with columns <code>machine_id, sensor_name, unit</code>, optional <code>machine_name</code>). The AI drafts machines, thresholds, links and the 3D map; you review and confirm.
      </p>

      <section className="grid gap-3 rounded-lg border border-slate-800 p-4 md:grid-cols-2">
        <div>
          <label htmlFor="ob-name" className="block text-xs text-slate-400">
            Factory name
          </label>
          <input id="ob-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <div>
          <label htmlFor="ob-pdf" className="block text-xs text-slate-400">
            Manual PDF (optional, max 20 MB)
          </label>
          <input id="ob-pdf" type="file" accept="application/pdf" className="text-sm" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
        </div>
        <div className="md:col-span-2">
          <div className="flex items-end justify-between">
            <label htmlFor="ob-csv" className="block text-xs text-slate-400">
              Sensor list CSV
            </label>
            <div className="flex gap-2 text-xs">
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="Upload CSV file"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f && f.size > 1024 * 1024) return setErrors(['The CSV exceeds 1 MB']);
                  if (f) setCsvText(await f.text());
                }}
              />
              <button type="button" className="btn-ghost" onClick={loadSample}>
                Use sample (CNC cell)
              </button>
            </div>
          </div>
          <textarea id="ob-csv" className="input h-32 font-mono text-xs" value={csvText} onChange={(e) => setCsvText(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <button type="button" className="btn-primary" onClick={generate} disabled={Boolean(busy) || !csvText.trim()}>
            Generate configuration
          </button>
          {busy && (
            <span role="status" className="ml-3 animate-pulse text-sm text-sky-300">
              {busy}
            </span>
          )}
        </div>
      </section>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc rounded bg-red-950/60 p-3 pl-6 text-sm text-red-200">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {draft && (
        <section className="space-y-3 rounded-lg border border-sky-800 p-4" aria-labelledby="draft-h">
          <h2 id="draft-h" className="font-semibold">
            Draft: {draft.name} · {draft.machines.length} machines {elapsed !== null && <span className="text-xs text-slate-400">· generated in {elapsed} s</span>}
          </h2>
          {draft.machines.map((m, mi) => (
            <div key={m.id} className="rounded bg-slate-900 p-2 text-sm">
              <div className="font-medium">
                {m.id} · {m.name} <span className="text-xs text-slate-400">({m.type.replace(/_/g, ' ')})</span>
              </div>
              <div className="my-1 flex flex-wrap gap-1 text-xs">
                <span className="text-slate-400">Feeds into:</span>
                {draft.machines
                  .filter((o) => o.id !== m.id)
                  .map((o) => (
                    <label key={o.id} className="flex items-center gap-1">
                      <input type="checkbox" checked={m.downstream.includes(o.id)} onChange={() => toggleLink(m.id, o.id)} /> {o.id}
                    </label>
                  ))}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="text-left font-normal">Sensor</th>
                    <th className="font-normal">Nominal</th>
                    <th className="font-normal">Warning</th>
                    <th className="font-normal">Critical</th>
                  </tr>
                </thead>
                <tbody>
                  {m.sensors.map((s, si) => (
                    <tr key={s.id}>
                      <td>
                        {s.name} [{s.unit}]
                      </td>
                      <td className="text-center">
                        {s.nominal[0]}–{s.nominal[1]}
                      </td>
                      {(['warn', 'crit'] as const).map((k) => (
                        <td key={k} className="text-center">
                          <input
                            type="number"
                            step="any"
                            aria-label={`${s.name} ${k === 'warn' ? 'warning' : 'critical'} threshold`}
                            className="w-20 rounded bg-slate-800 px-1"
                            value={s[k]}
                            onChange={(e) => updateSensor(mi, si, k, Number(e.target.value))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <button type="button" className="btn-primary" onClick={activate}>
            Confirm and open the 3D map
          </button>
        </section>
      )}
    </main>
  );
}
