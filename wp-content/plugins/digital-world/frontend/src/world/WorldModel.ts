import * as THREE from 'three'
import type { DoorSide, WorldObject } from '@/types'
import { generateBuilding, rotateCell, type Blueprint } from './buildings'
import { NavGrid, type Rect } from './navigation'
import { PLAYER_RADIUS } from './Player'
import { GuestStand, STAND_READER_DISTANCE, STAND_SPAWN_DISTANCE, STAND_SPAWN_SIDE } from './stand'
import { texture } from './textures'
import { VoxelGrid } from './voxels'

export const ZONE_DEPTH = 2.4
export const ZONE_HALF_WIDTH = 1.3
export const MIN_RADIUS = 16
export const MAX_RADIUS = 60
export const DOOR_SIDES: Array<Exclude<DoorSide, 'auto'>> = ['south', 'east', 'north', 'west']

const TREE_CELL = 5
const BUILDING_GAP = 1
const PLAZA_RADIUS = 2.3
const STAND_TREE_GAP = 6

export interface Door {
  pivot: THREE.Group
  glow: THREE.Mesh
  world: THREE.Vector3
  outward: THREE.Vector3
  front: THREE.Vector3
}

export interface Building {
  object: WorldObject
  plan: Blueprint
  frame: THREE.Group
  body: THREE.Group
  anchor: THREE.Group
  quarter: number
  center: THREE.Vector2
  rect: Rect
  zone: Rect
  height: number
  hitbox: THREE.Mesh
  mat: THREE.Mesh
  door: Door
}

export interface Placement {
  x: number
  z: number
  quarter: number
  seed: number
}

