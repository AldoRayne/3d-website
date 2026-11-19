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

  private hidden(x: number, y: number, z: number) {
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      const neighbour = this.get(x + dx, y + dy, z + dz)
      if (!neighbour || !blockDef(neighbour).opaque) {
        return false
      }
    }
    return true
  }

  build(options: { shadows: boolean }) {
    const groups = new Map<BlockId, THREE.Vector3[]>()
    for (const cell of this.cells.values()) {
      if (blockDef(cell.id).opaque && this.hidden(cell.x, cell.y, cell.z)) {
        continue
      }
      const list = groups.get(cell.id) ?? []
      list.push(new THREE.Vector3(cell.x, cell.y + 0.5, cell.z))
      groups.set(cell.id, list)
    }

    const root = new THREE.Group()
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const matrix = new THREE.Matrix4()
    for (const [id, positions] of groups) {
      const def = blockDef(id)
      const mesh = new THREE.InstancedMesh(geometry, def.materials, positions.length)
      positions.forEach((position, index) => {
        matrix.makeTranslation(position.x, position.y, position.z)
        mesh.setMatrixAt(index, matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
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
