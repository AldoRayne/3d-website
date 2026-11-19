import * as THREE from 'three'
import { seeThrough } from './foliage'
import { texture } from './textures'

export type BlockId = string

interface BlockDef {
  materials: THREE.Material | THREE.Material[]
  opaque: boolean
}

const materialCache = new Map<BlockId, BlockDef>()

function lambert(map: THREE.Texture, options: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ map, ...options })
}

function sides(side: THREE.Material, top: THREE.Material, bottom: THREE.Material = top) {
  return [side, side, top, bottom, side, side]
}

export function blockDef(id: BlockId): BlockDef {
  const cached = materialCache.get(id)
  if (cached) {
    return cached
  }
  const [kind, arg = ''] = id.split(':')
  let def: BlockDef
  switch (kind) {
    case 'grass':
      def = {
        materials: sides(lambert(texture('grassSide')), lambert(texture('grassTop')), lambert(texture('dirt'))),
        opaque: true,
      }
      break
    case 'path':
      def = { materials: sides(lambert(texture('dirt')), lambert(texture('path')), lambert(texture('dirt'))), opaque: true }
      break
    case 'log':
      def = { materials: sides(lambert(texture('logSide')), lambert(texture('logTop'))), opaque: true }
      break
    case 'glass':
      def = {
        materials: lambert(texture('glass'), { transparent: true, depthWrite: false, side: THREE.DoubleSide }),
        opaque: false,
      }
      break
    case 'leaves':
      def = { materials: lambert(texture('leaves')), opaque: true }
      break
    case 'foliage':
      def = { materials: seeThrough(lambert(texture('leaves'))), opaque: true }
      break
    case 'lamp':
      def = { materials: lambert(texture('lamp'), { emissive: new THREE.Color('#ffcf5a'), emissiveIntensity: 0.9 }), opaque: true }
      break
    case 'cloud':
      def = { materials: lambert(texture('cloud'), { transparent: true, opacity: 0.92 }), opaque: false }
      break
    case 'accent':
    case 'roof':
      def = { materials: lambert(texture(kind, arg)), opaque: true }
      break
    default:
      def = { materials: lambert(texture(kind)), opaque: true }
  }
  materialCache.set(id, def)
  return def
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`

interface Face {
  axis: 0 | 1 | 2
  sign: 1 | -1
  slot: number
  u: 0 | 1 | 2
  v: 0 | 1 | 2
  uv: (p: THREE.Vector3) => [number, number]
}

const FACES: Face[] = [
  { axis: 0, sign: 1, slot: 0, u: 2, v: 1, uv: (p) => [0.5 - p.z, p.y] },
  { axis: 0, sign: -1, slot: 1, u: 2, v: 1, uv: (p) => [p.z + 0.5, p.y] },
  { axis: 1, sign: 1, slot: 2, u: 0, v: 2, uv: (p) => [p.x + 0.5, 0.5 - p.z] },
  { axis: 1, sign: -1, slot: 3, u: 0, v: 2, uv: (p) => [p.x + 0.5, p.z + 0.5] },
  { axis: 2, sign: 1, slot: 4, u: 0, v: 1, uv: (p) => [p.x + 0.5, p.y] },
  { axis: 2, sign: -1, slot: 5, u: 0, v: 1, uv: (p) => [0.5 - p.x, p.y] },
]

const low = (axis: number, index: number) => (axis === 1 ? index : index - 0.5)

class FaceBuffer {
  positions: number[] = []
  normals: number[] = []
  uvs: number[] = []
}

export class VoxelGrid {
  private cells = new Map<string, { x: number; y: number; z: number; id: BlockId }>()

  set(x: number, y: number, z: number, id: BlockId) {
    this.cells.set(key(x, y, z), { x, y, z, id })
  }

  get(x: number, y: number, z: number) {
    return this.cells.get(key(x, y, z))?.id
  }

  delete(x: number, y: number, z: number) {
    this.cells.delete(key(x, y, z))
  }

  private exposed(id: BlockId, x: number, y: number, z: number) {
    const neighbour = this.get(x, y, z)
    return !neighbour || (neighbour !== id && !blockDef(neighbour).opaque)
  }

  private quads(id: BlockId, list: Array<{ x: number; y: number; z: number }>, face: Face, out: FaceBuffer) {
    const step = [0, 0, 0]
    step[face.axis] = face.sign
    const slices = new Map<number, Set<string>>()
    for (const cell of list) {
      const coords = [cell.x, cell.y, cell.z]
      if (!this.exposed(id, cell.x + step[0], cell.y + step[1], cell.z + step[2])) {
        continue
      }
      const slice = coords[face.axis]
      let set = slices.get(slice)
      if (!set) {
        set = new Set()
        slices.set(slice, set)
      }
      set.add(`${coords[face.u]},${coords[face.v]}`)
    }
    const normal = [0, 0, 0]
    normal[face.axis] = face.sign
    const point = (plane: number, u: number, v: number) => {
      const p = [0, 0, 0]
      p[face.axis] = plane
      p[face.u] = u
      p[face.v] = v
      return new THREE.Vector3(p[0], p[1], p[2])
    }
    for (const [slice, set] of slices) {
      const plane = low(face.axis, slice) + (face.sign > 0 ? 1 : 0)
      const cells = [...set].map((entry) => entry.split(',').map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0])
      const used = new Set<string>()
      for (const [u0, v0] of cells) {
        if (used.has(`${u0},${v0}`)) {
          continue
        }
        let width = 1
        while (set.has(`${u0 + width},${v0}`) && !used.has(`${u0 + width},${v0}`)) {
          width++
        }
        let height = 1
        grow: for (;;) {
          for (let du = 0; du < width; du++) {
            const next = `${u0 + du},${v0 + height}`
            if (!set.has(next) || used.has(next)) {
              break grow
            }
          }
          height++
        }
        for (let dv = 0; dv < height; dv++) {
          for (let du = 0; du < width; du++) {
            used.add(`${u0 + du},${v0 + dv}`)
          }
        }
        const uLow = low(face.u, u0)
        const vLow = low(face.v, v0)
        const a = point(plane, uLow, vLow)
        const b = point(plane, uLow + width, vLow)
        const c = point(plane, uLow + width, vLow + height)
        const d = point(plane, uLow, vLow + height)
        const facing = new THREE.Vector3().crossVectors(b.clone().sub(a), d.clone().sub(a)).dot(new THREE.Vector3(normal[0], normal[1], normal[2])) > 0
        const triangles = facing ? [a, b, c, a, c, d] : [a, c, b, a, d, c]
        for (const vertex of triangles) {
          out.positions.push(vertex.x, vertex.y, vertex.z)
          out.normals.push(normal[0], normal[1], normal[2])
          const [tu, tv] = face.uv(vertex)
          out.uvs.push(tu, tv)
        }
      }
    }
  }

  build(options: { shadows: boolean }) {
    const groups = new Map<BlockId, Array<{ x: number; y: number; z: number }>>()
    for (const cell of this.cells.values()) {
      const list = groups.get(cell.id) ?? []
      list.push(cell)
      groups.set(cell.id, list)
    }

    const root = new THREE.Group()
    for (const [id, list] of groups) {
      const def = blockDef(id)
      const slots = Array.isArray(def.materials) ? def.materials : [def.materials]
      const materials: THREE.Material[] = []
      const buffers: FaceBuffer[] = []
      for (const face of FACES) {
        const material = slots[Array.isArray(def.materials) ? face.slot : 0]
        let index = materials.indexOf(material)
        if (index < 0) {
          index = materials.push(material) - 1
          buffers.push(new FaceBuffer())
        }
        this.quads(id, list, face, buffers[index])
      }
      const vertices = buffers.reduce((sum, buffer) => sum + buffer.positions.length / 3, 0)
      if (!vertices) {
        continue
      }
      const positions = new Float32Array(vertices * 3)
      const normals = new Float32Array(vertices * 3)
      const uvs = new Float32Array(vertices * 2)
      const geometry = new THREE.BufferGeometry()
      let offset = 0
      buffers.forEach((buffer, index) => {
        const count = buffer.positions.length / 3
        positions.set(buffer.positions, offset * 3)
        normals.set(buffer.normals, offset * 3)
        uvs.set(buffer.uvs, offset * 2)
        geometry.addGroup(offset, count, index)
        offset += count
      })
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials)
      if (materials.length === 1) {
        geometry.clearGroups()
      }
      mesh.castShadow = options.shadows && def.opaque && id !== 'cloud'
      mesh.receiveShadow = options.shadows && id !== 'cloud'
      if (!def.opaque) {
        mesh.renderOrder = 1
      }
      root.add(mesh)
    }
    return root
  }
}
