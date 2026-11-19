import type { BlockId } from './voxels'

export type Cell = [number, number, number, BlockId]

export interface Blueprint {
  cells: Cell[]
  halfX: number
  halfZ: number
  height: number
}

type Roof = 'flat' | 'pyramid' | 'gable' | 'dome' | 'battlement'
type Windows = 'pairs' | 'band' | 'sparse'
type Extra = 'none' | 'chimney' | 'flag' | 'beacon'

export interface BuildingSpec {
  seed: number
  halfX: number
  halfZ: number
  floors: number
  floorHeight: number
  wall: BlockId
  corner: BlockId
  material: string
  windows: Windows
  roof: Roof
  extra: Extra
  trim: boolean
  awning: boolean
}

const WALLS: Array<{ wall: BlockId; corner: BlockId; material: string }> = [
  { wall: 'planks', corner: 'log', material: 'дерево' },
  { wall: 'brick', corner: 'stoneBrick', material: 'цегла' },
  { wall: 'stoneBrick', corner: 'stone', material: 'камінь' },
  { wall: 'plaster', corner: 'log', material: 'тиньк і дерево' },
  { wall: 'plaster', corner: 'stoneBrick', material: 'тиньк і камінь' },
  { wall: 'stone', corner: 'log', material: 'бут і дерево' },
]

const ROOF_LABELS: Record<Roof, string> = {
  flat: 'плаский дах',
  pyramid: 'шатровий дах',
  gable: 'двосхилий дах',
  dome: 'купол',
  battlement: 'зубчастий дах',
}

export const MAX_SEED = 2147483647

export function randomSeed() {
  return 1 + Math.floor(Math.random() * (MAX_SEED - 1))
}

function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rnd: () => number, items: readonly T[], weights?: readonly number[]): T {
  if (!weights) {
    return items[Math.floor(rnd() * items.length)]
  }
  const total = weights.reduce((sum, w) => sum + w, 0)
  let roll = rnd() * total
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]
    if (roll <= 0) {
      return items[i]
    }
  }
  return items[items.length - 1]
}

export function specFromSeed(seed: number): BuildingSpec {
  const rnd = random(seed)
  const floors = pick(rnd, [1, 2, 3, 4], [3, 4, 2, 1])
  const tall = floors >= 3
  const halfX = tall ? pick(rnd, [2, 3]) : pick(rnd, [2, 3, 3, 4])
  const halfZ = tall ? 2 : pick(rnd, [2, 2, 3])
  const material = pick(rnd, WALLS)
  const squareish = Math.abs(halfX - halfZ) <= 1
  const roofs: Roof[] = ['flat', 'pyramid', 'gable', ...(squareish ? (['dome'] as Roof[]) : []), ...(tall ? (['battlement', 'battlement'] as Roof[]) : [])]
  return {
    seed,
    halfX,
    halfZ,
    floors,
    floorHeight: pick(rnd, [3, 4], [2, 1]),
    wall: material.wall,
    corner: material.corner,
    material: material.material,
    windows: pick(rnd, ['pairs', 'band', 'sparse'] as const),
    roof: pick(rnd, roofs),
    extra: pick(rnd, ['none', 'chimney', 'flag', 'beacon'] as const, [3, 2, 2, 2]),
    trim: rnd() < 0.6,
    awning: rnd() < 0.4,
  }
}

function plural(n: number) {
  const last = n % 10
  const tens = n % 100
  if (last === 1 && tens !== 11) {
    return 'поверх'
  }
  return last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? 'поверхи' : 'поверхів'
}

export function describeBuilding(seed: number) {
  const spec = specFromSeed(seed)
  const kind = spec.floors >= 3 ? 'Вежа' : spec.halfX >= 4 ? 'Зала' : 'Будинок'
  return `${kind}, ${spec.floors} ${plural(spec.floors)}, ${spec.material}, ${ROOF_LABELS[spec.roof]}`
}

