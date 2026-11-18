import * as THREE from 'three'
import type { WorldObjectType } from '@/types'

export interface ProceduralModel {
  group: THREE.Group
  height: number
  footprint: number
  spinners: THREE.Object3D[]
  floaters: THREE.Object3D[]
  glowMaterials: THREE.MeshStandardMaterial[]
}

const BODY_COLOR = new THREE.Color('#0b1220')

function bodyMaterial(color: THREE.Color, options: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: color,
    emissiveIntensity: 0.06,
    roughness: 0.35,
    metalness: 0.6,
    ...options,
  })
}

function glowMaterial(color: THREE.Color, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0,
  })
}

function withEdges(mesh: THREE.Mesh, color: THREE.Color, opacity = 0.9) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 20),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  )
  mesh.add(edges)
  return mesh
}

function context(color: THREE.Color) {
  const glows: THREE.MeshStandardMaterial[] = []
  const glow = (intensity?: number) => {
    const material = glowMaterial(color, intensity)
    glows.push(material)
    return material
  }
  return { glows, glow }
}

function windowStrips(
  target: THREE.Object3D,
  width: number,
  depth: number,
  bottom: number,
  height: number,
  material: THREE.Material,
) {
  const rows = Math.max(1, Math.floor(height / 0.9))
  const geometryX = new THREE.BoxGeometry(width * 0.82, 0.08, 0.04)
  const geometryZ = new THREE.BoxGeometry(0.04, 0.08, depth * 0.82)
  for (let i = 0; i < rows; i++) {
    const y = bottom + 0.55 + i * 0.9
    for (const side of [-1, 1]) {
      const front = new THREE.Mesh(geometryX, material)
      front.position.set(0, y, (side * depth) / 2 + side * 0.02)
      target.add(front)
      const flank = new THREE.Mesh(geometryZ, material)
      flank.position.set((side * width) / 2 + side * 0.02, y, 0)
      target.add(flank)
    }
  }
}

function building(color: THREE.Color): ProceduralModel {
  const group = new THREE.Group()
  const { glows, glow } = context(color)
  const strips = glow(1.2)
  const tiers = [
    { w: 4.2, h: 3.4, d: 4.2 },
    { w: 3.3, h: 2.8, d: 3.3 },
    { w: 2.3, h: 2.2, d: 2.3 },
  ]
  let y = 0
  for (const tier of tiers) {
    const mesh = withEdges(new THREE.Mesh(new THREE.BoxGeometry(tier.w, tier.h, tier.d), bodyMaterial(color)), color)
    mesh.position.y = y + tier.h / 2
    group.add(mesh)
    windowStrips(group, tier.w, tier.d, y, tier.h - 0.4, strips)
    y += tier.h
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), glow())
  antenna.position.y = y + 0.9
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), glow(3))
  beacon.position.y = y + 1.9
  group.add(antenna, beacon)
  return { group, height: y + 2, footprint: 3.2, spinners: [], floaters: [], glowMaterials: glows }
}

function tower(color: THREE.Color): ProceduralModel {
  const group = new THREE.Group()
  const { glows, glow } = context(color)
  const base = withEdges(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 0.8, 6), bodyMaterial(color)), color)
  base.position.y = 0.4
  const shaft = withEdges(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.7, 10, 6), bodyMaterial(color)), color)
  shaft.position.y = 5.8
  group.add(base, shaft)

  const rings = new THREE.Group()
  for (const [i, height] of [3.2, 6, 8.6].entries()) {
    const radius = 1.75 - i * 0.22
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.45, 0.06, 8, 48), glow(2))
    ring.rotation.x = Math.PI / 2
    ring.position.y = height
    rings.add(ring)
  }
  group.add(rings)

  const spire = withEdges(new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 6), bodyMaterial(color)), color)
  spire.position.y = 12
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), glow(3))
  core.position.y = 14
  group.add(spire, core)
  return { group, height: 14.6, footprint: 2.7, spinners: [rings, core], floaters: [core], glowMaterials: glows }
}

function dome(color: THREE.Color): ProceduralModel {
  const group = new THREE.Group()
  const { glows, glow } = context(color)
  const base = withEdges(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.6, 32), bodyMaterial(color)), color)
  base.position.y = 0.3
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: BODY_COLOR,
      emissive: color,
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
      metalness: 0.2,
      side: THREE.DoubleSide,
    }),
  )
  shell.position.y = 0.6
  const lattice = new THREE.Mesh(
    new THREE.SphereGeometry(3.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.55 }),
  )
  lattice.position.y = 0.6
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), glow(2.5))
  core.position.y = 2
  group.add(base, shell, lattice, core)
  return { group, height: 4, footprint: 3.8, spinners: [lattice, core], floaters: [], glowMaterials: glows }
}

