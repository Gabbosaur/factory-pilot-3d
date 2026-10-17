'use client';
/** Digital-twin scene elements: hall shell, floor plan with department zones, conveyor, props. */
import { Line, Text } from '@react-three/drei';
import { useMemo } from 'react';

/** A Google Fonts woff that drei can load for in-canvas text (avoids DOM-based Html labels). */
export const TEXT_FONT = 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.17/files/inter-latin-700-normal.woff';
import * as THREE from 'three';
import type { FactoryLayout, Prop } from './layout';

const FLOOR_Y = 0;

/** Factory hall: floor slab + low perimeter walls (two left translucent so we can see inside). */
export function Hall({ layout }: { layout: FactoryLayout }) {
  const { w, d, wallH } = layout.hall;
  const t = 0.3;
  const wall = (key: string, x: number, z: number, sx: number, sz: number) => (
    <mesh key={key} position={[x, wallH / 2, z]} castShadow receiveShadow>
      <boxGeometry args={[sx, wallH, sz]} />
      <meshStandardMaterial color="#0f1a2e" transparent opacity={0.55} />
    </mesh>
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#1b2636" metalness={0.2} roughness={0.75} />
      </mesh>
      {/* back + front walls (front short so the camera sees the line) */}
      {wall('back', 0, -d / 2, w, t)}
      {wall('left', -w / 2, 0, t, d)}
      {wall('right', w / 2, 0, t, d)}
    </group>
  );
}

/** Floor-plan department zones: coloured rectangles with a label painted on the floor. */
export function FloorPlan({ layout }: { layout: FactoryLayout }) {
  return (
    <group>
      {layout.zones.map((z) => (
        <group key={z.type} position={[z.cx, 0.02, z.cz]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[z.w, z.d]} />
            <meshStandardMaterial color={z.color} transparent opacity={0.35} />
          </mesh>
          {/* dashed border */}
          <Line
            points={[
              [-z.w / 2, 0.03, -z.d / 2],
              [z.w / 2, 0.03, -z.d / 2],
              [z.w / 2, 0.03, z.d / 2],
              [-z.w / 2, 0.03, z.d / 2],
              [-z.w / 2, 0.03, -z.d / 2],
            ]}
            color={z.color}
            lineWidth={1.5}
            dashed
            dashSize={0.4}
            gapSize={0.25}
          />
          <Text
            font={TEXT_FONT}
            position={[0, 0.05, -z.d / 2 + 0.6]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.5}
            letterSpacing={0.08}
            color="#cbd5e1"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.01}
            outlineColor="#0b1220"
          >
            {z.label.toUpperCase()}
          </Text>
        </group>
      ))}
    </group>
  );
}

/** Continuous conveyor belt following the flow of machines, with side rails. */
export function Conveyor({ points }: { points: THREE.Vector3[] }) {
  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0);
    return new THREE.TubeGeometry(curve, points.length * 12, 0.5, 8, false);
  }, [points]);
  if (!geom) return null;
  return (
    <group>
      <mesh geometry={geom} receiveShadow>
        <meshStandardMaterial color="#334155" />
      </mesh>
    </group>
  );
}

/** Simple low-poly scene props to make the hall read as a real plant. */
export function SceneProp({ prop }: { prop: Prop }) {
  const { kind, x, z, rot } = prop;
  switch (kind) {
    case 'tank':
      return (
        <mesh position={[x, 1.4, z]} castShadow>
          <cylinderGeometry args={[1, 1, 2.8, 16]} />
          <meshStandardMaterial color="#64748b" metalness={0.3} roughness={0.6} />
        </mesh>
      );
    case 'rack':
      return (
        <group position={[x, 0, z]} rotation={[0, rot, 0]}>
          {[0.4, 1.4, 2.4].map((y) => (
            <mesh key={y} position={[0, y, 0]} castShadow>
              <boxGeometry args={[3, 0.15, 1.2]} />
              <meshStandardMaterial color="#475569" />
            </mesh>
          ))}
        </group>
      );
    case 'pallet':
      return (
        <mesh position={[x, 0.35, z]} rotation={[0, rot, 0]} castShadow>
          <boxGeometry args={[1.2, 0.7, 1.2]} />
          <meshStandardMaterial color="#a16207" />
        </mesh>
      );
    case 'forklift':
      return (
        <group position={[x, 0, z]} rotation={[0, rot, 0]}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[1.2, 1, 2]} />
            <meshStandardMaterial color="#f59e0b" />
          </mesh>
          <mesh position={[0, 1, 1]} castShadow>
            <boxGeometry args={[1, 0.1, 0.1]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
        </group>
      );
    case 'office':
      return (
        <group position={[x, 0, z]}>
          <mesh position={[0, 1.2, 0]} castShadow>
            <boxGeometry args={[4, 2.4, 3]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
          <mesh position={[0, 1.3, 1.51]}>
            <planeGeometry args={[3.4, 1.2]} />
            <meshStandardMaterial color="#38bdf8" transparent opacity={0.35} />
          </mesh>
        </group>
      );
  }
}