export function generateBuilding(seed: number, color: string): Blueprint {
  const spec = specFromSeed(seed)
  const { halfX, halfZ, floors, floorHeight, wall, corner } = spec
  const accent = `accent:${color}`
  const roofBlock = `roof:${color}`
  const groundHeight = Math.max(floorHeight, 3)
  const height = groundHeight + (floors - 1) * floorHeight
  const cells = new Map<string, Cell>()
  const put = (x: number, y: number, z: number, id: BlockId) => cells.set(`${x},${y},${z}`, [x, y, z, id])

  const floorBase = (floor: number) => (floor === 0 ? 0 : groundHeight + (floor - 1) * floorHeight)

  for (let floor = 0; floor < floors; floor++) {
    const base = floorBase(floor)
    const top = floor === 0 ? groundHeight : floorHeight
    for (let dy = 0; dy < top; dy++) {
      const y = base + dy
      const lastRow = dy === top - 1
      for (let x = -halfX; x <= halfX; x++) {
        for (let z = -halfZ; z <= halfZ; z++) {
          const onX = Math.abs(x) === halfX
          const onZ = Math.abs(z) === halfZ
          if (!onX && !onZ) {
            continue
          }
          if (onX && onZ) {
            put(x, y, z, corner)
            continue
          }
          if (floor === 0 && x === 0 && z === halfZ && y <= 1) {
            continue
          }
          if (lastRow && (spec.trim || floor === floors - 1)) {
            put(x, y, z, accent)
            continue
          }
          const along = onZ ? x : z
          const half = onZ ? halfX : halfZ
          const windowRow = dy === 1 || (dy === 2 && top >= 4)
          const frontDoorArea = floor === 0 && z === halfZ && Math.abs(x) <= 1
          let glass = false
          if (windowRow && !frontDoorArea && Math.abs(along) < half) {
            if (spec.windows === 'band') {
              glass = true
            } else if (spec.windows === 'pairs') {
              glass = along !== 0 && Math.abs(along) % 2 === 0
            } else {
              glass = Math.abs(along) === half - 1
            }
          }
          put(x, y, z, glass ? 'glass' : wall)
        }
      }
    }
  }

  put(0, 2, halfZ, 'lamp')
  if (spec.awning) {
    for (let x = -1; x <= 1; x++) {
      put(x, 2, halfZ + 1, roofBlock)
    }
  }

  let roofTop = height
  if (spec.roof === 'flat' || spec.roof === 'battlement') {
    for (let x = -halfX; x <= halfX; x++) {
      for (let z = -halfZ; z <= halfZ; z++) {
        put(x, height, z, spec.roof === 'flat' ? wall : 'stoneBrick')
      }
    }
    for (let x = -halfX - 1; x <= halfX + 1; x++) {
      for (let z = -halfZ - 1; z <= halfZ + 1; z++) {
        const edge = Math.abs(x) === halfX + 1 || Math.abs(z) === halfZ + 1
        if (!edge) {
          continue
        }
        put(x, height, z, accent)
        if (spec.roof === 'battlement' && (x + z) % 2 === 0) {
          put(x, height + 1, z, accent)
        }
      }
    }
    roofTop = height + (spec.roof === 'battlement' ? 2 : 1)
  } else if (spec.roof === 'pyramid') {
    let level = 0
    for (let hx = halfX + 1, hz = halfZ + 1; hx >= 0 && hz >= 0; hx--, hz--, level++) {
      for (let x = -hx; x <= hx; x++) {
        for (let z = -hz; z <= hz; z++) {
          put(x, height + level, z, roofBlock)
        }
      }
    }
    roofTop = height + level
  } else if (spec.roof === 'gable') {
    let level = 0
    for (let hz = halfZ + 1; hz >= 0; hz--, level++) {
      for (let x = -halfX - 1; x <= halfX + 1; x++) {
        for (let z = -hz; z <= hz; z++) {
          const inner = Math.abs(z) < hz && Math.abs(x) === halfX
          put(x, height + level, z, Math.abs(z) === hz || Math.abs(x) > halfX ? roofBlock : inner ? wall : roofBlock)
        }
      }
    }
    roofTop = height + level
  } else {
    const radius = Math.max(halfX, halfZ) + 0.6
    let level = 0
    for (let y = 0; y <= Math.ceil(radius); y++) {
      for (let x = -halfX; x <= halfX; x++) {
        for (let z = -halfZ; z <= halfZ; z++) {
          const d = Math.hypot(x, y * 1.05, z)
          if (d <= radius && d > radius - 1.3) {
            put(x, height + y, z, y % 2 ? 'glass' : accent)
            level = Math.max(level, y + 1)
          }
        }
      }
    }
    roofTop = height + level
  }

  if (spec.extra === 'chimney') {
    const cx = halfX - 1
    const cz = -halfZ + 1
    for (let y = height; y <= roofTop + 1; y++) {
      put(cx, y, cz, 'stoneBrick')
    }
    roofTop += 2
  } else if (spec.extra === 'flag') {
    for (let y = roofTop; y < roofTop + 4; y++) {
      put(halfX, y, -halfZ, 'log')
    }
    for (let y = roofTop + 2; y < roofTop + 4; y++) {
      for (let x = halfX - 3; x < halfX; x++) {
        put(x, y, -halfZ, accent)
      }
    }
    roofTop += 4
  } else if (spec.extra === 'beacon') {
    put(0, roofTop, 0, 'lamp')
    roofTop += 1
  }

  return { cells: [...cells.values()], halfX, halfZ, height: roofTop }
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
