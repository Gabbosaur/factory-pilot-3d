'use client';
/**
 * Mappa_3D / Digital twin (Req 5, 12.7). Full factory hall with floor plan, department zones,
 * continuous conveyor, props and low-poly machines. 3D and top-down views. ssr:false.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, ContactShadows, Environment, Lightformer, Line, OrbitControls, SoftShadows, Text } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { lineStateOf, useStore } from '@/modules/store';
import type { MachineConfig, MachineStatus } from '@/shared/types';
import { STATUS_LABEL } from '@/modules/incidents/labels';
import { computeLayout } from './layout';
import { Conveyor, FloorPlan, Hall, SceneProp, TEXT_FONT } from './FactoryScene';
import { useHistoryUi } from '@/modules/monitoring/panels/HistoryOverlay';
import FactoryMap2D from './FactoryMap2D';

const STATUS_COLOR: Record<MachineStatus, string> = { verde: '#22c55e', giallo: '#eab308', rosso: '#ef4444' };

/** halt: the machine's line is stopped by a protective trip ("tripped" = the machine that caused it). */
function MachineMesh({ m, status, running, halt, selected, onPath, onSelect, onMenu }: { m: MachineConfig; status: MachineStatus; running: boolean; halt: 'stopped' | 'tripped' | 'bypassed' | null; selected: boolean; onPath: boolean; onSelect: () => void; onMenu: (x: number, y: number) => void }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.Mesh>(null);
  const spin = useRef<THREE.Group>(null); // rotating part (pump impeller / default rotor)
  const bob = useRef<THREE.Group>(null); // oscillating part (filler head)
  const body = useRef<THREE.Group>(null); // whole-machine vibration when in alarm
  const [w, h, d] = m.size;
  // Faster motion when the machine runs harder; red machines visibly shake.
  const speed = status === 'rosso' ? 7 : status === 'giallo' ? 4 : 2.2;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // High emissive on alarm so the Bloom effect makes red machines glow.
    if (mat.current) mat.current.emissiveIntensity = halt === 'stopped' || halt === 'bypassed' ? 0.02 : status === 'rosso' ? 1.3 + 0.7 * Math.sin(t * 6) : status === 'giallo' ? 0.5 + 0.2 * Math.sin(t * 3) : 0.06;
    if (halo.current) {
      const s = 1 + 0.18 * Math.sin(t * 3);
      halo.current.scale.set(s, s, s);
    }
    if (running) {
      if (spin.current) spin.current.rotation.z += 0.015 * speed;
      if (bob.current) bob.current.position.y = Math.abs(Math.sin(t * speed)) * h * 0.12;
    }
    // Vibration shake grows with severity (barely visible when green).
    if (body.current) {
      const amp = status === 'rosso' ? 0.04 : status === 'giallo' ? 0.015 : 0;
      body.current.position.x = running ? Math.sin(t * 40) * amp : 0;
    }
  });
  // A stopped line is grey (only the machine that tripped it stays red).
  const color = halt === 'stopped' || halt === 'bypassed' ? '#475569' : STATUS_COLOR[status];
  const inner = (() => {
    switch (m.type) {
      case 'centrifugal_pump':
      case 'pump':
        return (
          <group>
            <mesh position={[0, h * 0.45, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[h * 0.4, h * 0.4, w * 0.6, 32]} />
              <meshStandardMaterial ref={mat} color={color} emissive={color} metalness={0.85} roughness={0.35} />
            </mesh>
            {/* rotating impeller shaft */}
            <group ref={spin} position={[w * 0.4, h * 0.45, 0]}>
              <mesh castShadow>
                <sphereGeometry args={[h * 0.42, 24, 24]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.25} />
              </mesh>
              {[0, 1, 2, 3].map((i) => (
                <mesh key={i} rotation={[0, 0, (i * Math.PI) / 2]} position={[0, 0, h * 0.1]} castShadow>
                  <boxGeometry args={[h * 0.7, 0.08, 0.12]} />
                  <meshStandardMaterial color="#94a3b8" />
                </mesh>
              ))}
            </group>
          </group>
        );
      case 'filler':
        return (
          <group>
            <mesh position={[0, h * 0.35, 0]} castShadow>
              <cylinderGeometry args={[w * 0.5, w * 0.5, h * 0.7, 36]} />
              <meshStandardMaterial ref={mat} color={color} emissive={color} metalness={0.8} roughness={0.4} />
            </mesh>
            {/* oscillating filling head */}
            <group ref={bob}>
              <mesh position={[0, h * 0.85, 0]} castShadow>
                <cylinderGeometry args={[w * 0.2, w * 0.35, h * 0.3, 24]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.2} />
              </mesh>
            </group>
          </group>
        );
      case 'conveyor':
        return (
          <mesh position={[0, h * 0.5, 0]} castShadow>
            <boxGeometry args={[w, h * 0.3, d]} />
            <meshStandardMaterial ref={mat} color={color} emissive={color} metalness={0.75} roughness={0.5} />
          </mesh>
        );
      default:
        return (
          <group>
            <mesh position={[0, h * 0.5, 0]} castShadow>
              <boxGeometry args={[w, h, d]} />
              <meshStandardMaterial ref={mat} color={color} emissive={color} metalness={0.8} roughness={0.4} />
            </mesh>
            <group ref={spin} position={[0, h + 0.2, 0]}>
              <mesh castShadow>
                <boxGeometry args={[w * 0.5, 0.12, 0.12]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} />
              </mesh>
            </group>
          </group>
        );
    }
  })();
  const radius = Math.max(w, d) * 0.8;
  return (
    <group
      position={m.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        e.nativeEvent.preventDefault();
        onMenu(e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <group ref={body}>{inner}</group>
      {/* Alarm halo visible from across the hall */}
      {status === 'rosso' && halt !== 'bypassed' && (
        <mesh ref={halo} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius, radius * 1.5, 40]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
      {(selected || onPath) && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 0.95, radius * 1.05, 32]} />
          <meshBasicMaterial color={onPath ? '#f97316' : '#e2e8f0'} />
        </mesh>
      )}
      <Billboard position={[0, h + 1, 0]}>
        <Text
          font={TEXT_FONT}
          fontSize={0.5}
          color={halt === 'bypassed' ? '#fcd34d' : halt === 'stopped' ? '#94a3b8' : status === 'rosso' ? '#fecaca' : status === 'giallo' ? '#fde68a' : '#e2e8f0'}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.03}
          outlineColor="#060b16"
        >
          {`${m.id} · ${halt ? halt.toUpperCase() : STATUS_LABEL[status].toUpperCase()}`}
        </Text>
      </Billboard>
    </group>
  );
}

