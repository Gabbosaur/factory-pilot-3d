// Usage: node emt_stats.mjs <measures_v2.csv> – thermal dynamics of stator winding (2 Hz samples)
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
const rl = createInterface({ input: createReadStream(process.argv[2]) });
let h; const prof = new Map();
for await (const line of rl) {
  const v = line.split(',');
  if (!h) { h = v; continue; }
  const o = Object.fromEntries(h.map((k, i) => [k, +v[i]]));
  if (!prof.has(o.profile_id)) prof.set(o.profile_id, []);
  prof.get(o.profile_id).push(o);
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const all = [...prof.values()].flat();
const W = 120; // 60 s at 2 Hz
const rates = [], noises = [], curr = [];
for (const rows of prof.values()) {
  const T = rows.map((r) => r.stator_winding);
  for (let i = W; i < T.length; i += 20) rates.push((T[i] - T[i - W]) / 60);
  noises.push(std(T.slice(1).map((x, i) => x - T[i])) / Math.SQRT2);
  rows.forEach((r) => curr.push(Math.hypot(r.i_d, r.i_q)));
}
console.log(`profiles ${prof.size}, rows ${all.length}, hours ${(all.length / 2 / 3600).toFixed(1)}`);
for (const k of ['stator_winding', 'stator_yoke', 'pm', 'coolant', 'ambient']) {
  const a = all.map((r) => r[k]);
  console.log(`${k}: p1 ${q(a, .01).toFixed(1)} p50 ${q(a, .5).toFixed(1)} p99 ${q(a, .99).toFixed(1)} max ${a.reduce((m, x) => (x > m ? x : m), -Infinity).toFixed(1)} °C`);
}
console.log(`winding temp sample noise (diff): median ${q(noises, .5).toFixed(3)} °C`);
console.log(`winding heating rate over 60 s: p50 ${q(rates, .5).toFixed(3)} p90 ${q(rates, .9).toFixed(3)} p99 ${q(rates, .99).toFixed(3)} max ${rates.reduce((m, x) => (x > m ? x : m), -Infinity).toFixed(3)} °C/s`);
console.log(`current |i|: p50 ${q(curr, .5).toFixed(0)} p99 ${q(curr, .99).toFixed(0)} A`);
// steady-state rise above coolant vs load: profiles' last 10 min
const rise = [...prof.values()].filter((r) => r.length > 2400).map((r) => { const t = r.slice(-1200); return [mean(t.map((x) => Math.hypot(x.i_d, x.i_q))), mean(t.map((x) => x.stator_winding - x.coolant))]; });
rise.sort((a, b) => a[0] - b[0]);
console.log('steady rise over coolant by current (A → °C):', rise.filter((_, i) => i % Math.ceil(rise.length / 8) === 0).map(([c, r]) => `${c.toFixed(0)}→${r.toFixed(0)}`).join('  '));
