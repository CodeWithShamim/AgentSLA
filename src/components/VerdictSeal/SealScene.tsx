import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { easeCourt } from '../../design/motion'

/** Deliberation + convergence phases of the Verdict Seal ceremony (§7).
 *  N validator nodes orbit a faint ring, then spiral inward, taking the
 *  verdict hue as they agree. The stamp itself is the SVG layer above. */

const NODE_COUNT = 13
const DELIBERATE_MS = 750
const CONVERGE_MS = 650
// Each node converges on its own clock: staggered starts, one shared
// duration, and the last three land within ~60ms of each other —
// consensus snapping shut, not a synchronized dance.
const CONVERGE_NODE_MS = CONVERGE_MS - 200

function convergeDelay(i: number): number {
  const lastThree = NODE_COUNT - 3
  if (i >= lastThree) return 140 + (i - lastThree) * 30 // 140 / 170 / 200
  return (i / lastThree) * 120
}

function Nodes({ inkColor, hueColor, onDone }: {
  inkColor: string
  hueColor: string
  onDone: () => void
}) {
  const group = useRef<THREE.Group>(null)
  const done = useRef(false)
  const ink = useMemo(() => new THREE.Color(inkColor), [inkColor])
  const hue = useMemo(() => new THREE.Color(hueColor), [hueColor])
  const start = useMemo(() => performance.now(), [])

  const seeds = useMemo(
    () =>
      Array.from({ length: NODE_COUNT }, (_, i) => ({
        angle: (i / NODE_COUNT) * Math.PI * 2,
        speed: 0.5 + (i % 4) * 0.14,
        wobble: 4 + (i % 3) * 3,
        delay: convergeDelay(i),
      })),
    [],
  )

  useFrame(() => {
    const g = group.current
    if (!g) return
    const t = performance.now() - start

    if (t >= DELIBERATE_MS + CONVERGE_MS && !done.current) {
      done.current = true
      onDone()
    }

    let ringFade = 1
    g.children.forEach((child, i) => {
      const s = seeds[i]
      const mesh = child as THREE.Mesh
      const mat = mesh.material as THREE.MeshBasicMaterial
      if (!s) {
        // the faint deliberation ring, not a validator node
        mat.opacity = 0.18 * ringFade
        return
      }
      // Per-node convergence progress
      const mix =
        t < DELIBERATE_MS + s.delay
          ? 0
          : easeCourt(Math.min(1, (t - DELIBERATE_MS - s.delay) / CONVERGE_NODE_MS))
      const radius = 110 * (1 - mix)
      const fade = 1 - mix * 0.9
      if (i === 0) ringFade = 1 - Math.min(1, Math.max(0, (t - DELIBERATE_MS) / CONVERGE_MS))

      const spiral = mix * Math.PI * 0.8
      const a = s.angle + t * 0.001 * s.speed + spiral
      const wob = Math.sin(performance.now() * 0.003 + i) * s.wobble * (1 - mix)
      child.position.set(Math.cos(a) * (radius + wob), Math.sin(a) * (radius + wob), 0)
      mat.color.copy(ink).lerp(hue, mix)
      mat.opacity = t >= DELIBERATE_MS + CONVERGE_MS ? 0 : fade
    })
  })

  return (
    <group ref={group}>
      {seeds.map((_, i) => (
        <mesh key={i}>
          <circleGeometry args={[3.2, 20]} />
          <meshBasicMaterial transparent opacity={1} />
        </mesh>
      ))}
      {/* faint deliberation ring */}
      <mesh>
        <ringGeometry args={[109.4, 110.2, 96]} />
        <meshBasicMaterial color={inkColor} transparent opacity={0.18} />
      </mesh>
    </group>
  )
}

export function SealScene({ inkColor, hueColor, onDone }: {
  inkColor: string
  hueColor: string
  onDone: () => void
}) {
  return (
    <Canvas
      orthographic
      camera={{ zoom: 1, position: [0, 0, 100] }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      dpr={[1, 2]}
      style={{ position: 'absolute', inset: 0 }}
      aria-hidden
    >
      <Nodes inkColor={inkColor} hueColor={hueColor} onDone={onDone} />
    </Canvas>
  )
}
