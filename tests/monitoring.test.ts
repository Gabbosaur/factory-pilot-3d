import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseConfig, parseConfigValue, serializeConfig } from '@/modules/monitoring/config/parser';
import { Simulator } from '@/modules/monitoring/simulator/simulator';
import { AnomalyEngine } from '@/modules/monitoring/anomaly/engine';
import { AlarmSchema } from '@/shared/schemas';
import type { FactoryConfig } from '@/shared/types';
import bottling from '@/data/factories/bottling-line.json';
import twin from '@/data/factories/bottling-line-twin.json';

function load(raw: unknown): FactoryConfig {
  const r = parseConfigValue(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 1));
  return r.config;
}

describe('Configuration (Req 1)', () => {
  it('sample configurations are valid', () => {
    expect(load(bottling).machines).toHaveLength(4);
    expect(load(twin).machines).toHaveLength(5);
  });
  it('Property 1 – serialize/parse round-trip', () => {
    const c = load(bottling);
    const r = parseConfig(serializeConfig(c));
    expect(r.ok && r.config).toEqual(c);
  });
  it('Property 2 – cycle, missing reference and duplicate are rejected', () => {
    const base = load(bottling);
    const cyc = structuredClone(base);
    cyc.machines[3]!.downstream = ['P1'];
    cyc.machines[0]!.upstream = ['K1'];
    const cycRes = parseConfigValue(cyc);
    expect(cycRes.ok).toBe(false);
    expect(!cycRes.ok && cycRes.errors[0]!.message).toMatch(/cycle/);

    const miss = structuredClone(base);
    miss.machines[0]!.downstream = ['ZZ'];
    expect(parseConfigValue(miss).ok).toBe(false);

    const dup = structuredClone(base);
    dup.machines[1]!.id = 'P1';
    expect(parseConfigValue(dup).ok).toBe(false);
  });
  it('invalid JSON reports line and column', () => {
    const r = parseConfig('{\n  "id": ,\n}');
    expect(r.ok).toBe(false);
    // The stray comma is on line 2, column 9 of '{\n  "id": ,\n}'.
    expect(!r.ok && r.errors[0]!.message).toMatch(/Invalid JSON \(line 2, column 9\)/);
  });
});

describe('Simulator (Req 2)', () => {
  it('Property 7 – deterministic for the same seed and commands', () => {
    const c = load(bottling);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), fc.integer({ min: 0, max: 30 }), (seed, injectAt) => {
        const run = () => {
          const s = new Simulator(c, seed, 0);
          const out: number[] = [];
          for (let t = 0; t < 60; t++) {
            if (t === injectAt) s.inject('p1-bearing');
            out.push(...s.step().map((x) => x.value));
          }
          return out;
        };
        expect(run()).toEqual(run());
      }),
      { numRuns: 20 },
    );
  });
  it('without faults values stay in the nominal range', () => {
    const c = load(bottling);
    const s = new Simulator(c, 7, 0);
    for (let t = 0; t < 200; t++)
      for (const smp of s.step()) {
        const sc = c.machines.find((m) => m.id === smp.machineId)!.sensors.find((x) => x.id === smp.sensorId)!;
        expect(smp.value).toBeGreaterThanOrEqual(sc.nominal[0]);
        expect(smp.value).toBeLessThanOrEqual(sc.nominal[1]);
      }
  });
  it('rejects a second fault on the same machine and unknown faults (Req 2.8)', () => {
    const s = new Simulator(load(bottling), 1, 0);
    expect(s.inject('p1-bearing').ok).toBe(true);
    expect(s.inject('p1-bearing').ok).toBe(false);
    expect(s.inject('nope').ok).toBe(false);
  });
});

describe('Anomaly engine (Req 3)', () => {
  it('Property 6 – no alarm and green status without faults', () => {
    const c = load(bottling);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        const s = new Simulator(c, seed, 0);
        const e = new AnomalyEngine(c);
        let alarms = 0;
        for (let t = 0; t < 150; t++) alarms += e.ingest(s.step()).alarms.length;
        // Uniform noise inside the nominal range can still produce |z| > 2.5 rarely? No: uniform on
        // [-a, a] has |z| ≤ √3 ≈ 1.73, so the invariant must hold strictly.
        expect(alarms).toBe(0);
        expect(Object.values(e.getAllStatuses()).every((st) => st === 'verde')).toBe(true);
      }),
      { numRuns: 15 },
    );
  });

  it('scenario A: P1 turns red first, then F1; alarms are valid', () => {
    const c = load(bottling);
    const s = new Simulator(c, 42, 0);
    const e = new AnomalyEngine(c);
    for (let t = 0; t < 70; t++) e.ingest(s.step());
    s.inject('p1-bearing');
    const firstRed: Record<string, number> = {};
    for (let t = 70; t < 130; t++) {
      const ev = e.ingest(s.step());
      for (const ch of ev.statusChanges) if (ch.status === 'rosso' && !(ch.machineId in firstRed)) firstRed[ch.machineId] = t;
      for (const a of ev.alarms) expect(AlarmSchema.safeParse(a).success).toBe(true);
    }
    expect(firstRed.P1).toBeDefined();
    expect(firstRed.F1).toBeDefined();
    expect(firstRed.P1!).toBeLessThan(firstRed.F1!);
    const starts = e.getAnomalyStarts();
    expect(starts.P1!).toBeLessThan(starts.F1!);
  });

  it('drops invalid samples (Req 3.9) and rejects inconsistent z thresholds (Req 3.10)', () => {
    const e = new AnomalyEngine(load(bottling));
    const ev = e.ingest([{ machineId: 'P1', sensorId: 'vib', value: Number.NaN, ts: 1 }, { machineId: 'XX', sensorId: 'vib', value: 1, ts: 1 }]);
    expect(ev.rejected).toHaveLength(2);
    expect(e.setZThresholds(3.5, 2.5).ok).toBe(false);
  });
});
