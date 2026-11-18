import type { WorldObjectType } from '@/types'
import type { BlockId } from './voxels'

export type Cell = [number, number, number, BlockId]

export interface Blueprint {
  cells: Cell[]
  halfX: number
  halfZ: number
  height: number
}

type Painter = (x: number, y: number, z: number, edge: { corner: boolean; face: 'x' | 'z' | null }) => BlockId | null

function box(halfX: number, halfZ: number, height: number, paint: Painter, cells: Cell[] = []) {
  for (let y = 0; y < height; y++) {
    for (let x = -halfX; x <= halfX; x++) {
      for (let z = -halfZ; z <= halfZ; z++) {
        const onX = Math.abs(x) === halfX
        const onZ = Math.abs(z) === halfZ
        if (!onX && !onZ) {
          continue
        }
        const id = paint(x, y, z, { corner: onX && onZ, face: onX && onZ ? null : onZ ? 'z' : 'x' })
        if (id) {
          cells.push([x, y, z, id])
        }
      }
    }
  }
  return cells
}

function slab(halfX: number, halfZ: number, y: number, id: BlockId, cells: Cell[]) {
  for (let x = -halfX; x <= halfX; x++) {
    for (let z = -halfZ; z <= halfZ; z++) {
      cells.push([x, y, z, id])
    }
  }
}

function rim(halfX: number, halfZ: number, y: number, id: BlockId, cells: Cell[], every = 1) {
  for (let x = -halfX; x <= halfX; x++) {
    for (let z = -halfZ; z <= halfZ; z++) {
      if ((Math.abs(x) === halfX || Math.abs(z) === halfZ) && (x + z) % every === 0) {
        cells.push([x, y, z, id])
      }
    }
  }
}

const isDoor = (x: number, y: number, z: number, halfZ: number) => x === 0 && z === halfZ && y <= 1

function house(color: string): Blueprint {
  const halfX = 3
  const halfZ = 3
  const cells = box(halfX, halfZ, 5, (x, y, z, edge) => {
    if (isDoor(x, y, z, halfZ)) {
      return null
    }
    if (edge.corner) {
      return 'log'
    }
    if (y === 4) {
      return `accent:${color}`
    }
    const along = edge.face === 'z' ? x : z
    if ((y === 1 || y === 2) && Math.abs(along) === 2) {
      return 'glass'
    }
    if (y === 3 && z === halfZ && Math.abs(x) === 1) {
      return 'lamp'
    }
    return 'planks'
  })
  for (let level = 0; level < 5; level++) {
    const half = 4 - level
    slab(half, half, 5 + level, `roof:${color}`, cells)
  }
  return { cells, halfX, halfZ, height: 10 }
}

function tower(color: string): Blueprint {
  const halfX = 2
  const halfZ = 2
  const height = 13
  const cells = box(halfX, halfZ, height, (x, y, z, edge) => {
    if (isDoor(x, y, z, halfZ)) {
      return null
    }
    if (edge.corner) {
      return 'stone'
    }
    if (y === height - 1 || y === 6) {
      return `accent:${color}`
    }
    const along = edge.face === 'z' ? x : z
    if (along === 0 && (y === 4 || y === 9 || y === 10)) {
      return 'glass'
    }
    return 'stoneBrick'
  })
  slab(halfX, halfZ, height, 'stoneBrick', cells)
  rim(halfX + 1, halfZ + 1, height, `accent:${color}`, cells)
  rim(halfX + 1, halfZ + 1, height + 1, `accent:${color}`, cells, 2)
  cells.push([0, height + 1, 0, 'lamp'], [0, 2, halfZ, 'lamp'])
  return { cells, halfX, halfZ, height: height + 2 }
}

