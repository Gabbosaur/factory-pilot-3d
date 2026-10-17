/**
 * Generates realistic synthetic sensor datasets for the four machines of the bottling line
 * (48 h, one sample every 10 s, labelled fault episodes). Deterministic (fixed seed).
 * Parameters come from data/CALIBRATION.md (SKAB, Electric Motor Temperature, ISO 10816-1, nameplates).
 * Run: npx tsx scripts/generate-datasets.ts   → data/datasets/*.csv
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mulberry32 } from '../modules/monitoring/simulator/simulator';

const DT = 10; // s per sample
const HOURS = 48;
const N = (HOURS * 3600) / DT;
const START = Date.parse('2026-10-12T00:00:00Z');
const rand = mulberry32(2026);

const gauss = () => {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
/** Binomial draw via normal approximation (n large enough here). */
const binom = (n: number, p: number) => Math.max(0, Math.round(n * p + Math.sqrt(n * p * (1 - p)) * gauss()));
/** First-order lag: x moves towards target with time constant tau (s). */
const lag = (x: number, target: number, tau: number) => x + (target - x) * (1 - Math.exp(-DT / tau));
/** AR(1) coloured noise generator with stationary std sigma and correlation time tau (s). */
function ar1(sigma: number, tau: number) {
  const a = Math.exp(-DT / tau), b = sigma * Math.sqrt(1 - a * a);
  let x = 0;
  return () => (x = a * x + b * gauss());
}
const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
/** Reject percentage over a rolling 5-minute window (30 samples, ~500 bottles), as line counters report it. */
function rollingRejects() {
  const win: Array<[number, number]> = [];
  return (bottles: number, rejects: number) => {
    win.push([bottles, rejects]);
    if (win.length > 300 / DT) win.shift();
    const b = win.reduce((s, x) => s + x[0], 0), k = win.reduce((s, x) => s + x[1], 0);
    return b ? (k / b) * 100 : 0;
  };
}
/** Label for samples after an episode while the machine is still above its warning level. */
const cooldown = (m: string, i: number) =>
  !episode(m, i) && [...EPISODES].filter((e) => e.machine === m && i >= e.end).sort((a, b) => b.end - a.end)[0];

// ---- production schedule: two shifts 06:00–22:00, short stops, night shutdown ----
type Mode = 'run' | 'stop';
const hourOf = (i: number) => ((i * DT) / 3600) % 24;
const shortStops = new Set<number>();
for (let i = 0; i < N; i++) {
  // ~3 micro-stops per shift (changeover, jam) lasting 3–8 min
  if (rand() < 3 / ((8 * 3600) / DT)) {
    const len = Math.round((180 + rand() * 300) / DT);
    for (let k = 0; k < len; k++) shortStops.add(i + k);
  }
}
const mode = (i: number): Mode => {
  const h = hourOf(i);
  return h >= 6 && h < 22 && !shortStops.has(i) ? 'run' : 'stop';
};
/** Ambient hall temperature: 18–26 °C daily cycle, peak at 15:00. */
const ambient = (i: number) => 22 + 4 * Math.sin(((hourOf(i) - 9) / 24) * 2 * Math.PI);

// ---- fault episodes (sample index ranges) ----
const at = (day: number, h: number, m = 0) => Math.round(((day * 24 + h) * 3600 + m * 60) / DT);
interface Episode { machine: string; type: string; start: number; end: number }
const EPISODES: Episode[] = [
  { machine: 'P1', type: 'bearing_wear', start: at(1, 9), end: at(1, 14, 30) }, // slow degradation, then maintenance
  { machine: 'P1', type: 'cavitation', start: at(0, 16, 10), end: at(0, 16, 40) }, // low tank level
  { machine: 'K1', type: 'fan_clogged', start: at(1, 17), end: at(1, 18, 30) },
  { machine: 'C1', type: 'clutch_wear', start: at(0, 10), end: at(0, 13) },
  { machine: 'F1', type: 'valve_drift', start: at(1, 7, 30), end: at(1, 8, 30) },
];
const episode = (m: string, i: number) => EPISODES.find((e) => e.machine === m && i >= e.start && i < e.end);
/** 0→1 progress inside an episode. */
const prog = (e: Episode, i: number) => (i - e.start) / (e.end - e.start);

// ---- state ----
const p1 = { vibN: ar1(0.03, 60), flowN: ar1(0.15, 120), curN: ar1(0.08, 30), tBear: 30, imb: 1.3 };
const f1 = { flowVarN: ar1(0.15, 60), tProd: 16, rej: rollingRejects() };
const c1 = { torqueN: ar1(0.03, 30), vibN: ar1(0.02, 60), wear: 0, rej: rollingRejects() };
const k1 = { tMot: 30, curN: ar1(0.03, 30), load: 0.8 };

