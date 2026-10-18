'use client';
/**
 * 2D schematic of the line, alternative to the 3D twin: stylised machine drawings (by type) placed by
 * their configured x/z position, animated while the line runs, with status colours, live values,
 * causal path and bottles moving along the conveyors.
 * Same interactions as the 3D map: click selects, right-click opens the machine menu.
 */
import { useMemo } from 'react';
import { lineStateOf, useStore } from '@/modules/store';
import { STATUS_LABEL } from '@/modules/incidents/labels';
import { useHistoryUi } from '@/modules/monitoring/panels/HistoryOverlay';
import type { MachineConfig, MachineStatus } from '@/shared/types';
import { computeLayout } from './layout';
import { siblingsOf } from '@/modules/plant/plant';

/** World units → SVG px. */
const S = 40;
/** Drawing box of a machine (label and values go below it). */
const ICON_W = 130;
const ICON_H = 96;
const LABEL_H = 82;
const STATUS_COLOR: Record<MachineStatus, string> = { verde: '#22c55e', giallo: '#eab308', rosso: '#ef4444' };
const PATH_COLOR = '#f97316';
const METAL = '#334155';
const METAL_DARK = '#1e293b';
const METAL_LIGHT = '#64748b';
const GLASS = '#7dd3fc';

function sensorColor(value: number | undefined, warn: number, crit: number) {
  if (value === undefined) return '#64748b';
  return value > crit ? STATUS_COLOR.rosso : value > warn ? STATUS_COLOR.giallo : '#cbd5e1';
}

