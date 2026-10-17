// Usage: node skab_ramp.mjs <csv> <column>  – 10 s rolling mean vs time since anomaly start
import { readFileSync } from 'node:fs';
const [f, col] = process.argv.slice(2);
const [head, ...rows] = readFileSync(f, 'utf8').trim().split(/\r?\n/);
const h = head.split(';'), ci = h.indexOf(col), ai = h.indexOf('anomaly');
const d = rows.map((r) => r.split(';')).map((v) => ({ t: Date.parse(v[0].replace(' ', 'T')) / 1000, x: +v[ci], a: +v[ai] }));
const s = d.findIndex((r) => r.a === 1), t0 = d[s].t;
const base = d.slice(0, s).map((r) => r.x).reduce((a, b) => a + b, 0) / s;
const out = [];
for (const dt of [0, 5, 10, 20, 30, 60, 90, 120, 180, 240, 300, 360, 420]) {
  const w = d.filter((r) => r.t >= t0 + dt && r.t < t0 + dt + 10).map((r) => r.x);
  if (w.length) out.push(`+${dt}s ${(w.reduce((a, b) => a + b, 0) / w.length / base).toFixed(2)}x`);
}
console.log(f.split(/[\/]/).slice(-2).join('/'), col, 'baseline', base.toFixed(4), '|', out.join('  '));