const rows: Record<string, string[]> = {
  P1: ['timestamp,state,vib_mm_s,bearing_temp_c,current_a,flow_m3h,anomaly,fault_type'],
  F1: ['timestamp,state,bottles,fill_rejects_pct,flow_var_pct,product_temp_c,anomaly,fault_type'],
  C1: ['timestamp,state,torque_nm,rejects_pct,vib_mm_s,anomaly,fault_type'],
  K1: ['timestamp,state,motor_temp_c,current_a,speed_pct,anomaly,fault_type'],
};

for (let i = 0; i < N; i++) {
  const ts = new Date(START + i * DT * 1000).toISOString();
  const run = mode(i) === 'run';
  const amb = ambient(i);
  const st = run ? 'run' : 'stop';

  // ---------- P1 centrifugal pump (7.5 kW, 2900 rpm) ----------
  const eP = episode('P1', i);
  let vib = 0, cur = 0, flow = 0, bearTarget = amb;
  if (run) {
    const demand = 11.5 + 0.6 * Math.sin(i / 180); // m³/h, follows filler speed
    flow = demand + p1.flowN();
    vib = p1.imb + p1.vibN();
    cur = 13.2 + 0.25 * (flow - 11.5) + p1.curN();
    bearTarget = amb + 33; // ~55 °C at 22 °C ambient (manual: 50–60 °C)
    if (eP?.type === 'bearing_wear') {
      const x = prog(eP, i);
      vib *= 1 + 2.2 * x ** 2.2; // accelerating growth, ×3.2 at the end (SKAB-like magnitude)
      vib += Math.abs(gauss()) * 0.25 * x; // impacting from damaged races
      bearTarget += 38 * x ** 1.8; // up to ~90 °C before intervention
      cur += 0.9 * x; // friction
    }
    if (eP?.type === 'cavitation') {
      const x = Math.min(1, prog(eP, i) * 4);
      flow *= 1 - 0.55 * x; // SKAB other/12: flow −60 %
      vib += Math.abs(gauss()) * 0.35 * x; // broadband noise
      cur -= 2.2 * x; // less hydraulic work
    }
  }
  p1.tBear = lag(p1.tBear, bearTarget, 1200); // 20 min thermal time constant
  const p1Anom = eP && run ? 1 : 0;
  const p1Type = p1Anom ? eP!.type : p1.tBear > 70 && cooldown('P1', i) ? 'cooldown' : 'none';
  rows.P1!.push([ts, st, r(Math.max(0, vib), 3), r(p1.tBear + gauss() * 0.1, 2), r(Math.max(0, cur), 2), r(Math.max(0, flow), 2), p1Anom, p1Type].join(','));

  // ---------- F1 rotary filler (6,000 bottles/h) ----------
  const eF = episode('F1', i);
  let bottles = 0, rejPct = 0, flowVar = 0;
  if (run) {
    bottles = binom(Math.round((6000 / 3600) * DT), 0.995);
    // inlet flow variation reflects pump stability (cascade with ~1 min transport delay)
    const pumpTrouble = episode('P1', i - 6);
    flowVar = 1.0 + Math.abs(f1.flowVarN());
    let pRej = 0.005;
    if (pumpTrouble?.type === 'bearing_wear') {
      const x = prog(pumpTrouble, i - 6);
      flowVar += 7 * x ** 2;
      pRej += 0.03 * x ** 2;
    }
    if (pumpTrouble?.type === 'cavitation') { flowVar += 6; pRej += 0.025; }
    if (eF?.type === 'valve_drift') { pRej += 0.02 * prog(eF, i); }
    rejPct = f1.rej(bottles, binom(bottles, pRej));
  }
  f1.tProd = lag(f1.tProd, 14 + (amb - 22) * 0.35, 3600); // mains water, slow
  const f1Anom = (eF && run) || (run && episode('P1', i - 6)) ? 1 : 0;
  const f1Type = eF && run ? eF.type : f1Anom ? 'upstream_pump' : run && rejPct > 1.5 ? 'cooldown' : 'none';
  rows.F1!.push([ts, st, bottles, r(rejPct, 2), r(flowVar, 2), r(f1.tProd + gauss() * 0.05, 2), f1Anom, f1Type].join(','));

  // ---------- C1 capper (magnetic clutch heads) ----------
  const eC = episode('C1', i);
  let torque = 0, cRej = 0, cVib = 0;
  if (run) {
    if (eC?.type === 'clutch_wear') c1.wear = 0.9 * prog(eC, i); // Nm drift, reset by recalibration
    else c1.wear = 0;
    torque = 2.2 + c1.wear + c1.torqueN();
    cVib = 1.2 + c1.vibN();
    const fillTrouble = episode('P1', i - 12);
    const pRej = 0.003 + Math.max(0, torque - 2.6) * 0.04 + (fillTrouble ? 0.01 : 0);
    cRej = c1.rej(bottles, binom(bottles, pRej));
  }
  const upstreamC = run && episode('P1', i - 12);
  const c1Anom = (eC && run) || upstreamC ? 1 : 0;
  const c1Type = eC && run ? eC.type : upstreamC ? 'upstream_pump' : run && cRej > 1.5 ? 'cooldown' : 'none';
  rows.C1!.push([ts, st, r(torque, 3), r(cRej, 2), r(Math.max(0, cVib), 3), c1Anom, c1Type].join(','));

  // ---------- K1 outfeed conveyor (1.1 kW gear motor) ----------
  const eK = episode('K1', i);
  k1.load = run ? 0.8 + 0.08 * Math.sin(i / 90) : 0;
  let kCur = run ? 1.0 + 1.9 * k1.load + k1.curN() : 0; // no-load ~1 A, ~2.5 A at 80 % load
  let rTh = 30; // K rise at full load (EMT: 15–35 K at partial load)
  if (eK?.type === 'fan_clogged' && run) rTh *= 1 + 1.4 * Math.min(1, prog(eK, i) * 1.5);
  const tTarget = amb + rTh * (kCur / 2.6) ** 2;
  k1.tMot = lag(k1.tMot, tTarget, 900); // small motor: 15 min time constant (max slope stays < 0.7 °C/s)
  if (eK && run) kCur += 0.08 * prog(eK, i); // winding resistance rises with temperature
  const k1Anom = eK && run ? 1 : 0;
  const k1Type = k1Anom ? eK!.type : k1.tMot > 70 && cooldown('K1', i) ? 'cooldown' : 'none';
  rows.K1!.push([ts, st, r(k1.tMot + gauss() * 0.15, 2), r(Math.max(0, kCur), 3), run ? 80 : 0, k1Anom, k1Type].join(','));
}