function fmt(v: number | undefined, unit: string) {
  if (v === undefined) return '–';
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${unit}`;
}

export default function FactoryMap2D({ machineIds }: { machineIds?: string[] } = {}) {
  const fullFactory = useStore((s) => s.factory);
  // Optional subset (e.g. one production line of the plant).
  const factory = useMemo(
    () => (machineIds ? { ...fullFactory, machines: fullFactory.machines.filter((m) => machineIds.includes(m.id)), faults: fullFactory.faults.filter((f) => machineIds.includes(f.machineId)) } : fullFactory),
    [fullFactory, machineIds],
  );
  const statuses = useStore((s) => s.statuses);
  const history = useStore((s) => s.history);
  const selected = useStore((s) => s.selectedMachine);
  const selectMachine = useStore((s) => s.selectMachine);
  const incidents = useStore((s) => s.incidents);
  const selectedIncident = useStore((s) => s.selectedIncident);
  const running = useStore((s) => s.running);
  const lines = useStore((s) => s.lines);
  const plant = useStore((s) => s.plant);
  const lineOf = (id: string) => lineStateOf({ plant, lines }, id);
  const bypassed = useStore((s) => s.bypassed);
  const rerouteTargets = new Set(Object.values(bypassed).map((b) => b.sibling));
  const openMenu = useHistoryUi((s) => s.openMenu);

  const layout = useMemo(() => computeLayout(factory), [factory]);
  const pos = useMemo(() => new Map(factory.machines.map((m) => [m.id, { x: m.position[0] * S, y: m.position[2] * S }])), [factory]);
  const edges = useMemo(() => factory.machines.flatMap((m) => m.downstream.filter((d) => pos.has(d)).map((d) => [m.id, d] as const)), [factory, pos]);

  const box = useMemo(() => {
    const xs = [...pos.values()].flatMap((p) => [p.x - ICON_W / 2 - 20, p.x + ICON_W / 2 + 20]);
    const ys = [...pos.values()].flatMap((p) => [p.y - ICON_H / 2 - 30, p.y + ICON_H / 2 + LABEL_H]);
    for (const z of layout.zones) {
      xs.push((z.cx - z.w / 2) * S, (z.cx + z.w / 2) * S);
      ys.push((z.cz - z.d / 2) * S, (z.cz + z.d / 2) * S);
    }
    const pad = 30;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return { minX, minY, w: Math.max(...xs) + pad - minX, h: Math.max(...ys) + pad + 24 - minY };
  }, [pos, layout]);

  const inc = selectedIncident ? incidents[selectedIncident] : Object.values(incidents).find((i) => i.status !== 'chiuso' && i.status !== 'rifiutato');
  const causal = inc && inc.causalPath.length > 1 ? inc.causalPath : [];
  const onCausal = (a: string, b: string) => {
    const i = causal.indexOf(a);
    return i >= 0 && causal[i + 1] === b;
  };
  // Twins carry one flow at a time (as in 3D): the first healthy one is in the flow, the others wait on standby.
  const idle = new Set<string>();
  for (const m of factory.machines) {
    const group = [m.id, ...siblingsOf(factory, m.id)].sort((x, y) => factory.machines.findIndex((k) => k.id === x) - factory.machines.findIndex((k) => k.id === y));
    if (group.length < 2) continue;
    const active = group.find((id) => !bypassed[id]);
    if (m.id !== active) idle.add(m.id);
  }
  const flowing = (machineId: string) => running && lineOf(machineId).running && !idle.has(machineId);

  return (
    <svg
      className="h-full w-full select-none bg-[#060b16]"
      viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="2D line schematic"
      onClick={() => selectMachine(null)}
    >
      <defs>
        <pattern id="grid2d" width={S / 2} height={S / 2} patternUnits="userSpaceOnUse">
          <path d={`M ${S / 2} 0 L 0 0 0 ${S / 2}`} fill="none" stroke="#111c2e" strokeWidth="1" />
        </pattern>
        <linearGradient id="metal2d" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#475569" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
        <radialGradient id="halo2d">
          <stop offset="0.55" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={box.minX} y={box.minY} width={box.w} height={box.h} fill="url(#grid2d)" />

      {/* Department zones (floor markings) */}
      {layout.zones.map((z) => (
        <g key={z.type}>
          <rect
            x={(z.cx - z.w / 2) * S}
            y={(z.cz - z.d / 2) * S}
            width={z.w * S}
            height={z.d * S}
            rx={12}
            fill={z.color}
            fillOpacity={0.1}
            stroke={z.color}
            strokeOpacity={0.6}
            strokeDasharray="8 6"
          />
          <text x={(z.cx - z.w / 2) * S + 12} y={(z.cz - z.d / 2) * S + 18} fontSize={10} fontWeight={600} letterSpacing={1.5} fill="#475569">
            {z.label.toUpperCase()}
          </text>
        </g>
      ))}

      {/* Conveyors between machines, with bottles moving while the line runs */}
      {edges.map(([a, b]) => (
        <ConveyorLink key={`${a}-${b}`} from={pos.get(a)!} to={pos.get(b)!} hot={onCausal(a, b)} flowing={flowing(a) && flowing(b)} mode={idle.has(a) || idle.has(b) ? 'off' : rerouteTargets.has(a) || rerouteTargets.has(b) ? 'reroute' : 'normal'} />
      ))}

      {factory.machines.map((m) => (
        <MachineGlyph
          key={m.id}
          m={m}
          x={pos.get(m.id)!.x}
          y={pos.get(m.id)!.y}
          status={statuses[m.id] ?? 'verde'}
          values={Object.fromEntries(m.sensors.map((s) => [s.id, history[m.id]?.[s.id]?.at(-1)?.value]))}
          trend={(m.sensors[0] && history[m.id]?.[m.sensors[0].id]?.map((smp) => smp.value)) ?? []}
          selected={selected === m.id}
          onPath={causal.includes(m.id)}
          tripped={lineOf(m.id).trippedBy?.machineId === m.id}
          animate={flowing(m.id)}
          stopped={!lineOf(m.id).running}
          bypassed={Boolean(bypassed[m.id])}
          onSelect={() => selectMachine(m.id)}
          onMenu={(cx, cy) => openMenu(m.id, cx, cy)}
        />
      ))}

      <Legend x={box.minX + 16} y={box.minY + box.h - 14} />
    </svg>
  );
}

/** off: leads to a bypassed machine (no flow); reroute: the twin that took over the flow. */
function ConveyorLink({ from, to, hot, flowing, mode = 'normal' }: { from: { x: number; y: number }; to: { x: number; y: number }; hot: boolean; flowing: boolean; mode?: 'normal' | 'off' | 'reroute' }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Start/end just outside the machine drawings.
  const gap = Math.min(ICON_W / 2 / Math.max(Math.abs(ux), 1e-6), ICON_H / 2 / Math.max(Math.abs(uy), 1e-6)) - 6;
  const x1 = from.x + ux * gap;
  const y1 = from.y + uy * gap;
  const x2 = to.x - ux * gap;
  const y2 = to.y - uy * gap;
  const d = `M ${x1} ${y1} L ${x2} ${y2}`;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const segLen = Math.hypot(x2 - x1, y2 - y1);
  return (
    <g>
      {/* belt */}
      <path d={d} stroke={mode === 'reroute' ? '#15803d' : hot ? PATH_COLOR : METAL_DARK} strokeWidth={18} strokeLinecap="butt" fill="none" opacity={mode === 'off' ? 0.35 : hot ? 0.9 : 1} strokeDasharray={mode === 'off' ? '6 6' : undefined} />
      <path d={d} stroke={hot ? '#fdba74' : METAL} strokeWidth={12} strokeLinecap="butt" fill="none" strokeDasharray="7 3">
        {flowing && <animate attributeName="stroke-dashoffset" from="10" to="0" dur="0.4s" repeatCount="indefinite" />}
      </path>
      {/* bottles */}
      {mode !== 'off' && Array.from({ length: Math.max(1, Math.floor(segLen / 34)) }, (_, n) => {
        const t = (n + 0.5) / Math.max(1, Math.floor(segLen / 34));
        return (
          <g key={n} transform={flowing ? undefined : `translate(${x1 + (x2 - x1) * t} ${y1 + (y2 - y1) * t}) rotate(${angle})`}>
            <Bottle />
            {flowing && <animateMotion dur={`${segLen / 40}s`} begin={`${-t * (segLen / 40)}s`} repeatCount="indefinite" path={d} rotate="auto" />}
          </g>
        );
      })}
    </g>
  );
}

/** Top view of a bottle on the belt (cap + body), centred on the origin. */
function Bottle() {
  return (
    <g>
      <rect x={-6} y={-5} width={12} height={10} rx={4} fill={GLASS} fillOpacity={0.85} stroke="#0ea5e9" strokeWidth={0.8} />
      <circle cx={0} cy={0} r={2.4} fill="#e2e8f0" />
    </g>
  );
}

function MachineGlyph(props: {
  m: MachineConfig;
  x: number;
  y: number;
  status: MachineStatus;
  values: Record<string, number | undefined>;
  /** Last ~60 s of the main (first) sensor. */
  trend: number[];
  selected: boolean;
  onPath: boolean;
  tripped: boolean;
  animate: boolean;
  stopped: boolean;
  bypassed: boolean;
  onSelect: () => void;
  onMenu: (clientX: number, clientY: number) => void;
}) {
  const { m, x, y, status, values, trend, selected, onPath, tripped, animate, stopped, bypassed, onSelect, onMenu } = props;
  // A stopped line is grey; only the machine that tripped it keeps its (red) status colour.
  const accent = bypassed || (stopped && !tripped) ? '#64748b' : STATUS_COLOR[status];
  const shown = m.sensors.slice(0, 2);
  const main = m.sensors[0];
  const labelY = ICON_H / 2 + 18;

  return (
    <g
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={0}
      aria-label={`${m.id} ${m.name}: ${STATUS_LABEL[status]}`}
      aria-pressed={selected}
      className="cursor-pointer outline-none"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = (e.currentTarget as SVGGElement).getBoundingClientRect();
        onMenu(e.clientX || r.left + 16, e.clientY || r.bottom);
      }}
    >
      {/* hit area */}
      <rect x={-ICON_W / 2 - 10} y={-ICON_H / 2 - 10} width={ICON_W + 20} height={ICON_H + LABEL_H + 10} fill="transparent" />
      {/* status halo */}
      {status !== 'verde' && (
        <ellipse cx={0} cy={0} rx={ICON_W * 0.62} ry={ICON_H * 0.62} fill="url(#halo2d)" style={{ color: accent }}>
          {status === 'rosso' && <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />}
        </ellipse>
      )}
      {(selected || onPath) && (
        <rect
          x={-ICON_W / 2 - 8}
          y={-ICON_H / 2 - 8}
          width={ICON_W + 16}
          height={ICON_H + LABEL_H + 4}
          rx={14}
          fill="none"
          stroke={selected ? '#38bdf8' : PATH_COLOR}
          strokeWidth={2}
          strokeDasharray={selected ? undefined : '6 4'}
        />
      )}

      <Drawing type={m.type} accent={accent} animate={animate} />

      {/* label */}
      <text y={labelY} textAnchor="middle" fontSize={12} fontWeight={600} fill="#e2e8f0">
        <tspan fontFamily="ui-monospace, monospace" fill="#94a3b8">
          {m.id}
        </tspan>{' '}
        {m.name.length > 20 ? `${m.name.slice(0, 19)}…` : m.name}
      </text>
      <g transform={`translate(0 ${labelY + 16})`} fontSize={10.5} fontFamily="ui-monospace, monospace" textAnchor="middle">
        <text fill={stopped ? '#64748b' : '#94a3b8'}>
          {shown.map((s, i) => (
            <tspan key={s.id} fill={stopped ? '#64748b' : sensorColor(values[s.id], s.warn, s.crit)}>
              {i > 0 ? '  ·  ' : ''}
              {fmt(values[s.id], s.unit)}
            </tspan>
          ))}
        </text>
      </g>
      {main && <Sparkline data={trend} warn={main.warn} crit={main.crit} y={labelY + 22} stopped={stopped} />}
      <g transform={`translate(0 ${labelY + 58})`}>
        <rect x={-30} y={-10} width={60} height={15} rx={7.5} fill={accent} fillOpacity={0.15} stroke={accent} strokeOpacity={0.6} />
        <text y={1} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={accent}>
          {bypassed ? 'BYPASSED' : stopped ? (tripped ? 'TRIPPED' : 'STOPPED') : STATUS_LABEL[status].toUpperCase()}
        </text>
      </g>
      {tripped && (
        <g transform={`translate(0 ${-ICON_H / 2 - 16})`}>
          <rect x={-34} y={-10} width={68} height={18} rx={9} fill="#dc2626" />
          <text textAnchor="middle" y={3} fontSize={10} fontWeight={700} fill="#fff">
            ⛔ TRIPPED
          </text>
        </g>
      )}
    </g>
  );
}

/** Stylised side/top views by machine type, centred on the origin, about ICON_W × ICON_H. */
function Drawing({ type, accent, animate }: { type: string; accent: string; animate: boolean }) {
  const spin = (cx: number, cy: number, dur: string) =>
    animate ? <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur={dur} repeatCount="indefinite" /> : null;

  if (type.includes('pump')) {
    return (
      <g stroke={accent} strokeWidth={1.6} strokeLinejoin="round">
        {/* base plate */}
        <rect x={-60} y={30} width={120} height={8} rx={2} fill={METAL_DARK} />
        {/* motor with cooling fins */}
        <rect x={-58} y={-14} width={56} height={40} rx={6} fill="url(#metal2d)" />
        {[-50, -42, -34, -26, -18].map((fx) => (
          <line key={fx} x1={fx} y1={-14} x2={fx} y2={26} stroke={METAL_LIGHT} strokeWidth={1} />
        ))}
        <rect x={-66} y={-6} width={8} height={24} rx={2} fill={METAL} />
        <rect x={-46} y={26} width={8} height={6} fill={METAL} stroke="none" />
        <rect x={-20} y={26} width={8} height={6} fill={METAL} stroke="none" />
        {/* coupling */}
        <rect x={-2} y={1} width={12} height={10} rx={2} fill={METAL_LIGHT} />
        {/* volute + impeller */}
        <circle cx={32} cy={6} r={22} fill="url(#metal2d)" />
        <g>
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <path key={a} d="M 32 6 q 6 -8 0 -16" transform={`rotate(${a} 32 6)`} fill="none" stroke={GLASS} strokeWidth={2} strokeLinecap="round" />
          ))}
          {spin(32, 6, '0.8s')}
        </g>
        <circle cx={32} cy={6} r={3} fill={accent} />
        {/* suction / discharge pipes */}
        <rect x={54} y={0} width={12} height={12} fill={METAL} />
        <rect x={26} y={-34} width={12} height={18} fill={METAL} />
        <rect x={22} y={-38} width={20} height={5} rx={1} fill={METAL_LIGHT} />
      </g>
    );
  }

  if (type.includes('filler')) {
    const bottles = Array.from({ length: 12 }, (_, i) => (i * 360) / 12);
    return (
      <g stroke={accent} strokeWidth={1.6}>
        {/* product tank on top */}
        <path d="M -16 -48 L 16 -48 L 12 -36 L -12 -36 Z" fill="url(#metal2d)" />
        <line x1={0} y1={-36} x2={0} y2={-30} stroke={METAL_LIGHT} strokeWidth={3} />
        {/* rotary carousel (top view) with bottles */}
        <circle cx={0} cy={8} r={40} fill={METAL_DARK} />
        <g>
          <circle cx={0} cy={8} r={30} fill="url(#metal2d)" />
          {bottles.map((a) => (
            <g key={a} transform={`rotate(${a} 0 8) translate(0 -27)`}>
              <circle cx={0} cy={8} r={5.5} fill={GLASS} fillOpacity={0.85} stroke="#0ea5e9" strokeWidth={0.8} />
              <circle cx={0} cy={8} r={1.8} fill="#e2e8f0" stroke="none" />
            </g>
          ))}
          {spin(0, 8, '6s')}
        </g>
        <circle cx={0} cy={8} r={11} fill={METAL} />
        <circle cx={0} cy={8} r={4} fill={accent} stroke="none" />
      </g>
    );
  }

  if (type.includes('capper')) {
    return (
      <g stroke={accent} strokeWidth={1.6} strokeLinejoin="round">
        {/* frame */}
        <rect x={-44} y={34} width={88} height={8} rx={2} fill={METAL_DARK} />
        <rect x={-40} y={-44} width={10} height={80} fill="url(#metal2d)" />
        <rect x={-40} y={-48} width={70} height={14} rx={3} fill="url(#metal2d)" />
        {/* cap chute */}
        <path d="M 30 -40 L 46 -56 L 52 -50 L 36 -34" fill={METAL} />
        <circle cx={47} cy={-52} r={3} fill="#e2e8f0" stroke="none" />
        {/* capping head moving up and down */}
        <g>
          <rect x={4} y={-34} width={8} height={22} fill={METAL_LIGHT} />
          <rect x={-4} y={-14} width={24} height={14} rx={3} fill="url(#metal2d)" />
          <rect x={2} y={0} width={12} height={5} rx={1} fill={accent} stroke="none" />
          {animate && <animateTransform attributeName="transform" type="translate" values="0 0; 0 10; 0 0" dur="1.1s" repeatCount="indefinite" />}
        </g>
        {/* bottle under the head */}
        <path d="M 2 34 L 2 20 Q 2 14 6 12 L 6 8 L 10 8 L 10 12 Q 14 14 14 20 L 14 34 Z" fill={GLASS} fillOpacity={0.85} stroke="#0ea5e9" strokeWidth={0.8} />
        <rect x={5} y={5} width={6} height={4} rx={1} fill="#e2e8f0" stroke="none" />
        {/* star wheel */}
        <g>
          <circle cx={-14} cy={26} r={9} fill={METAL} />
          {[0, 90, 180, 270].map((a) => (
            <rect key={a} x={-15.5} y={14} width={3} height={6} fill={METAL_LIGHT} stroke="none" transform={`rotate(${a} -14 26)`} />
          ))}
          {spin(-14, 26, '2.2s')}
        </g>
      </g>
    );
  }

  if (type.includes('conveyor')) {
    const rollers = [-48, -32, -16, 0, 16, 32, 48];
    return (
      <g stroke={accent} strokeWidth={1.6} strokeLinejoin="round">
        {/* legs */}
        {[-50, 50].map((lx) => (
          <rect key={lx} x={lx - 3} y={12} width={6} height={26} fill={METAL} stroke="none" />
        ))}
        {/* belt */}
        <rect x={-62} y={-6} width={124} height={18} rx={2} fill={METAL_DARK} />
        {rollers.map((rx) => (
          <g key={rx}>
            <circle cx={rx} cy={3} r={5} fill={METAL} />
            <line x1={rx} y1={-2} x2={rx} y2={8} stroke={METAL_LIGHT} strokeWidth={1}>
              {animate && <animateTransform attributeName="transform" type="rotate" from={`0 ${rx} 3`} to={`360 ${rx} 3`} dur="0.6s" repeatCount="indefinite" />}
            </line>
          </g>
        ))}
        {/* bottles riding on the belt */}
        <g>
          {[-44, -16, 12, 40].map((bx) => (
            <path
              key={bx}
              d={`M ${bx - 5} -6 L ${bx - 5} -18 Q ${bx - 5} -22 ${bx - 2} -23 L ${bx - 2} -27 L ${bx + 2} -27 L ${bx + 2} -23 Q ${bx + 5} -22 ${bx + 5} -18 L ${bx + 5} -6 Z`}
              fill={GLASS}
              fillOpacity={0.85}
              stroke="#0ea5e9"
              strokeWidth={0.8}
            />
          ))}
          {animate && <animateTransform attributeName="transform" type="translate" values="-14 0; 14 0" dur="1.2s" repeatCount="indefinite" />}
        </g>
        {/* gear motor */}
        <rect x={50} y={14} width={22} height={18} rx={4} fill="url(#metal2d)" />
        {[55, 60, 65].map((fx) => (
          <line key={fx} x1={fx} y1={14} x2={fx} y2={32} stroke={METAL_LIGHT} strokeWidth={1} />
        ))}
        <circle cx={61} cy={23} r={2.5} fill={accent} stroke="none" />
      </g>
    );
  }

  // Generic machine: housing with a gear.
  return (
    <g stroke={accent} strokeWidth={1.6}>
      <rect x={-46} y={-34} width={92} height={70} rx={8} fill="url(#metal2d)" />
      <g>
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={-3} y={-22} width={6} height={8} fill={METAL_LIGHT} stroke="none" transform={`rotate(${i * 45} 0 0)`} />
        ))}
        <circle cx={0} cy={0} r={15} fill={METAL} />
        {spin(0, 0, '3s')}
      </g>
      <circle cx={0} cy={0} r={4} fill={accent} stroke="none" />
    </g>
  );
}

/** Live mini chart of the last 60 s, with the warning level dashed; colour follows the thresholds. */
function Sparkline({ data, warn, crit, y, stopped }: { data: number[]; warn: number; crit: number; y: number; stopped: boolean }) {
  const W = 110;
  const H = 18;
  if (data.length < 2) {
    return (
      <text y={y + 12} textAnchor="middle" fontSize={9} fill="#475569">
        collecting live data…
      </text>
    );
  }
  // Scale on the data range, widened to keep tiny noise from looking like big swings.
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = Math.max(hi - lo, Math.abs(hi) * 0.05, 1e-6);
  const min = (lo + hi) / 2 - span / 2;
  const sx = (i: number) => -W / 2 + (i / (data.length - 1)) * W;
  const sy = (v: number) => y + H - ((v - min) / span) * H;
  const last = data[data.length - 1]!;
  const color = stopped ? '#64748b' : last > crit ? STATUS_COLOR.rosso : last > warn ? STATUS_COLOR.giallo : '#38bdf8';
  const warnY = sy(warn);
  return (
    <g>
      <rect x={-W / 2 - 4} y={y - 3} width={W + 8} height={H + 6} rx={4} fill="#0b1324" />
      {warnY >= y && warnY <= y + H && <line x1={-W / 2} x2={W / 2} y1={warnY} y2={warnY} stroke={STATUS_COLOR.giallo} strokeOpacity={0.6} strokeDasharray="3 3" />}
      <polyline points={data.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={sx(data.length - 1)} cy={sy(last)} r={2.2} fill={color} />
    </g>
  );
}

function Legend({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} fontSize={10.5} fill="#94a3b8">
      {(
        [
          ['verde', 0],
          ['giallo', 52],
          ['rosso', 128],
        ] as const
      ).map(([st, dx]) => (
        <g key={st} transform={`translate(${dx} 0)`}>
          <circle cx={5} cy={-4} r={5} fill={STATUS_COLOR[st]} />
          <text x={14} y={0}>
            {STATUS_LABEL[st]}
          </text>
        </g>
      ))}
      <line x1={190} y1={-4} x2={214} y2={-4} stroke={PATH_COLOR} strokeWidth={6} strokeLinecap="round" />
      <text x={222} y={0}>
        Causal path
      </text>
    </g>
  );
}
