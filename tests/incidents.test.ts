import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { escalation } from '@/modules/incidents/escalation';
import { autonomyMode } from '@/modules/incidents/autonomy';
import { priorityScore, computeImpact } from '@/modules/incidents/impact';
import { rootCause } from '@/modules/incidents/rootCause';
import { parsePages, renderPages, verifyCitation } from '@/modules/incidents/manual';
import { filterSimilar } from '@/modules/incidents/memory/filter';
import { DiagnosisSchema } from '@/shared/schemas';
import type { Diagnosis, FactoryConfig, MachineStatus, MemoryEntry, RiskLevel } from '@/shared/types';
import bottling from '@/data/factories/bottling-line.json';
import { parseConfigValue } from '@/modules/monitoring/config/parser';

const risk = fc.constantFrom<RiskLevel>('basso', 'medio', 'alto');
const action = fc.constantFrom('riduci_velocita', 'apri_ticket', 'pianifica_ispezione', 'intervento_manutentivo' as const);
const level = fc.constantFrom('L0', 'L1', 'L2' as const);
const text = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
const diagnosisArb: fc.Arbitrary<Diagnosis> = fc.record({
  causa_probabile: text,
  pagina_manuale: fc.integer({ min: 1, max: 500 }),
  citazione: text,
  confidenza: fc.double({ min: 0, max: 1, noNaN: true }),
  azione_raccomandata: text,
  codice_azione: action,
  ricambi: fc.array(fc.string()),
});

describe('Property 8 – safety invariant (Req 9.5)', () => {
  it('high risk or low confidence ⇒ always escalate', () => {
    fc.assert(
      fc.property(diagnosisArb, risk, fc.double({ min: 0, max: 1, noNaN: true }), (d, r, thr) => {
        const dec = escalation(d, { livello_rischio: r, motivazione: 'x' }, thr);
        if (r === 'alto' || d.confidenza < thr) expect(dec.escalate).toBe(true);
      }),
    );
  });
  it('missing risk or diagnosis ⇒ escalate', () => {
    fc.assert(
      fc.property(diagnosisArb, (d) => {
        expect(escalation(d, null, 0.7).escalate).toBe(true);
      }),
    );
    expect(escalation('non_disponibile', { livello_rischio: 'basso', motivazione: 'x' }, 0.7).escalate).toBe(true);
  });
});

describe('Property 9 – bounded autonomy (Req 10.5, 10.6)', () => {
  it('never autonomous with escalation or non-whitelisted action', () => {
    fc.assert(
      fc.property(level, action, fc.boolean(), (l, a, esc) => {
        const mode = autonomyMode(l, { escalate: esc, reasons: esc ? ['rischio_alto'] : [] }, a);
        if (esc || a === 'intervento_manutentivo') expect(mode).not.toBe('esegui_e_notifica');
      }),
    );
  });
});

describe('Property 11 – monotonic priority (Req 13.3, 13.4)', () => {
  it('increasing in cost and in risk', () => {
    const order: RiskLevel[] = ['basso', 'medio', 'alto'];
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.double({ min: 0, max: 1e6, noNaN: true }), risk, risk, (c1, c2, r1, r2) => {
        if (c1 <= c2) expect(priorityScore(c1, r1)).toBeLessThanOrEqual(priorityScore(c2, r1));
        if (order.indexOf(r1) <= order.indexOf(r2)) expect(priorityScore(c1, r1)).toBeLessThanOrEqual(priorityScore(c1, r2));
      }),
    );
  });
});

// Random DAG: machines m0..mn with edges only from lower to higher index.
const dagArb = fc.integer({ min: 2, max: 8 }).chain((n) =>
  fc
    .array(fc.tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 })), { maxLength: 15 })
    .map((pairs) => {
      const edges = new Set(pairs.filter(([a, b]) => a < b).map(([a, b]) => `${a}>${b}`));
      const machines = Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        name: `M${i}`,
        type: 't',
        position: [i, 0, 0] as [number, number, number],
        size: [1, 1, 1] as [number, number, number],
        upstream: [...edges].filter((e) => e.endsWith(`>${i}`)).map((e) => `m${e.split('>')[0]}`),
        downstream: [...edges].filter((e) => e.startsWith(`${i}>`)).map((e) => `m${e.split('>')[1]}`),
        downtimeCostPerMin: 10,
        partsPerMin: 10,
        manualRef: 'x',
        sensors: [],
      }));
      return { n, config: { id: 'f', name: 'f', impactHorizonMin: 60, confidenceThreshold: 0.7, zThresholds: { warn: 2.5, crit: 3.5 }, autonomy: {}, machines, faults: [] } as FactoryConfig };
    }),
);

