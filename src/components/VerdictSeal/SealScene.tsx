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
      })),
    [],
  )

  useFrame(() => {
    const g = group.current
    if (!g) return
    const t = performance.now() - start

    let radius = 110
    let mix = 0
    let fade = 1

    if (t < DELIBERATE_MS) {
      radius = 110
    } else if (t < DELIBERATE_MS + CONVERGE_MS) {
      const p = easeCourt((t - DELIBERATE_MS) / CONVERGE_MS)
      radius = 110 * (1 - p)
      mix = p
      fade = 1 - p * 0.9
    } else {
      if (!done.current) {
        done.current = true
        onDone()
      }
      fade = 0
    }

    g.children.forEach((child, i) => {
      const s = seeds[i]
      if (!s) return   // the faint deliberation ring, not a validator node
      const spiral = mix * Math.PI * 0.8
      const a = s.angle + (performance.now() - start) * 0.001 * s.speed + spiral
      const wob = Math.sin(performance.now() * 0.003 + i) * s.wobble * (1 - mix)
      child.position.set(Math.cos(a) * (radius + wob), Math.sin(a) * (radius + wob), 0)
      const mesh = child as THREE.Mesh
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.color.copy(ink).lerp(hue, mix)
      mat.opacity = fade
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
      gl={{ alpha: true, antialias: true }}
      style={{ position: 'absolute', inset: 0 }}
      aria-hidden
    >
      <Nodes inkColor={inkColor} hueColor={hueColor} onDone={onDone} />
    </Canvas>
  )
}
