import * as THREE from 'three'

export interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export class NavGrid {
  private blocked = new Set<string>()

  constructor(
    private radius: number,
    private colliders: Rect[],
    private clearance: number,
  ) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        if (Math.hypot(x, z) > radius - 1.5 || !this.isClear(new THREE.Vector2(x, z), clearance + 0.1)) {
          this.blocked.add(`${x},${z}`)
        }
      }
    }
  }

  isClear(point: THREE.Vector2, clearance = this.clearance) {
    if (Math.hypot(point.x, point.y) > this.radius - 1.2) {
      return false
    }
    return this.colliders.every((rect) => distanceToRect(point, rect) >= clearance)
  }

  private walkable(x: number, z: number) {
    return !this.blocked.has(`${x},${z}`)
  }

  private nearestWalkable(point: THREE.Vector2) {
    const cx = Math.round(point.x)
    const cz = Math.round(point.y)
    for (let r = 0; r < 6; r++) {
      let best: [number, number] | null = null
      let bestDistance = Infinity
      for (let x = cx - r; x <= cx + r; x++) {
        for (let z = cz - r; z <= cz + r; z++) {
          if (this.walkable(x, z)) {
            const distance = Math.hypot(x - point.x, z - point.y)
            if (distance < bestDistance) {
              best = [x, z]
              bestDistance = distance
            }
          }
        }
      }
      if (best) {
        return best
      }
    }
    return null
  }

  lineOfSight(from: THREE.Vector2, to: THREE.Vector2) {
    const steps = Math.ceil(from.distanceTo(to) / 0.2)
    const point = new THREE.Vector2()
    for (let i = 1; i <= steps; i++) {
      point.lerpVectors(from, to, i / steps)
      if (!this.isClear(point)) {
        return false
      }
    }
    return true
  }

  findPath(from: THREE.Vector2, to: THREE.Vector2): THREE.Vector2[] | null {
    if (this.lineOfSight(from, to)) {
      return [to.clone()]
    }
    const start = this.nearestWalkable(from)
    const goal = this.nearestWalkable(to)
    if (!start || !goal) {
      return null
    }
    const key = (x: number, z: number) => `${x},${z}`
    const open = new Map<string, { x: number; z: number; g: number; f: number }>()
    const came = new Map<string, string>()
    const cost = new Map<string, number>()
    const h = (x: number, z: number) => Math.hypot(goal[0] - x, goal[1] - z)
    open.set(key(...start), { x: start[0], z: start[1], g: 0, f: h(...start) })
    cost.set(key(...start), 0)

    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]

    let found: string | null = null
    let guard = 0
    while (open.size && guard++ < 20000) {
      let currentKey = ''
      let current: { x: number; z: number; g: number; f: number } | null = null
      for (const [k, node] of open) {
        if (!current || node.f < current.f) {
          current = node
          currentKey = k
        }
      }
      if (!current) {
        break
      }
      if (current.x === goal[0] && current.z === goal[1]) {
        found = currentKey
        break
      }
      open.delete(currentKey)
      for (const [dx, dz] of directions) {
        const nx = current.x + dx
        const nz = current.z + dz
        if (!this.walkable(nx, nz)) {
          continue
        }
        if (dx && dz && (!this.walkable(current.x + dx, current.z) || !this.walkable(current.x, current.z + dz))) {
          continue
        }
        const g = current.g + (dx && dz ? Math.SQRT2 : 1)
        const nk = key(nx, nz)
        if (g < (cost.get(nk) ?? Infinity)) {
          cost.set(nk, g)
          came.set(nk, currentKey)
          open.set(nk, { x: nx, z: nz, g, f: g + h(nx, nz) })
        }
      }
    }
    if (!found) {
      return null
    }

    const cells: THREE.Vector2[] = []
    for (let k: string | undefined = found; k; k = came.get(k)) {
      const [x, z] = k.split(',').map(Number)
      cells.unshift(new THREE.Vector2(x, z))
    }
    cells.push(to.clone())

    const smooth: THREE.Vector2[] = []
    let anchor = from.clone()
    let index = 0
    while (index < cells.length) {
      let furthest = index
      for (let j = cells.length - 1; j > index; j--) {
        if (this.lineOfSight(anchor, cells[j])) {
          furthest = j
          break
        }
      }
      smooth.push(cells[furthest])
      anchor = cells[furthest]
      index = furthest + 1
    }
    return smooth
  }
}

export function distanceToRect(point: THREE.Vector2, rect: Rect) {
  const dx = Math.max(rect.minX - point.x, 0, point.x - rect.maxX)
  const dz = Math.max(rect.minZ - point.y, 0, point.y - rect.maxZ)
  if (dx === 0 && dz === 0) {
    return -Math.min(point.x - rect.minX, rect.maxX - point.x, point.y - rect.minZ, rect.maxZ - point.y)
  }
  return Math.hypot(dx, dz)
}

export function pushOut(point: THREE.Vector2, rect: Rect, radius: number) {
  const closest = new THREE.Vector2(
    THREE.MathUtils.clamp(point.x, rect.minX, rect.maxX),
    THREE.MathUtils.clamp(point.y, rect.minZ, rect.maxZ),
  )
  const inside = closest.x === point.x && closest.y === point.y
  if (inside) {
    const exits = [
      { d: point.x - rect.minX, v: new THREE.Vector2(rect.minX - radius, point.y) },
      { d: rect.maxX - point.x, v: new THREE.Vector2(rect.maxX + radius, point.y) },
      { d: point.y - rect.minZ, v: new THREE.Vector2(point.x, rect.minZ - radius) },
      { d: rect.maxZ - point.y, v: new THREE.Vector2(point.x, rect.maxZ + radius) },
    ]
    exits.sort((a, b) => a.d - b.d)
    point.copy(exits[0].v)
    return
  }
  const offset = point.clone().sub(closest)
  const distance = offset.length()
  if (distance < radius) {
    point.copy(closest.add(offset.multiplyScalar(radius / distance)))
  }
}