describe('Property 10 – valid causal path (Req 12.3)', () => {
  it('each step is a downstream link and ends at the alarm machine', () => {
    fc.assert(
      fc.property(dagArb, fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 8, maxLength: 8 }), fc.nat(), ({ n, config }, starts, pick) => {
        const alarm = `m${pick % n}`;
        const statuses: Record<string, MachineStatus> = {};
        const anomalyStart: Record<string, number> = {};
        config.machines.forEach((m, i) => {
          statuses[m.id] = starts[i]! % 3 === 0 ? 'verde' : 'giallo';
          if (statuses[m.id] !== 'verde') anomalyStart[m.id] = starts[i]!;
        });
        statuses[alarm] = 'rosso';
        anomalyStart[alarm] = 1000;
        const res = rootCause(config, statuses, anomalyStart, alarm);
        expect(res.path.at(-1)).toBe(alarm);
        expect(new Set(res.path).size).toBe(res.path.length);
        for (let i = 0; i + 1 < res.path.length; i++) {
          const m = config.machines.find((x) => x.id === res.path[i])!;
          expect(m.downstream).toContain(res.path[i + 1]);
        }
      }),
    );
  });

  it('demo scenario: F1 alarm traces back to P1', () => {
    const r = parseConfigValue(bottling);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const res = rootCause(r.config, { P1: 'rosso', F1: 'rosso', C1: 'giallo', K1: 'verde' }, { P1: 100, F1: 108, C1: 116 }, 'F1');
    expect(res.path).toEqual(['P1', 'F1']);
    const imp = computeImpact(r.config, res.path, 'F1');
    expect(imp.costPerMin).toBe(40 + 90 + 40 + 20);
    expect(imp.partsAtRiskPerMin).toBe(100);
  });
});

describe('Property 5 – manual round-trip (Req 7.5)', () => {
  it('parsePages(renderPages(p)) ≡ p', () => {
    const text = fc.string().filter((s) => !s.includes('<!--') && !s.includes('-->')).map((s) => s.trim());
    fc.assert(
      fc.property(fc.array(text, { minLength: 1, maxLength: 10 }), (texts) => {
        const pages = texts.map((t, i) => ({ n: i + 1, text: t }));
        const r = parsePages(renderPages(pages));
        expect(r.ok && r.pages).toEqual(pages);
      }),
    );
  });
  it('unknown cited page ⇒ confidence 0 (Req 8.5)', () => {
    fc.assert(
      fc.property(diagnosisArb, (d) => {
        const v = verifyCitation(d, [{ n: d.pagina_manuale + 1, text: 'x' }]);
        expect(v.confidenza).toBe(0);
        expect(v.citazione_verificata).toBe(false);
      }),
    );
  });
});

describe('Property 4 – Diagnosis round-trip (Req 8.6)', () => {
  it('JSON + zod returns the same diagnosis', () => {
    fc.assert(
      fc.property(diagnosisArb, (d) => {
        expect(DiagnosisSchema.parse(JSON.parse(JSON.stringify(d)))).toEqual(d);
      }),
    );
  });
});

describe('Property 12 – memory filter (Req 15.2)', () => {
  it('≤3, same machine or type, shared sensor, newest first', () => {
    const entryArb: fc.Arbitrary<MemoryEntry> = fc.record({
      id: fc.uuid(),
      machineId: fc.constantFrom('P1', 'F1', 'K1'),
      machineType: fc.constantFrom('centrifugal_pump', 'filler', 'conveyor'),
      sensorIds: fc.subarray(['vib', 'bearing_temp', 'current', 'fill_rejects'], { minLength: 1 }),
      realCause: fc.constant('c'),
      fix: fc.constant('f'),
      durationMin: fc.integer({ min: 1, max: 1440 }),
      closedAt: fc.date({ min: new Date('2025-01-01'), max: new Date('2026-12-31'), noInvalidDate: true }).map((d) => d.toISOString()),
      isSample: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 20 }), (entries) => {
        const q = { machineId: 'P1', machineType: 'centrifugal_pump', sensorIds: ['vib'] };
        const res = filterSimilar(entries, q);
        expect(res.length).toBeLessThanOrEqual(3);
        for (const e of res) {
          expect(e.machineId === 'P1' || e.machineType === 'centrifugal_pump').toBe(true);
          expect(e.sensorIds).toContain('vib');
        }
        for (let i = 0; i + 1 < res.length; i++) expect(res[i]!.closedAt >= res[i + 1]!.closedAt).toBe(true);
      }),
    );
  });
});

import { parseCsv } from '@/modules/onboarding/csv';

describe('Onboarding CSV (Req 16.4)', () => {
  it('lists missing required columns', () => {
    const r = parseCsv('machine_id,unit\nA,bar');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.missing).toEqual(['sensor_name']);
  });
  it('handles quotes, ; separator and BOM', () => {
    const r = parseCsv('\uFEFFmachine_id;sensor_name;unit\nA;"Air; pressure";bar\n');
    expect(r.ok && r.rows).toEqual([{ machine_id: 'A', sensor_name: 'Air; pressure', unit: 'bar' }]);
  });
});