export function hash2(x: number, z: number, salt = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(salt, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function quarterVector(quarter: number) {
  const [x, z] = rotateCell(0, 1, quarter)
  return new THREE.Vector3(x, 0, z)
}

export function defaultQuarter(side: DoorSide, x: number, z: number) {
  const explicit = DOOR_SIDES.indexOf(side as Exclude<DoorSide, 'auto'>)
  if (explicit >= 0) {
    return explicit
  }
  if (Math.hypot(x, z) < 3) {
    return 0
  }
  return Math.abs(x) > Math.abs(z) ? (x > 0 ? 3 : 1) : z > 0 ? 2 : 0
}

export function sideOfQuarter(quarter: number): Exclude<DoorSide, 'auto'> {
  return DOOR_SIDES[((quarter % 4) + 4) % 4]
}

export function footprint(placement: Placement) {
  const plan = generateBuilding(placement.seed, '#888888')
  const swap = placement.quarter % 2 === 1
  const ex = (swap ? plan.halfZ : plan.halfX) + 0.5
  const ez = (swap ? plan.halfX : plan.halfZ) + 0.5
  const rect: Rect = { minX: placement.x - ex, maxX: placement.x + ex, minZ: placement.z - ez, maxZ: placement.z + ez }
  const outward = quarterVector(placement.quarter)
  const face = plan.halfZ + 0.5
  const doorX = placement.x + outward.x * face
  const doorZ = placement.z + outward.z * face
  const farX = doorX + outward.x * (ZONE_DEPTH + 0.6)
  const farZ = doorZ + outward.z * (ZONE_DEPTH + 0.6)
  const lateralX = Math.abs(outward.z) * ZONE_HALF_WIDTH
  const lateralZ = Math.abs(outward.x) * ZONE_HALF_WIDTH
  const zone: Rect = {
    minX: Math.min(doorX, farX) - lateralX,
    maxX: Math.max(doorX, farX) + lateralX,
    minZ: Math.min(doorZ, farZ) - lateralZ,
    maxZ: Math.max(doorZ, farZ) + lateralZ,
  }
  return { rect, zone }
}

function overlaps(a: Rect, b: Rect, gap = 0) {
  return a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap
}

function insideIsland(rect: Rect, radius: number) {
  return [
    [rect.minX, rect.minZ],
    [rect.minX, rect.maxZ],
    [rect.maxX, rect.minZ],
    [rect.maxX, rect.maxZ],
  ].every(([x, z]) => Math.hypot(x, z) <= radius - 1.5)
}

export type PlacementProblem = 'outside' | 'overlap' | 'door-blocked' | 'blocks-door' | null

export function checkPlacement(candidate: Placement, others: Placement[], radius: number): PlacementProblem {
  const mine = footprint(candidate)
  if (!insideIsland(mine.rect, radius) || !insideIsland(mine.zone, radius + 1)) {
    return 'outside'
  }
  for (const other of others) {
    const theirs = footprint(other)
    if (overlaps(mine.rect, theirs.rect, BUILDING_GAP)) {
      return 'overlap'
    }
    if (overlaps(mine.zone, theirs.rect)) {
      return 'door-blocked'
    }
    if (overlaps(mine.rect, theirs.zone)) {
      return 'blocks-door'
    }
  }
  return null
}

export function suggestedRadius(objects: WorldObject[]) {
  return Math.ceil(Math.max(22, ...objects.map((object) => Math.hypot(object.position.x, object.position.z) + 9)))
}

export interface WorldModelOptions {
  shadows: boolean
  clouds?: boolean
  underground?: boolean
  standLeaf?: boolean
}

export class WorldModel {
  readonly root = new THREE.Group()
  readonly buildings = new Map<string, Building>()
  readonly hitboxes: THREE.Mesh[] = []
  readonly stand: GuestStand
  colliders: Rect[] = []
  nav: NavGrid | null = null
  spawn = new THREE.Vector3()
  spawnHeading = 0
  radius = 24
  private buildingsRoot = new THREE.Group()
  private terrain: THREE.Object3D | null = null
  private clouds = new THREE.Group()

  constructor(private options: WorldModelOptions) {
    this.stand = new GuestStand({ shadows: options.shadows, leaf: options.standLeaf ?? false })
    this.root.add(this.buildingsRoot, this.clouds, this.stand.group)
    if (options.clouds !== false) {
      this.buildClouds()
    }
  }

  rotationFor(slug: string, step = 1): Placement | null {
    const placement = this.placementOf(slug)
    if (!placement) {
      return null
    }
    for (let i = 1; i <= 4; i++) {
      const candidate = { ...placement, quarter: (placement.quarter + step * i + 8) % 4 }
      if (!checkPlacement(candidate, this.othersThan(slug), this.radius)) {
        return candidate
      }
    }
    return null
  }

  setWorld(objects: WorldObject[], radius: number) {
    this.radius = THREE.MathUtils.clamp(Math.round(radius), MIN_RADIUS, MAX_RADIUS)
    for (const building of this.buildings.values()) {
      building.frame.removeFromParent()
    }
    this.buildings.clear()
    this.hitboxes.length = 0
    for (const object of objects) {
      this.addBuilding(object)
    }
    this.rebuildTerrain()
  }

  setRadius(radius: number) {
    this.radius = THREE.MathUtils.clamp(Math.round(radius), MIN_RADIUS, MAX_RADIUS)
    this.rebuildTerrain()
  }

  placementOf(slug: string): Placement | null {
    const building = this.buildings.get(slug)
    if (!building) {
      return null
    }
    return { x: building.center.x, z: building.center.y, quarter: building.quarter, seed: building.object.seed }
  }

  othersThan(slug: string) {
    return [...this.buildings.keys()].filter((key) => key !== slug).map((key) => this.placementOf(key) as Placement)
  }

  private addBuilding(object: WorldObject) {
    const x = Math.round(object.position.x)
    const z = Math.round(object.position.z)
    const quarter = defaultQuarter(object.door, x, z)
    const frame = new THREE.Group()
    const body = new THREE.Group()
    const anchor = new THREE.Group()
    frame.add(body, anchor)
    const building = { object, frame, body, anchor, quarter, center: new THREE.Vector2(x, z) } as Building
    this.buildings.set(object.slug, building)
    this.buildingsRoot.add(frame)
    this.buildBody(building)
    this.place(building, x, z, quarter)
  }

  updateBuilding(object: WorldObject) {
    const building = this.buildings.get(object.slug)
    if (!building) {
      return
    }
    const rebuild = building.object.seed !== object.seed || building.object.color !== object.color
    building.object = object
    if (rebuild) {
      this.buildBody(building)
    }
    this.place(building, Math.round(object.position.x), Math.round(object.position.z), defaultQuarter(object.door, object.position.x, object.position.z))
  }

  private buildBody(building: Building) {
    const { object, frame, body } = building
    const plan = generateBuilding(object.seed, object.color)
    building.plan = plan
    body.clear()
    for (const child of [...frame.children]) {
      if (child !== body && child !== building.anchor) {
        child.removeFromParent()
      }
    }
    const grid = new VoxelGrid()
    for (const [x, y, z, id] of plan.cells) {
      grid.set(x, y, z, id)
    }
    body.add(grid.build({ shadows: this.options.shadows }))

    const index = this.hitboxes.indexOf(building.hitbox)
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(plan.halfX * 2 + 1, plan.height, plan.halfZ * 2 + 1),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    )
    hitbox.position.y = plan.height / 2
    hitbox.userData.slug = object.slug
    if (index >= 0) {
      this.hitboxes[index] = hitbox
    } else {
      this.hitboxes.push(hitbox)
    }
    building.hitbox = hitbox
    building.height = plan.height
    building.anchor.position.set(0, plan.height + 1.2, 0)

    const face = plan.halfZ + 0.5
    const pivot = new THREE.Group()
    pivot.position.set(-0.5, 0, face - 0.07)
    const plank = new THREE.MeshLambertMaterial({ map: texture('door') })
    for (const [y, name] of [
      [0.5, 'doorBottom'],
      [1.5, 'doorTop'],
    ] as const) {
      const side = new THREE.MeshLambertMaterial({ map: texture(name) })
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1, 0.12), [plank, plank, plank, plank, side, side])
      leaf.position.set(0.5, y, 0)
      leaf.castShadow = this.options.shadows
      pivot.add(leaf)
    }
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 2),
      new THREE.MeshBasicMaterial({ color: '#fff4cf', transparent: true, opacity: 0 }),
    )
    glow.position.set(0, 1, face - 0.45)

    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(ZONE_HALF_WIDTH * 2, ZONE_DEPTH),
      new THREE.MeshBasicMaterial({ color: object.color, transparent: true, opacity: 0.18, depthWrite: false }),
    )
    mat.rotation.x = -Math.PI / 2
    mat.position.set(0, 0.015, face + ZONE_DEPTH / 2)

    frame.add(hitbox, pivot, glow, mat)
    building.mat = mat
    building.door = { pivot, glow, world: new THREE.Vector3(), outward: new THREE.Vector3(), front: new THREE.Vector3() }
  }

  place(building: Building, x: number, z: number, quarter: number) {
    building.center.set(x, z)
    building.quarter = ((quarter % 4) + 4) % 4
    building.frame.position.set(x, 0, z)
    building.frame.rotation.y = (building.quarter * Math.PI) / 2
    const { rect, zone } = footprint({ x, z, quarter: building.quarter, seed: building.object.seed })
    building.rect = rect
    building.zone = zone
    const face = building.plan.halfZ + 0.5
    const outward = quarterVector(building.quarter)
    building.door.outward.copy(outward)
    building.door.world.set(x, 0, z).addScaledVector(outward, face)
    building.door.front.copy(building.door.world).addScaledVector(outward, 1.1)
  }

  rebuildTerrain() {
    const buildingRects = [...this.buildings.values()].map((building) => building.rect)
    this.nav = new NavGrid(this.radius, buildingRects, PLAYER_RADIUS)
    this.placeStand()
    this.nav = new NavGrid(this.radius, [...buildingRects, this.stand.rect], PLAYER_RADIUS)
    const paths = this.carvePaths()
    this.addPlaza(paths)
    const grid = new VoxelGrid()
    const trees = this.plantTrees(grid, paths)
    this.colliders = [...buildingRects, this.stand.rect, ...trees]
    this.nav = new NavGrid(this.radius, this.colliders, PLAYER_RADIUS)
    this.buildGround(grid, paths)
    this.terrain?.removeFromParent()
    this.terrain = grid.build({ shadows: this.options.shadows })
    this.root.add(this.terrain)
  }

  standZoneAt(point: THREE.Vector3) {
    return this.stand.contains(point)
  }

  zoneAt(point: THREE.Vector3) {
    let current: string | null = null
    let best = Infinity
    for (const [slug, building] of this.buildings) {
      const offset = point.clone().sub(building.door.world)
      const depth = offset.dot(building.door.outward)
      const lateral = Math.abs(offset.x * building.door.outward.z - offset.z * building.door.outward.x)
      if (depth >= 0 && depth <= ZONE_DEPTH && lateral <= ZONE_HALF_WIDTH && depth < best) {
        current = slug
        best = depth
      }
    }
    return current
  }

  private floorCells() {
    const cells = new Set<string>()
    for (const building of this.buildings.values()) {
      for (let x = Math.ceil(building.rect.minX); x <= Math.floor(building.rect.maxX); x++) {
        for (let z = Math.ceil(building.rect.minZ); z <= Math.floor(building.rect.maxZ); z++) {
          cells.add(`${x},${z}`)
        }
      }
    }
    return cells
  }

  private placeStand() {
    const doors = [...this.buildings.values()].map((building) => new THREE.Vector2(building.door.front.x, building.door.front.z))
    const spot = doors.length ? this.hubNear(this.medianOf(doors), doors) : null
    const point = spot ?? this.southernSpot()
    const center = new THREE.Vector2(point.x, point.z)
    const pull = doors.reduce((sum, door) => sum.add(door.clone().sub(center).normalize()), new THREE.Vector2())
    const preferred =
      pull.lengthSq() > 0.01 ? pull.negate() : center.lengthSq() > 0.25 ? center.clone() : new THREE.Vector2(0, 1)
    const quarters = [0, 1, 2, 3]
      .map((quarter) => ({ quarter, facing: quarterVector(quarter) }))
      .sort((a, b) => b.facing.x * preferred.x + b.facing.z * preferred.y - (a.facing.x * preferred.x + a.facing.z * preferred.y))
    const spawnFor = (facing: THREE.Vector3) =>
      point
        .clone()
        .addScaledVector(facing, STAND_SPAWN_DISTANCE)
        .add(new THREE.Vector3(-facing.z, 0, facing.x).multiplyScalar(STAND_SPAWN_SIDE))
    const free = (spot: THREE.Vector3) =>
      Boolean(this.nav?.isClear(new THREE.Vector2(spot.x, spot.z), PLAYER_RADIUS + 0.3)) && !this.zoneAt(spot)
    const chosen =
      quarters.find(({ facing }) => free(point.clone().addScaledVector(facing, STAND_READER_DISTANCE)) && free(spawnFor(facing))) ??
      quarters[0]
    this.stand.place(point.x, point.z, chosen.quarter, chosen.facing)
    this.spawn = spawnFor(chosen.facing)
    this.spawnHeading = Math.atan2(-chosen.facing.x, -chosen.facing.z)
  }

  private addPlaza(paths: Set<string>) {
    const { x, z } = this.stand.position
    const r = Math.ceil(PLAZA_RADIUS)
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.hypot(dx, dz) <= PLAZA_RADIUS + hash2(x + dx, z + dz, 7) * 0.6) {
          paths.add(`${Math.round(x) + dx},${Math.round(z) + dz}`)
        }
      }
    }
  }

  private medianOf(points: THREE.Vector2[]) {
    const median = points.reduce((sum, point) => sum.add(point), new THREE.Vector2()).multiplyScalar(1 / points.length)
    for (let i = 0; i < 50; i++) {
      const next = new THREE.Vector2()
      let weight = 0
      for (const point of points) {
        const inverse = 1 / Math.max(median.distanceTo(point), 1e-3)
        next.addScaledVector(point, inverse)
        weight += inverse
      }
      next.multiplyScalar(1 / weight)
      if (next.distanceTo(median) < 1e-3) {
        return next
      }
      median.copy(next)
    }
    return median
  }

  private hubNear(center: THREE.Vector2, doors: THREE.Vector2[]) {
    const cx = Math.round(center.x)
    const cz = Math.round(center.y)
    const limit = this.radius * 0.85
    for (let ring = 0; ring <= this.radius * 2; ring++) {
      const candidates: THREE.Vector2[] = []
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) {
            continue
          }
          const cell = new THREE.Vector2(cx + dx, cz + dz)
          if (
            cell.length() <= limit &&
            this.nav?.isClear(cell, 2) &&
            !this.zoneAt(new THREE.Vector3(cell.x, 0, cell.y)) &&
            doors.every((door) => door.distanceTo(cell) >= 3.5)
          ) {
            candidates.push(cell)
          }
        }
      }
      if (candidates.length) {
        candidates.sort((a, b) => a.distanceTo(center) - b.distanceTo(center) || a.x - b.x || a.y - b.y)
        return new THREE.Vector3(candidates[0].x, 0, candidates[0].y)
      }
    }
    return null
  }

  private southernSpot() {
    for (const share of [0.72, 0.62, 0.82, 0.5]) {
      for (let i = 0; i < 24; i++) {
        const angle = Math.PI / 2 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 24)
        const point = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(this.radius * share)
        point.set(Math.round(point.x), 0, Math.round(point.z))
        if (this.nav?.isClear(new THREE.Vector2(point.x, point.z), 2) && !this.zoneAt(point)) {
          return point
        }
      }
    }
    return new THREE.Vector3(0, 0, Math.round(this.radius * 0.6))
  }

  private carvePaths() {
    const cells = new Set<string>()
    const start = new THREE.Vector2(this.spawn.x, this.spawn.z)
    for (const building of this.buildings.values()) {
      const front = new THREE.Vector2(building.door.front.x, building.door.front.z)
      let from = start.clone()
      for (const point of this.nav?.findPath(start, front) ?? []) {
        const steps = Math.max(1, Math.ceil(from.distanceTo(point) * 2))
        for (let i = 0; i <= steps; i++) {
          const p = from.clone().lerp(point, i / steps)
          cells.add(`${Math.round(p.x)},${Math.round(p.y)}`)
        }
        from = point
      }
      for (let d = 0; d <= 2; d++) {
        const p = building.door.world.clone().addScaledVector(building.door.outward, 0.5 + d)
        cells.add(`${Math.round(p.x)},${Math.round(p.z)}`)
      }
    }
    return cells
  }

  private plantTrees(grid: VoxelGrid, paths: Set<string>) {
    const floors = this.floorCells()
    const rects: Rect[] = []
    const spawn = new THREE.Vector2(this.spawn.x, this.spawn.z)
    const span = Math.ceil(this.radius / TREE_CELL)
    for (let gx = -span; gx <= span; gx++) {
      for (let gz = -span; gz <= span; gz++) {
        if (hash2(gx, gz, 1) > 0.62) {
          continue
        }
        const x = gx * TREE_CELL + Math.floor(hash2(gx, gz, 2) * (TREE_CELL - 1))
        const z = gz * TREE_CELL + Math.floor(hash2(gx, gz, 3) * (TREE_CELL - 1))
        const point = new THREE.Vector2(x, z)
        if (
          point.length() > this.radius - 3 ||
          floors.has(`${x},${z}`) ||
          point.distanceTo(spawn) < 5 ||
          point.distanceTo(new THREE.Vector2(this.stand.position.x, this.stand.position.z)) < STAND_TREE_GAP
        ) {
          continue
        }
        let nearPath = false
        for (let dx = -1; dx <= 1 && !nearPath; dx++) {
          for (let dz = -1; dz <= 1 && !nearPath; dz++) {
            nearPath = paths.has(`${x + dx},${z + dz}`)
          }
        }
        const blocked = [...this.buildings.values()].some(
          (building) =>
            overlaps({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5 }, building.rect, 2.2) ||
            overlaps({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5 }, building.zone, 1.5),
        )
        if (nearPath || blocked) {
          continue
        }
        const trunk = 3 + Math.floor(hash2(x, z, 4) * 2)
        for (let y = 0; y < trunk; y++) {
          grid.set(x, y, z, 'log')
        }
        for (let y = trunk - 1; y <= trunk + 2; y++) {
          const r = y >= trunk + 1 ? 1 : 2
          for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
              const corner = Math.abs(dx) === r && Math.abs(dz) === r
              const trimmed = corner && (r === 1 ? y === trunk + 2 : hash2(x + dx, z + dz, y) < 0.6)
              if (trimmed || (dx === 0 && dz === 0 && y < trunk)) {
                continue
              }
              grid.set(x + dx, y, z + dz, 'foliage')
            }
          }
        }
        rects.push({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5 })
      }
    }
    return rects
  }

  private buildGround(grid: VoxelGrid, paths: Set<string>) {
    const floors = this.floorCells()
    const radius = this.radius
    for (let x = -radius - 1; x <= radius + 1; x++) {
      for (let z = -radius - 1; z <= radius + 1; z++) {
        const k = `${x},${z}`
        const jitter = hash2(x, z, 9) * 0.9
        const distance = Math.hypot(x, z) - jitter
        if (distance > radius) {
          continue
        }
        grid.set(x, -1, z, floors.has(k) ? 'planks' : paths.has(k) ? 'path' : 'grass')
        for (let level = 2; level <= (this.options.underground === false ? 0 : 9); level++) {
          if (distance > radius - (level - 1) * 1.6 - jitter * 1.5) {
            break
          }
          grid.set(x, -level, z, level <= 3 ? 'dirt' : 'stone')
        }
      }
    }
  }

  private buildClouds() {
    const grid = new VoxelGrid()
    for (let c = 0; c < 9; c++) {
      const angle = hash2(c, 0, 11) * Math.PI * 2
      const distance = 20 + hash2(c, 1, 11) * 70
      const cx = Math.round(Math.cos(angle) * distance)
      const cz = Math.round(Math.sin(angle) * distance)
      const cy = 26 + Math.floor(hash2(c, 2, 11) * 10)
      const w = 4 + Math.floor(hash2(c, 3, 11) * 5)
      const d = 3 + Math.floor(hash2(c, 4, 11) * 4)
      for (let x = -w; x <= w; x++) {
        for (let z = -d; z <= d; z++) {
          if ((x * x) / (w * w) + (z * z) / (d * d) <= 1 + hash2(x, z, c) * 0.2) {
            grid.set(cx + x, cy, cz + z, 'cloud')
          }
        }
      }
    }
    this.clouds.add(grid.build({ shadows: false }))
  }

  animateClouds(elapsed: number) {
    this.clouds.position.x = ((elapsed * 0.6 + 80) % 160) - 80
  }
}