function CausalPath({ points, moving }: { points: THREE.Vector3[]; moving: boolean }) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame((_, dt) => {
    if (ref.current && moving) ref.current.material.dashOffset -= dt * 2;
  });
  return <Line ref={ref as never} points={points} color="#f97316" lineWidth={6} dashed dashSize={0.6} gapSize={0.3} />;
}

function Bottles({ path, speed }: { path: THREE.Vector3[]; speed: number }) {
  const N = 24;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const curve = useMemo(() => (path.length > 1 ? new THREE.CatmullRomCurve3(path, false, 'catmullrom', 0) : null), [path]);
  const offsets = useMemo(() => Array.from({ length: N }, (_, i) => i / N), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    if (!mesh.current || !curve) return;
    for (let i = 0; i < N; i++) {
      offsets[i] = (offsets[i]! + dt * 0.04 * speed) % 1;
      const p = curve.getPointAt(offsets[i]!);
      dummy.position.set(p.x, 1.35, p.z);
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

/**
 * Animates the camera between a perspective "3D" pose and an overhead "top-down" pose.
 * In 3D it keeps a very slow orbital drift so the scene never looks frozen, but any user
 * interaction (OrbitControls) takes over immediately.
 */
/** Gentle orbit around the hall centre while nobody is interacting with the map. */
function CameraRig({ idle }: { idle: boolean }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as { update?: () => void } | null;
  useFrame((_, dt) => {
    if (idle) {
      // gentle orbit around the hall centre
      const r = Math.hypot(camera.position.x, camera.position.z);
      const a = Math.atan2(camera.position.z, camera.position.x) + dt * 0.03;
      camera.position.x = Math.cos(a) * r;
      camera.position.z = Math.sin(a) * r;
      camera.lookAt(0, 0, 0);
      controls?.update?.();
    }
  });
  return null;
}

/** Pulsing overhead work lights that tint the hall and gently flicker. */
function OverheadLights({ span }: { span: number }) {
  const l = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (l.current) l.current.intensity = 0.5 + 0.08 * Math.sin(clock.elapsedTime * 2);
  });
  return <pointLight ref={l} position={[0, span * 0.9, 0]} intensity={0.5} color="#bae6fd" distance={span * 4} />;
}

export default function FactoryMap({ machineIds }: { machineIds?: string[] } = {}) {
  const fullFactory = useStore((s) => s.factory);
  // Optional subset (e.g. one production line of the plant).
  const factory = useMemo(() => {
    const machines = machineIds ? fullFactory.machines.filter((m) => machineIds.includes(m.id)) : fullFactory.machines;
    // The hall is drawn around the origin: centre the shown machines on it (a plant line can sit far from 0).
    const xs = machines.map((m) => m.position[0]);
    const zs = machines.map((m) => m.position[2]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    return {
      ...fullFactory,
      machines: machines.map((m) => ({ ...m, position: [m.position[0] - cx, m.position[1], m.position[2] - cz] as [number, number, number] })),
      faults: machineIds ? fullFactory.faults.filter((f) => machineIds.includes(f.machineId)) : fullFactory.faults,
    };
  }, [fullFactory, machineIds]);
  const statuses = useStore((s) => s.statuses);
  const selected = useStore((s) => s.selectedMachine);
  const selectMachine = useStore((s) => s.selectMachine);
  const openMenu = useHistoryUi((s) => s.openMenu);
  // Each machine (and the bottle flow) follows the protective-stop state of its own line.
  const lines = useStore((s) => s.lines);
  const plantModel = useStore((s) => s.plant);
  const lineRunning = (machineId: string) => lineStateOf({ plant: plantModel, lines }, machineId).running;
  const bypassed = useStore((s) => s.bypassed);
  const haltOf = (machineId: string) => {
    const ls = lineStateOf({ plant: plantModel, lines }, machineId);
    if (bypassed[machineId]) return 'bypassed' as const;
    return ls.running ? null : ls.trippedBy?.machineId === machineId ? ('tripped' as const) : ('stopped' as const);
  };
  const incidents = useStore((s) => s.incidents);
  const selectedIncident = useStore((s) => s.selectedIncident);
  const running = useStore((s) => s.running);
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [idle, setIdle] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 6000);
  };

  const layout = useMemo(() => computeLayout(factory), [factory]);
  const byId = useMemo(() => new Map(factory.machines.map((m) => [m.id, m])), [factory]);
  const center = (id: string) => {
    const m = byId.get(id)!;
    return new THREE.Vector3(m.position[0], 1.2, m.position[2]);
  };

  const inc = selectedIncident ? incidents[selectedIncident] : Object.values(incidents).find((i) => i.status !== 'chiuso');
  const causal = inc && inc.causalPath.length > 1 ? inc.causalPath : null;
  const onPath = new Set(inc?.causalPath ?? []);

  // Bottles take the twin of a bypassed machine (automatic reroute).
  const flow = useMemo(
    () =>
      layout.flow
        .map((id) => bypassed[id]?.sibling ?? id)
        .filter((id) => byId.has(id))
        .map((id) => new THREE.Vector3(byId.get(id)!.position[0], 1, byId.get(id)!.position[2])),
    [layout, byId, bypassed],
  );
  const span = Math.max(layout.hall.w, layout.hall.d) / 2;

  return (
    <div className="relative h-full w-full">
      {/* View toggle */}
      <div className="absolute right-4 top-4 z-10 flex overflow-hidden rounded-lg ring-1 ring-inset ring-white/15 backdrop-blur">
        {(['3d', '2d'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`px-3 py-1 text-xs font-semibold transition ${view === v ? 'bg-sky-500 text-white' : 'bg-slate-900/70 text-slate-300 hover:bg-slate-800'}`}
          >
            {v === '3d' ? '3D' : '2D'}
          </button>
        ))}
      </div>

      {view === '2d' ? (
        <FactoryMap2D machineIds={machineIds} />
      ) : (
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, toneMappingExposure: 1.1 }}
        camera={{ position: [span * 0.15, span * 0.85, span * 1.15], fov: 42 }}
        onPointerMissed={() => selectMachine(null)}
        onPointerDown={wake}
        onWheel={wake}
      >
        <color attach="background" args={['#060b16']} />
        <fog attach="fog" args={['#060b16', span * 2.6, span * 5]} />
        <SoftShadows size={28} samples={12} />
        {/* Procedural studio environment for metal reflections. No network: lightformers only. */}
        <Environment resolution={128} environmentIntensity={0.55}>
          <Lightformer form="rect" intensity={2} position={[0, span, span]} scale={[span * 2, span, 1]} color="#bfe3ff" />
          <Lightformer form="rect" intensity={1.2} position={[span, span, -span]} scale={[span, span, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={0.8} position={[-span, span * 0.6, 0]} rotation={[0, Math.PI / 2, 0]} scale={[span, span, 1]} color="#94a3b8" />
        </Environment>
        <ambientLight intensity={0.25} />
        <directionalLight position={[span, span * 2, span]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} />
        <hemisphereLight args={['#93c5fd', '#0b1220', 0.3]} />
        <OverheadLights span={span} />
        <ContactShadows position={[0, 0.02, 0]} scale={span * 2.4} far={span} blur={2.5} opacity={0.5} color="#000000" />

        <Hall layout={layout} />
        <FloorPlan layout={layout} />
        <Conveyor points={flow} />
        {layout.props.map((p, i) => (
          <SceneProp key={i} prop={p} />
        ))}

        {causal && <CausalPath points={causal.map((id) => center(id).add(new THREE.Vector3(0, 0.8, 0)))} moving={running && lineRunning(causal[0]!)} />}
        <Bottles path={flow} speed={running && lineRunning(layout.flow[0] ?? '') ? 1 : 0} />

        {factory.machines.map((m) => (
          <MachineMesh
            key={m.id}
            m={m}
            status={statuses[m.id] ?? 'verde'}
            running={running && lineRunning(m.id)}
            halt={haltOf(m.id)}
            selected={selected === m.id}
            onPath={Boolean(causal) && onPath.has(m.id)}
            onSelect={() => selectMachine(m.id)}
            onMenu={(x, y) => openMenu(m.id, x, y)}
          />
        ))}

        <EffectComposer enableNormalPass={false}>
          <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.9} luminanceSmoothing={0.3} />
          <Vignette eskil={false} offset={0.25} darkness={0.7} />
        </EffectComposer>

        <CameraRig idle={idle} />
        <OrbitControls
          makeDefault
          enabled={view === '3d'}
          onStart={wake}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={span * 0.6}
          maxDistance={span * 4}
          enableDamping
        />
      </Canvas>
      )}
    </div>
  );
}
