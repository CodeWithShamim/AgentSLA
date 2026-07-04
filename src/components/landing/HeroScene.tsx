import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/** Act I ambient scene (v2 §3.1): 13 validator nodes orbiting slowly in
 *  depth. Fog carries the depth; flat basic materials — this is ink
 *  suspended in a dark room, not a 3D showcase. The canvas renders on
 *  demand at ≤30fps and stops entirely off-viewport. */

const NODE_COUNT = 13
const CHAMBER = '#0E141D'

/** frameloop="demand" + a 30fps invalidate keeps the idle hero cheap. */
function Throttle({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => invalidate(), 1000 / 30)
    return () => clearInterval(id)
  }, [active, invalidate])
  return null
}

function Nodes() {
  const group = useRef<THREE.Group>(null)
  const start = useMemo(() => performance.now(), [])

  const seeds = useMemo(
    () =>
      Array.from({ length: NODE_COUNT }, (_, i) => ({
        angle: (i / NODE_COUNT) * Math.PI * 2,
        radius: 4.6 + (i % 5) * 0.5,
        depth: ((i % 7) - 3) * 1.1,
        speed: 0.035 + (i % 4) * 0.012,
        tilt: 0.35 + (i % 3) * 0.08,
        size: 0.13 + (i % 3) * 0.03,
      })),
    [],
  )

  useFrame(() => {
    const g = group.current
    if (!g) return
    const t = (performance.now() - start) / 1000
    g.children.forEach((child, i) => {
      const s = seeds[i]
      if (!s) return
      const a = s.angle + t * s.speed
      child.position.set(
        Math.cos(a) * s.radius,
        Math.sin(a) * s.radius * s.tilt + Math.sin(t * 0.2 + i) * 0.25,
        s.depth + Math.sin(a * 0.7) * 1.6,
      )
    })
  })

  return (
    <group ref={group} rotation={[0.18, 0, -0.06]}>
      {seeds.map((s, i) => (
        <mesh key={i}>
          <sphereGeometry args={[s.size, 16, 16]} />
          <meshBasicMaterial color="#97A3B2" transparent opacity={0.85} />
        </mesh>
      ))}
      {/* faint bench ring, read edge-on */}
      <mesh rotation={[Math.PI / 2 - 0.35, 0, 0]}>
        <torusGeometry args={[5.1, 0.008, 8, 128]} />
        <meshBasicMaterial color="#5C6874" transparent opacity={0.35} />
      </mesh>
    </group>
  )
}

export function HeroScene({ active }: { active: boolean }) {
  return (
    <Canvas
      frameloop="demand"
      camera={{ position: [0, 0.4, 14], fov: 42 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      dpr={[1, 2]}
      style={{ position: 'absolute', inset: 0 }}
      aria-hidden
    >
      <fog attach="fog" args={[CHAMBER, 8, 30]} />
      <Throttle active={active} />
      <Nodes />
    </Canvas>
  )
}