const out = join(process.cwd(), 'data', 'datasets');
mkdirSync(out, { recursive: true });
const names: Record<string, string> = { P1: 'p1-pump', F1: 'f1-filler', C1: 'c1-capper', K1: 'k1-conveyor' };
for (const [m, lines] of Object.entries(rows)) writeFileSync(join(out, `${names[m]}.csv`), lines.join('\n') + '\n');

// ---- compact per-minute JSON for the UI (public/datasets/<machineId>.json) ----
/** CSV column → sensor id in data/factories/bottling-line.json */
const SENSOR_COLUMNS: Record<string, Record<string, string>> = {
  P1: { vib: 'vib_mm_s', bearing_temp: 'bearing_temp_c', current: 'current_a' },
  F1: { fill_rejects: 'fill_rejects_pct', flow_var: 'flow_var_pct', temp: 'product_temp_c' },
  C1: { torque: 'torque_nm', rejects: 'rejects_pct', vib: 'vib_mm_s' },
  K1: { motor_temp: 'motor_temp_c', current: 'current_a' },
};
const PER_MIN = 60 / DT;
const pub = join(process.cwd(), 'public', 'datasets');
mkdirSync(pub, { recursive: true });
for (const [m, lines] of Object.entries(rows)) {
  const head = lines[0]!.split(',');
  const data = lines.slice(1).map((l) => l.split(','));
  const fi = head.indexOf('fault_type');
  const t: number[] = [], fault: string[] = [];
  const series: Record<string, number[]> = Object.fromEntries(Object.keys(SENSOR_COLUMNS[m]!).map((k) => [k, []]));
  for (let i = 0; i < data.length; i += PER_MIN) {
    const chunk = data.slice(i, i + PER_MIN);
    t.push(Date.parse(chunk[0]![0]!));
    // a minute is labelled with its first non-'none' label, so short episodes are not lost
    fault.push(chunk.map((c) => c[fi]!).find((f) => f !== 'none') ?? 'none');
    for (const [sensor, col] of Object.entries(SENSOR_COLUMNS[m]!)) {
      const ci = head.indexOf(col);
      series[sensor]!.push(r(chunk.reduce((s, c) => s + Number(c[ci]), 0) / chunk.length, 3));
    }
  }
  writeFileSync(join(pub, `${m}.json`), JSON.stringify({ machineId: m, synthetic: true, stepSec: 60, t, series, fault }));
}
console.log(`generate-datasets: ${N} samples × 4 machines → data/datasets/ + public/datasets/ (${EPISODES.length} labelled episodes)`);