function library(color: string): Blueprint {
  const halfX = 4
  const halfZ = 3
  const height = 6
  const cells = box(halfX, halfZ, height, (x, y, z, edge) => {
    if (isDoor(x, y, z, halfZ)) {
      return null
    }
    if (edge.corner || y === 0) {
      return 'plaster'
    }
    if (y === height - 1) {
      return `accent:${color}`
    }
    const along = edge.face === 'z' ? x : z
    if (Math.abs(along) % 3 === 0 && along !== 0) {
      return 'plaster'
    }
    if (y >= 1 && y <= 3 && edge.face === 'z' && Math.abs(x) !== 1) {
      return 'shelf'
    }
    if (y >= 2 && y <= 3) {
      return 'glass'
    }
    return 'brick'
  })
  slab(halfX + 1, halfZ + 1, height, 'plaster', cells)
  rim(halfX + 1, halfZ + 1, height + 1, `roof:${color}`, cells)
  cells.push([-1, 2, halfZ, 'lamp'], [1, 2, halfZ, 'lamp'])
  return { cells, halfX, halfZ, height: height + 2 }
}

function gallery(color: string): Blueprint {
  const halfX = 5
  const halfZ = 3
  const height = 5
  const cells = box(halfX, halfZ, height, (x, y, z, edge) => {
    if (isDoor(x, y, z, halfZ)) {
      return null
    }
    if (edge.corner || y === 0 || y === height - 1) {
      return y === height - 1 ? `accent:${color}` : 'plaster'
    }
    const along = edge.face === 'z' ? x : z
    if (Math.abs(along) === 1 && edge.face === 'z') {
      return 'plaster'
    }
    return 'glass'
  })
  slab(halfX, halfZ, height, 'plaster', cells)
  for (const x of [-3, 3]) {
    cells.push([x, height + 1, 0, `accent:${color}`], [x, height + 2, 0, `accent:${color}`])
  }
  cells.push([0, height + 1, 0, `accent:${color}`], [0, height + 2, 0, `accent:${color}`], [0, height + 3, 0, 'lamp'])
  return { cells, halfX, halfZ, height: height + 4 }
}

function dome(color: string): Blueprint {
  const halfX = 4
  const halfZ = 4
  const wall = 3
  const cells = box(halfX, halfZ, wall, (x, y, z, edge) => {
    if (isDoor(x, y, z, halfZ)) {
      return null
    }
    if (edge.corner) {
      return 'stone'
    }
    return y === wall - 1 ? `accent:${color}` : 'plaster'
  })
  const radius = 4.6
  for (let y = 0; y <= 5; y++) {
    for (let x = -halfX; x <= halfX; x++) {
      for (let z = -halfZ; z <= halfZ; z++) {
        const d = Math.hypot(x, y * 1.05, z)
        if (d <= radius && d > radius - 1.2) {
          cells.push([x, wall + y, z, y % 2 ? 'glass' : `accent:${color}`])
        }
      }
    }
  }
  cells.push([0, wall + 5, 0, 'lamp'])
  return { cells, halfX, halfZ, height: wall + 6 }
}

function portal(color: string): Blueprint {
  const halfX = 3
  const halfZ = 2
  const height = 4
  const cells = box(halfX, halfZ, height, (x, y, z, edge) => {
    if (isDoor(x, y, z, halfZ)) {
      return null
    }
    if (edge.corner) {
      return 'log'
    }
    if (y === height - 1) {
      return `accent:${color}`
    }
    return 'stoneBrick'
  })
  slab(halfX, halfZ, height, `roof:${color}`, cells)
  for (let y = 0; y < 5; y++) {
    cells.push([halfX, height + 1 + y, -halfZ, 'log'])
  }
  for (let y = 0; y < 2; y++) {
    for (let x = 1; x <= 3; x++) {
      cells.push([halfX - x, height + 4 - y, -halfZ, `accent:${color}`])
    }
  }
  cells.push([-1, 2, halfZ, 'lamp'], [1, 2, halfZ, 'lamp'])
  return { cells, halfX, halfZ, height: height + 6 }
}

const blueprints: Record<WorldObjectType, (color: string) => Blueprint> = {
  building: house,
  tower,
  library,
  gallery,
  dome,
  portal,
}

export function blueprint(type: WorldObjectType, color: string): Blueprint {
  return (blueprints[type] ?? house)(color)
}

export function rotateCell(x: number, z: number, quarter: number): [number, number] {
  switch (((quarter % 4) + 4) % 4) {
    case 1:
      return [z, -x]
    case 2:
      return [-x, -z]
    case 3:
      return [-z, x]
    default:
      return [x, z]
  }
}
