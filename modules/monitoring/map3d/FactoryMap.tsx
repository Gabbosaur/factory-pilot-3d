'use client';
/**
 * Mappa_3D (Req 5, 12.7). Low-poly machines, conveyor links, status colours, animated causal path,
 * bottles moving on the line. Loaded with next/dynamic ssr:false.
 */
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '@/modules/store';
import type { MachineConfig, MachineStatus } from '@/shared/types';
import { STATUS_LABEL } from '@/modules/incidents/labels';

const STATUS_COLOR: Record<MachineStatus, string> = { verde: '#22c55e', giallo: '#eab308', rosso: '#ef4444' };

function MachineMesh({ m, status, selected, onPath, onSelect }: { m: MachineConfig; status: MachineStatus; selected: boolean; onPath: boolean; onSelect: () => void }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const [w, h, d] = m.size;
  useFrame(({ clock }) => {
    if (!mat.current) return;
    const pulse = status === 'rosso' ? 0.35 + 0.35 * Math.sin(clock.elapsedTime * 5) : status === 'giallo' ? 0.15 : 0.02;
    mat.current.emissiveIntensity = pulse;
  });
  const color = STATUS_COLOR[status];
  const body = (() => {
    switch (m.type) {
      case 'centrifugal_pump':
      case 'pump':
        return (
          <group>
            <mesh position={[0, h * 0.45, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[h * 0.4, h * 0.4, w * 0.6, 12]} />
              <meshStandardMaterial ref={mat} color={color} emissive={color} flatShading />
            </mesh>
            <mesh position={[w * 0.4, h * 0.45, 0]} castShadow>
              <sphereGeometry args={[h * 0.42, 10, 8]} />
              <meshStandardMaterial color="#64748b" flatShading />
            </mesh>
          </group>
        );
      case 'filler':
        return (
          <group>
            <mesh position={[0, h * 0.35, 0]} castShadow>
              <cylinderGeometry args={[w * 0.5, w * 0.5, h * 0.7, 16]} />
              <meshStandardMaterial ref={mat} color={color} emissive={color} flatShading />
            </mesh>
            <mesh position={[0, h * 0.85, 0]} castShadow>
              <cylinderGeometry args={[w * 0.2, w * 0.35, h * 0.3, 10]} />
              <meshStandardMaterial color="#94a3b8" flatShading />
            </mesh>
          </group>
        );
      case 'conveyor':
        return (
          <mesh position={[0, h * 0.5, 0]} castShadow>
            <boxGeometry args={[w, h * 0.3, d]} />
            <meshStandardMaterial ref={mat} color={color} emissive={color} flatShading />
          </mesh>
        );
      default:
        return (
          <group>
            <mesh position={[0, h * 0.5, 0]} castShadow>
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial ref={mat} color={color} emissive={color} flatShading />
            </mesh>
            <mesh position={[0, h + 0.2, 0]} castShadow>
              <boxGeometry args={[w * 0.4, 0.4, d * 0.4]} />
              <meshStandardMaterial color="#94a3b8" flatShading />
            </mesh>
          </group>
        );
    }
  })();
  return (
    <group
      position={m.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      {body}
      {(selected || onPath) && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(w, d) * 0.75, Math.max(w, d) * 0.85, 32]} />
          <meshBasicMaterial color={onPath ? '#f97316' : '#e2e8f0'} />
        </mesh>
      )}
      <Html position={[0, h + 0.9, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
        <div className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${status === 'rosso' ? 'bg-red-600 text-white' : status === 'giallo' ? 'bg-yellow-400 text-black' : 'bg-slate-800/80 text-slate-100'}`}>
          {m.id} · {STATUS_LABEL[status].toUpperCase()}
        </div>
      </Html>
    </group>
  );
}

function CausalPath({ points }: { points: THREE.Vector3[] }) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.material.dashOffset -= dt * 2;
  });
  return <Line ref={ref as never} points={points} color="#f97316" lineWidth={6} dashed dashSize={0.6} gapSize={0.3} />;
}

/** Bottles flowing along the line; they slow down when a machine on the path is red. */
function Bottles({ path, speed }: { path: THREE.Vector3[]; speed: number }) {
  const N = 18;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const curve = useMemo(() => (path.length > 1 ? new THREE.CatmullRomCurve3(path, false, 'catmullrom', 0) : null), [path]);
  const offsets = useMemo(() => Array.from({ length: N }, (_, i) => i / N), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    if (!mesh.current || !curve) return;
    for (let i = 0; i < N; i++) {
      offsets[i] = (offsets[i]! + dt * 0.04 * speed) % 1;
      const p = curve.getPointAt(offsets[i]!);
      dummy.position.set(p.x, 1.25, p.z);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  if (!curve) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} castShadow>
      <cylinderGeometry args={[0.12, 0.12, 0.5, 8]} />
      <meshStandardMaterial color="#7dd3fc" transparent opacity={0.85} />
    </instancedMesh>
  );
}

export default function FactoryMap() {
  const factory = useStore((s) => s.factory);
  const statuses = useStore((s) => s.statuses);
  const selected = useStore((s) => s.selectedMachine);
  const selectMachine = useStore((s) => s.selectMachine);
  const incidents = useStore((s) => s.incidents);
  const selectedIncident = useStore((s) => s.selectedIncident);
  const running = useStore((s) => s.running);

  const byId = useMemo(() => new Map(factory.machines.map((m) => [m.id, m])), [factory]);
  const center = (id: string) => {
    const m = byId.get(id)!;
    return new THREE.Vector3(m.position[0], 1.0, m.position[2]);
  };
  const links = useMemo(
    () => factory.machines.flatMap((m) => m.downstream.map((d) => [m.id, d] as const)),
    [factory],
  );

  const inc = selectedIncident ? incidents[selectedIncident] : Object.values(incidents).find((i) => i.status !== 'chiuso');
  const causal = inc && inc.causalPath.length > 1 ? inc.causalPath : null;
  const onPath = new Set(inc?.causalPath ?? []);

  // Main serial flow for bottles: follow first downstream from the source(s).
  const flow = useMemo(() => {
    const start = factory.machines.find((m) => m.upstream.length === 0);
    const out: THREE.Vector3[] = [];
    for (let m = start; m; m = m.downstream[0] ? byId.get(m.downstream[0]) : undefined) {
      out.push(new THREE.Vector3(m.position[0], 1, m.position[2]));
      if (out.length > 50) break;
    }
    return out;
  }, [factory, byId]);
  const anyRed = Object.values(statuses).some((s) => s === 'rosso');

  const span = Math.max(...factory.machines.map((m) => Math.abs(m.position[0]) + m.size[0]), 10);

  return (
    <Canvas shadows camera={{ position: [0, span * 0.9, span * 1.2], fov: 45 }} onPointerMissed={() => selectMachine(null)}>
      <color attach="background" args={['#0b1220']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 18, 8]} intensity={1.2} castShadow shadow-mapSize={[1024, 1024]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[span * 4, span * 3]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <gridHelper args={[span * 4, 40, '#334155', '#1f2a3d']} position={[0, 0.01, 0]} />
      {links.map(([a, b]) => (
        <Line key={`${a}-${b}`} points={[center(a), center(b)]} color="#475569" lineWidth={3} />
      ))}
      {causal && <CausalPath points={causal.map((id) => center(id).add(new THREE.Vector3(0, 0.6, 0)))} />}
      <Bottles path={flow} speed={running ? (anyRed ? 0.3 : 1) : 0} />
      {factory.machines.map((m) => (
        <MachineMesh
          key={m.id}
          m={m}
          status={statuses[m.id] ?? 'verde'}
          selected={selected === m.id}
          onPath={Boolean(causal) && onPath.has(m.id)}
          onSelect={() => selectMachine(m.id)}
        />
      ))}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.15} minDistance={6} maxDistance={span * 3} enableDamping />
    </Canvas>
  );
}