function library(color: THREE.Color): ProceduralModel {
  const group = new THREE.Group()
  const { glows, glow } = context(color)
  const base = withEdges(new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 3.6), bodyMaterial(color)), color)
  base.position.y = 0.3
  const roof = withEdges(new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.4, 4), bodyMaterial(color)), color)
  roof.position.y = 4.1
  group.add(base, roof)
  const columnGeometry = new THREE.CylinderGeometry(0.18, 0.18, 3.3, 10)
  for (let i = 0; i < 5; i++) {
    const column = new THREE.Mesh(columnGeometry, glow(0.9))
    column.position.set(-2 + i, 2.25, 1.5)
    group.add(column)
  }
  const back = withEdges(new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.3, 0.3), bodyMaterial(color)), color)
  back.position.set(0, 2.25, -1.5)
  group.add(back)

  const books = new THREE.Group()
  const palette = [0.85, 1.4, 1.1, 1.7, 1.2]
  for (let i = 0; i < palette.length; i++) {
    const book = withEdges(
      new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 1.1), i % 2 ? glow(palette[i]) : bodyMaterial(color)),
      color,
      0.8,
    )
    book.position.set(Math.sin(i * 1.3) * 0.35, 5.2 + i * 0.42, Math.cos(i * 1.7) * 0.25)
    book.rotation.y = i * 0.45
    books.add(book)
  }
  group.add(books)
  return { group, height: 7.6, footprint: 3, spinners: [books], floaters: [books], glowMaterials: glows }
}

function gallery(color: THREE.Color): ProceduralModel {
  const group = new THREE.Group()
  const { glows, glow } = context(color)
  const floor = withEdges(new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.4, 4.4), bodyMaterial(color)), color)
  floor.position.y = 0.2
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(7, 2.8, 4),
    new THREE.MeshStandardMaterial({
      color: '#0f1d33',
      emissive: color,
      emissiveIntensity: 0.05,
      transparent: true,
      opacity: 0.28,
      roughness: 0.05,
      metalness: 0.1,
      depthWrite: false,
    }),
  )
  glass.position.y = 1.8
  withEdges(glass, color)
  const roof = withEdges(new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.3, 4.8), bodyMaterial(color)), color)
  roof.position.y = 3.35
  group.add(floor, glass, roof)
  for (let i = 0; i < 4; i++) {
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.4), glow(0.6 + (i % 2) * 0.8))
    frame.position.set(-2.4 + i * 1.6, 1.8, -1.85)
    group.add(frame)
  }
  const sculpture = new THREE.Mesh(new THREE.TorusKnotGeometry(0.45, 0.14, 64, 8), glow(2.2))
  sculpture.position.set(0, 4.4, 0)
  group.add(sculpture)
  return { group, height: 5.2, footprint: 4, spinners: [sculpture], floaters: [sculpture], glowMaterials: glows }
}

function portal(color: THREE.Color): ProceduralModel {
  const group = new THREE.Group()
  const { glows, glow } = context(color)
  const base = withEdges(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 0.6, 8), bodyMaterial(color)), color)
  base.position.y = 0.3
  const ringGroup = new THREE.Group()
  ringGroup.position.y = 3.6
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.22, 16, 64), glow(2.2))
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
  )
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.04, 8, 64), glow(1.4))
  orbit.rotation.x = Math.PI / 2.6
  ringGroup.add(ring, inner, orbit)
  group.add(base, ringGroup)
  return { group, height: 6.4, footprint: 3, spinners: [orbit], floaters: [ringGroup], glowMaterials: glows }
}

const builders: Record<WorldObjectType, (color: THREE.Color) => ProceduralModel> = {
  building,
  tower,
  dome,
  library,
  gallery,
  portal,
}

export function createProceduralModel(type: WorldObjectType, hex: string): ProceduralModel {
  const color = new THREE.Color(hex)
  return (builders[type] ?? building)(color)
}

export function createPad(hex: string, radius: number) {
  const color = new THREE.Color(hex)
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius + 0.3, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: '#0a1324', roughness: 0.8, metalness: 0.3 }),
  )
  pad.position.y = 0.15
  withEdges(pad, color, 0.7)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius + 0.5, radius + 0.62, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.02
  const group = new THREE.Group()
  group.add(pad, ring)
  return { group, ring }
}
