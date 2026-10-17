// Usage: node skab_stats.mjs <SKAB data dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const COLS = ['Accelerometer1RMS', 'Accelerometer2RMS', 'Current', 'Pressure', 'Temperature', 'Thermocouple', 'Voltage', 'Volume Flow RateRMS'];

function load(f) {
  const [head, ...rows] = readFileSync(join(dir, f), 'utf8').trim().split(/\r?\n/);
  const h = head.split(';');
  return rows.map((r) => {
    const v = r.split(';');
    const o = { t: Date.parse(v[0].replace(' ', 'T')) / 1000 };
    h.slice(1).forEach((k, i) => (o[k] = Number(v[i + 1])));
    return o;
  });
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(1) : Math.abs(x) >= 1 ? x.toFixed(3) : x.toFixed(4));
// least-squares slope (units per second)
function slope(rows, k) {
  const t0 = rows[0].t, xs = rows.map((r) => r.t - t0), ys = rows.map((r) => r[k]);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den ? num / den : 0;
}
// short-term noise: std of first differences / sqrt(2) (removes slow drift)
const noise = (a) => std(a.slice(1).map((x, i) => x - a[i])) / Math.SQRT2;

console.log('=== anomaly-free baseline');
const free = load('anomaly-free/anomaly-free.csv');
const dt = mean(free.slice(1).map((r, i) => r.t - free[i].t));
console.log(`rows ${free.length}, sample period ${dt.toFixed(2)} s`);
console.log('channel | mean | std | noise(diff) | cv% | p1 | p99');
for (const k of COLS) {
  const a = free.map((r) => r[k]);
  console.log(`${k} | ${fmt(mean(a))} | ${fmt(std(a))} | ${fmt(noise(a))} | ${(100 * noise(a) / Math.abs(mean(a))).toFixed(2)} | ${fmt(q(a, 0.01))} | ${fmt(q(a, 0.99))}`);
}

const files = [
  ['other/5.csv', 'imbalance sharp'], ['other/6.csv', 'imbalance linear'], ['other/7.csv', 'imbalance step'],
  ['other/9.csv', 'imbalance exponential'], ['other/12.csv', 'drain to cavitation'], ['other/13.csv', 'two-phase cavitation'],
  ['other/14.csv', 'hot water supply'], ['valve1/1.csv', 'inlet valve closed'], ['valve2/1.csv', 'outlet valve closed'],
];
for (const [f, label] of files) {
  const rows = load(f);
  const normal = rows.filter((r) => r.anomaly === 0), anom = rows.filter((r) => r.anomaly === 1);
  if (!anom.length) continue;
  const dur = anom.at(-1).t - anom[0].t;
  console.log(`\n=== ${f} – ${label}: normal ${normal.length}, anomaly ${anom.length} rows (${dur.toFixed(0)} s)`);
  console.log('channel | normal mean | anomaly mean | Δ% | Δ in σ(normal) | max Δ% | slope/s in anomaly (% of normal mean)');
  for (const k of COLS) {
    const n = normal.map((r) => r[k]), a = anom.map((r) => r[k]);
    const m0 = mean(n), s0 = std(n) || 1e-9;
    const d = mean(a) - m0;
    const maxd = Math.max(...a.map((x) => Math.abs(x - m0)));
    const sl = slope(anom, k);
    console.log(`${k} | ${fmt(m0)} | ${fmt(mean(a))} | ${(100 * d / Math.abs(m0)).toFixed(1)} | ${(d / s0).toFixed(1)} | ${(100 * maxd / Math.abs(m0)).toFixed(1)} | ${(100 * sl / Math.abs(m0)).toFixed(3)}`);
  }
}
