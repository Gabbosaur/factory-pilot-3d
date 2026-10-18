/**
 * Derives a digital-twin floor plan from the factory config: hall bounds, department zones
 * (one per machine type, as a labelled area on the floor) and scene props. Pure, no three.js.
 * If the config ever carries an explicit `layout`, prefer it; otherwise everything is computed here.
 */
import type { FactoryConfig, MachineConfig } from '@/shared/types';

export interface Rect {
  cx: number;
  cz: number;
  w: number;
  d: number;
}

export interface Zone extends Rect {
  type: string;
  label: string;
  color: string;
}

export interface Prop {
  kind: 'tank' | 'pallet' | 'rack' | 'office' | 'forklift';
  x: number;
  z: number;
  rot: number;
}

export interface FactoryLayout {
  hall: { w: number; d: number; wallH: number };
  zones: Zone[];
  props: Prop[];
  /** Ordered machine ids along the main serial flow (source → … → sink). */
  flow: string[];
  /** Every source → sink path: parallel machines (twin fillers) get their own branch of conveyor. */
  paths: string[][];
}

const ZONE_COLORS: Record<string, string> = {
  centrifugal_pump: '#1e3a8a',
  pump: '#1e3a8a',
  filler: '#155e75',
  capper: '#3f3f46',
  conveyor: '#422006',
  labeller: '#4a044e',
};
const FALLBACK_COLORS = ['#1e3a8a', '#155e75', '#3f3f46', '#422006', '#14532d', '#4a044e'];

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Main serial path: start from a machine with no upstream, follow the first downstream each hop. */
export function mainFlow(config: FactoryConfig): string[] {
  const byId = new Map(config.machines.map((m) => [m.id, m]));
  const start = config.machines.find((m) => m.upstream.length === 0) ?? config.machines[0];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let m: MachineConfig | undefined = start; m && !seen.has(m.id); m = m.downstream[0] ? byId.get(m.downstream[0]) : undefined) {
    out.push(m.id);
    seen.add(m.id);
    if (out.length > 50) break;
  }
  return out;
}

/** All source → sink paths through the machine graph (parallel machines ⇒ one path each). Capped. */
export function flowPaths(config: FactoryConfig, max = 12): string[][] {
  const byId = new Map(config.machines.map((m) => [m.id, m]));
  const out: string[][] = [];
  const walk = (id: string, path: string[]) => {
    if (out.length >= max || path.includes(id) || path.length > 50) return;
    const m = byId.get(id);
    if (!m) return;
    const next = [...path, id];
    const down = m.downstream.filter((d) => byId.has(d));
    if (down.length === 0) out.push(next);
    else for (const d of down) walk(d, next);
  };
  for (const m of config.machines.filter((x) => x.upstream.filter((u) => byId.has(u)).length === 0)) walk(m.id, []);
  return out;
}

export function computeLayout(config: FactoryConfig): FactoryLayout {
  const xs = config.machines.map((m) => m.position[0]);
  const zs = config.machines.map((m) => m.position[2]);
  const halfW = Math.max(...config.machines.map((m) => m.size[0])) ;
  const halfD = Math.max(...config.machines.map((m) => m.size[2]));
  const minX = Math.min(...xs) - halfW - 4;
  const maxX = Math.max(...xs) + halfW + 4;
  const minZ = Math.min(...zs) - halfD - 4;
  const maxZ = Math.max(...zs) + halfD + 4;
  const w = Math.max(maxX - minX, 14);
  const d = Math.max(maxZ - minZ, 10);

  // One zone per machine type, sized to cover the machines of that type.
  const byType = new Map<string, MachineConfig[]>();
  for (const m of config.machines) {
    const arr = byType.get(m.type) ?? [];
    arr.push(m);
    byType.set(m.type, arr);
  }
  let ci = 0;
  const zones: Zone[] = [...byType.entries()].map(([type, ms]) => {
    const zxs = ms.map((m) => m.position[0]);
    const zzs = ms.map((m) => m.position[2]);
    const pad = 2.2;
    const zMinX = Math.min(...zxs) - pad;
    const zMaxX = Math.max(...zxs) + pad;
    const zMinZ = Math.min(...zzs) - pad;
    const zMaxZ = Math.max(...zzs) + pad;
    const color = ZONE_COLORS[type] ?? FALLBACK_COLORS[ci++ % FALLBACK_COLORS.length]!;
    return { type, label: titleCase(type), color, cx: (zMinX + zMaxX) / 2, cz: (zMinZ + zMaxZ) / 2, w: zMaxX - zMinX, d: zMaxZ - zMinZ };
  });

  // Scene props placed near the hall walls, out of the machine lane.
  const backZ = minZ + 2;
  const frontZ = maxZ - 2;
  const props: Prop[] = [
    { kind: 'tank', x: minX + 2.5, z: backZ, rot: 0 },
    { kind: 'tank', x: minX + 5, z: backZ, rot: 0 },
    { kind: 'rack', x: maxX - 3, z: backZ, rot: 0 },
    { kind: 'pallet', x: maxX - 3, z: frontZ, rot: 0.3 },
    { kind: 'pallet', x: maxX - 4.5, z: frontZ, rot: -0.2 },
    { kind: 'forklift', x: (minX + maxX) / 2, z: frontZ, rot: Math.PI / 2 },
    { kind: 'office', x: minX + 3, z: frontZ, rot: 0 },
  ];

  return { hall: { w, d, wallH: 4 }, zones, props, flow: mainFlow(config), paths: flowPaths(config) };
}
