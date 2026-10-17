/**
 * Parser_Configurazione + Serializzatore_Configurazione (Req 1).
 * Pure: no I/O. Returns a discriminated result, never a partial config.
 */
import { FactoryConfigSchema } from '@/shared/schemas';
import type { FactoryConfig } from '@/shared/types';

export interface ConfigError {
  path: string;
  message: string;
}

export type ParseResult = { ok: true; config: FactoryConfig } | { ok: false; errors: ConfigError[] };

/** Converts a character offset into 1-based line/column. */
function lineCol(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length, col: (before[before.length - 1]?.length ?? 0) + 1 };
}

/**
 * Finds the offset of the first JSON syntax error. Engines differ in what JSON.parse reports
 * (V8 in Node 22 often omits the position), so we locate it ourselves (Req 1.9).
 */
function errorOffset(text: string, msg: string): number {
  const m = /position (\d+)/.exec(msg);
  if (m) return Number(m[1]);
  const tok = /Unexpected token '(.)'/.exec(msg);
  if (tok) {
    // First occurrence of the offending token outside a string literal.
    let inStr = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"' && text[i - 1] !== '\\') inStr = !inStr;
      else if (!inStr && c === tok[1]) return i;
    }
  }
  if (/end of (JSON )?input/i.test(msg)) return text.length;
  return -1;
}

function syntaxError(text: string, err: unknown): ConfigError {
  const msg = err instanceof Error ? err.message : String(err);
  const lc = /line (\d+) column (\d+)/.exec(msg);
  if (lc) return { path: '$', message: `Invalid JSON (line ${lc[1]}, column ${lc[2]}): ${msg}` };
  const off = errorOffset(text, msg);
  if (off >= 0) {
    const { line, col } = lineCol(text, off);
    return { path: '$', message: `Invalid JSON (line ${line}, column ${col}): ${msg}` };
  }
  return { path: '$', message: `Invalid JSON: ${msg}` };
}

/** Semantic checks beyond the schema: duplicates, references, symmetry, cycles. */
export function validateGraph(config: FactoryConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  const ids = new Set<string>();
  config.machines.forEach((m, i) => {
    if (ids.has(m.id)) errors.push({ path: `machines[${i}].id`, message: `duplicate id: ${m.id}` });
    ids.add(m.id);
    const sensorIds = new Set<string>();
    m.sensors.forEach((s, j) => {
      if (sensorIds.has(s.id))
        errors.push({ path: `machines[${i}].sensors[${j}].id`, message: `duplicate sensor: ${s.id}` });
      sensorIds.add(s.id);
    });
  });
  if (errors.length) return errors;

  const byId = new Map(config.machines.map((m) => [m.id, m]));
  config.machines.forEach((m, i) => {
    for (const [field, other] of [
      ['upstream', 'downstream'],
      ['downstream', 'upstream'],
    ] as const) {
      m[field].forEach((ref, j) => {
        const target = byId.get(ref);
        if (!target) {
          errors.push({ path: `machines[${i}].${field}[${j}]`, message: `${m.id} → unknown machine ${ref}` });
        } else if (!target[other].includes(m.id)) {
          errors.push({
            path: `machines[${i}].${field}[${j}]`,
            message: `asymmetric link: ${m.id}.${field} contains ${ref} but ${ref}.${other} does not contain ${m.id}`,
          });
        }
      });
    }
  });
  if (errors.length) return errors;

  // Cycle detection on downstream edges (DFS with colors).
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  let cycle: string[] | null = null;
  const visit = (id: string): void => {
    if (cycle) return;
    color.set(id, 1);
    stack.push(id);
    for (const next of byId.get(id)!.downstream) {
      const c = color.get(next) ?? 0;
      if (c === 1) {
        cycle = [...stack.slice(stack.indexOf(next)), next];
        return;
      }
      if (c === 0) visit(next);
      if (cycle) return;
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const m of config.machines) if ((color.get(m.id) ?? 0) === 0) visit(m.id);
  if (cycle) errors.push({ path: 'machines', message: `cycle between machines: ${(cycle as string[]).join(' → ')}` });

  config.faults.forEach((f, i) => {
    const m = byId.get(f.machineId);
    if (!m) {
      errors.push({ path: `faults[${i}].machineId`, message: `unknown machine ${f.machineId}` });
      return;
    }
    f.effects.forEach((e, j) => {
      if (!m.sensors.some((s) => s.id === e.sensorId))
        errors.push({ path: `faults[${i}].effects[${j}].sensorId`, message: `sensor ${e.sensorId} not found on ${m.id}` });
    });
  });
  return errors;
}

/** Validates an already-parsed JS value. */
export function parseConfigValue(value: unknown): ParseResult {
  const res = FactoryConfigSchema.safeParse(value);
  if (!res.success) {
    return {
      ok: false,
      errors: res.error.issues.map((iss) => ({
        path: iss.path.length ? iss.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '') : '$',
        message: iss.message,
      })),
    };
  }
  const graphErrors = validateGraph(res.data);
  return graphErrors.length ? { ok: false, errors: graphErrors } : { ok: true, config: res.data };
}

/** Parses JSON text into a validated FactoryConfig (Req 1.2–1.5, 1.9, 1.10). */
export function parseConfig(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [syntaxError(text, err)] };
  }
  return parseConfigValue(value);
}

/** Serializes a FactoryConfig into schema-conformant JSON (Req 1.6). */
export function serializeConfig(config: FactoryConfig): string {
  return JSON.stringify(config, null, 2);
}
