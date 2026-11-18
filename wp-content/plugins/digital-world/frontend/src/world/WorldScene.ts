import * as THREE from 'three'
import gsap from 'gsap'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CameraTransition, DoorSide, WorldObject } from '@/types'
import { blueprint, rotateCell } from './buildings'
import { NavGrid, pushOut, type Rect } from './navigation'
import { Player, PLAYER_RADIUS } from './Player'
import { texture } from './textures'
import { VoxelGrid } from './voxels'

export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

interface Door {
  pivot: THREE.Group
  glow: THREE.Mesh
  world: THREE.Vector3
  outward: THREE.Vector3
  front: THREE.Vector3
}

interface Entry {
  object: WorldObject
  frame: THREE.Group
  quarter: number
  center: THREE.Vector2
  rect: Rect
  height: number
  hitbox: THREE.Mesh
  label: HTMLButtonElement
  mat: THREE.Mesh
  door: Door
}

interface Walk {
  points: THREE.Vector2[]
  resolve: (arrived: boolean) => void
  stuck: number
}

export interface WorldSceneOptions {
  onObjectClick: (slug: string) => void
  onZoneChange: (slug: string | null) => void
  reducedMotion?: boolean
}

export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')))
  } catch {
    return false
  }
}

export function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

const WALK_SPEED = 5.2
const TURN_SPEED = 2.6
const ZONE_DEPTH = 2.4
const ZONE_HALF_WIDTH = 1.3
const EYE = new THREE.Vector3(0, 1.6, 0)
const UP = new THREE.Vector3(0, 1, 0)
const DOOR_QUARTER: Record<Exclude<DoorSide, 'auto'>, number> = { south: 0, east: 1, north: 2, west: 3 }
const KEYS = {
  forward: ['ArrowUp', 'KeyW'],
  back: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
}
const ALL_KEYS = new Set(Object.values(KEYS).flat())

function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function quarterVector(quarter: number) {
  const [x, z] = rotateCell(0, 1, quarter)
  return new THREE.Vector3(x, 0, z)
}

function headingOf(direction: THREE.Vector3) {
  return Math.atan2(direction.x, direction.z)
}

export class WorldScene {
  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private clock = new THREE.Clock()
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private entries = new Map<string, Entry>()
  private hitboxes: THREE.Mesh[] = []
  private colliders: Rect[] = []
  private nav: NavGrid | null = null
  private terrain: THREE.Object3D | null = null
  private clouds = new THREE.Group()
  private sun: THREE.DirectionalLight
  private hovered: string | null = null
  private zone: string | null = null
  private frame = 0
  private resizeObserver: ResizeObserver
  private worldRadius = 24
  private spawnPosition = new THREE.Vector3()
  private gltfLoader: GLTFLoader | null = null
  private disposed = false
  private player = new Player()
  private keys = new Set<string>()
  private walk: Walk | null = null
  private faceAfterWalk: number | null = null
  private marker: THREE.Mesh
  private mode: 'chase' | 'overview' | 'cinematic' = 'chase'
  private yawOffset = 0
  private pitchOffset = 0
  private distance = 9
  private look = new THREE.Vector3()
  private cinematicLook = new THREE.Vector3()
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null
  private locked = false
  private timeline: gsap.core.Timeline | null = null
  private moveSpeed = 0
  private shadows: boolean

  constructor(
    private container: HTMLElement,
    private options: WorldSceneOptions,
  ) {
    const { clientWidth: width, clientHeight: height } = container
    this.shadows = !this.lowPower

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height)
    this.renderer.shadowMap.enabled = this.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.classList.add('dw-canvas')
    container.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    this.labels.setSize(width, height)
    this.labels.domElement.classList.add('dw-labels')
    container.appendChild(this.labels.domElement)

    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500)
    this.distance = this.defaultDistance

    this.scene.background = new THREE.Color('#9dd4f7')
    this.scene.fog = new THREE.Fog('#cfe9f8', 70, 220)
    this.scene.add(new THREE.HemisphereLight('#eaf6ff', '#7d6a4c', 1.5))
    this.sun = new THREE.DirectionalLight('#fff3d6', 2.2)
    this.sun.castShadow = this.shadows
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0005
    this.sun.shadow.normalBias = 0.04
    this.scene.add(this.sun, this.sun.target)

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.45, 4, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    )
    this.marker.rotation.set(-Math.PI / 2, 0, Math.PI / 4)
    this.marker.position.y = 0.03
    this.marker.visible = false

    this.scene.add(this.player.root, this.marker, this.clouds)

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)

    this.loop()
  }

  private get lowPower() {
    return window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600
  }

  private get defaultDistance() {
    return this.camera.aspect < 1 ? 12 : 9
  }

  setObjects(objects: WorldObject[]) {
    this.entries.forEach((entry) => {
      entry.frame.removeFromParent()
      entry.label.remove()
    })
    this.entries.clear()
    this.hitboxes = []
    this.colliders = []
    this.terrain?.removeFromParent()

    this.worldRadius = Math.ceil(
      Math.max(22, ...objects.map((object) => Math.hypot(object.position.x, object.position.z) + 9)),
    )
    const grid = new VoxelGrid()
    const floors: Array<[number, number]> = []

    for (const object of objects) {
      const plan = blueprint(object.type, object.color)
      const cx = Math.round(object.position.x)
      const cz = Math.round(object.position.z)
      const quarter = this.doorQuarter(object.door, cx, cz)
      const swap = quarter % 2 === 1
      const extentX = (swap ? plan.halfZ : plan.halfX) + 0.5
      const extentZ = (swap ? plan.halfX : plan.halfZ) + 0.5
      const rect = { minX: cx - extentX, maxX: cx + extentX, minZ: cz - extentZ, maxZ: cz + extentZ }

      if (!object.model) {
        for (const [x, y, z, id] of plan.cells) {
          const [rx, rz] = rotateCell(x, z, quarter)
          grid.set(cx + rx, y, cz + rz, id)
        }
      }
      for (let x = -plan.halfX; x <= plan.halfX; x++) {
        for (let z = -plan.halfZ; z <= plan.halfZ; z++) {
          const [rx, rz] = rotateCell(x, z, quarter)
          floors.push([cx + rx, cz + rz])
        }
      }

      const frame = new THREE.Group()
      frame.position.set(cx, 0, cz)
      frame.rotation.y = (quarter * Math.PI) / 2

      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(plan.halfX * 2 + 1, plan.height, plan.halfZ * 2 + 1),
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
      )
      hitbox.position.y = plan.height / 2
      hitbox.userData.slug = object.slug
      frame.add(hitbox)

      const door = this.createDoor(frame, plan.halfZ, quarter, cx, cz)
      const mat = new THREE.Mesh(
        new THREE.PlaneGeometry(ZONE_HALF_WIDTH * 2, ZONE_DEPTH),
        new THREE.MeshBasicMaterial({ color: object.color, transparent: true, opacity: 0.18, depthWrite: false }),
      )
      mat.rotation.x = -Math.PI / 2
      mat.position.set(0, 0.015, plan.halfZ + 0.5 + ZONE_DEPTH / 2)
      frame.add(mat)

      const label = document.createElement('button')
      label.type = 'button'
      label.tabIndex = -1
      label.className = 'dw-label'
      label.style.setProperty('--dw-accent', object.color)
      label.textContent = object.title
      label.addEventListener('click', () => !this.locked && this.options.onObjectClick(object.slug))
      label.addEventListener('pointerenter', () => this.setHovered(object.slug))
      label.addEventListener('pointerleave', () => this.setHovered(null))
      const labelObject = new CSS2DObject(label)
      labelObject.position.set(0, plan.height + 1.2, 0)
      frame.add(labelObject)

      this.scene.add(frame)
      this.hitboxes.push(hitbox)
      this.colliders.push(rect)
      this.entries.set(object.slug, {
        object,
        frame,
        quarter,
        center: new THREE.Vector2(cx, cz),
        rect,
        height: plan.height,
        hitbox,
        label,
        mat,
        door,
      })
    }

    this.nav = new NavGrid(this.worldRadius, this.colliders, PLAYER_RADIUS)
    this.spawnPosition = this.findSpawn()
    const pathCells = this.carvePaths()
    this.colliders.push(...this.plantTrees(grid, pathCells, floors))
    this.nav = new NavGrid(this.worldRadius, this.colliders, PLAYER_RADIUS)
    this.buildTerrain(grid, pathCells, floors)
    this.buildClouds()

    this.terrain = grid.build({ shadows: this.shadows })
    this.scene.add(this.terrain)
    const reach = 26
    Object.assign(this.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 140 })
    this.sun.shadow.camera.updateProjectionMatrix()

    this.placeAt(this.spawnPosition, headingOf(this.spawnPosition.clone().negate()))
    this.applyHighlight()
    void this.loadModels()
  }

  private doorQuarter(side: DoorSide, cx: number, cz: number) {
    if (side !== 'auto' && side in DOOR_QUARTER) {
      return DOOR_QUARTER[side]
    }
    if (Math.hypot(cx, cz) < 3) {
      return 0
    }
    return Math.abs(cx) > Math.abs(cz) ? (cx > 0 ? 3 : 1) : cz > 0 ? 2 : 0
  }

  private createDoor(frame: THREE.Group, halfZ: number, quarter: number, cx: number, cz: number): Door {
    const face = halfZ + 0.5
    const pivot = new THREE.Group()
    pivot.position.set(-0.5, 0, face - 0.07)
    const plank = new THREE.MeshLambertMaterial({ map: texture('door') })
    for (const [y, name] of [
      [0.5, 'doorBottom'],
      [1.5, 'doorTop'],
    ] as const) {
      const face = new THREE.MeshLambertMaterial({ map: texture(name) })
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1, 0.12), [plank, plank, plank, plank, face, face])
      leaf.position.set(0.5, y, 0)
      leaf.castShadow = this.shadows
      pivot.add(leaf)
    }
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 2),
      new THREE.MeshBasicMaterial({ color: '#fff4cf', transparent: true, opacity: 0 }),
    )
    glow.position.set(0, 1, face - 0.45)
    frame.add(pivot, glow)

    const outward = quarterVector(quarter)
    const world = new THREE.Vector3(cx, 0, cz).addScaledVector(outward, face)
    return { pivot, glow, world, outward, front: world.clone().addScaledVector(outward, 1.1) }
  }

  private findSpawn() {
    const angles = [...this.entries.values()]
      .filter((entry) => entry.center.length() > 2)
      .map((entry) => Math.atan2(entry.center.y, entry.center.x))
      .sort((a, b) => a - b)
    let heading = Math.PI / 2
    let widest = -1
    angles.forEach((angle, i) => {
      const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2
      if (next - angle > widest) {
        widest = next - angle
        heading = angle + widest / 2
      }
    })
    for (const share of [0.72, 0.62, 0.82, 0.5]) {
      for (let i = 0; i < 24; i++) {
        const angle = heading + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 24)
        const point = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(this.worldRadius * share)
        point.set(Math.round(point.x), 0, Math.round(point.z))
        if (this.nav?.isClear(new THREE.Vector2(point.x, point.z), 2) && !this.zoneAt(point)) {
          return point
        }
      }
    }
    return new THREE.Vector3(0, 0, Math.round(this.worldRadius * 0.6))
  }

  private carvePaths() {
    const cells = new Set<string>()
    const start = new THREE.Vector2(this.spawnPosition.x, this.spawnPosition.z)
    for (const entry of this.entries.values()) {
      const front = new THREE.Vector2(entry.door.front.x, entry.door.front.z)
      const path = this.nav?.findPath(start, front) ?? []
      let from = start.clone()
      for (const point of path) {
        const steps = Math.max(1, Math.ceil(from.distanceTo(point) * 2))
        for (let i = 0; i <= steps; i++) {
          const p = from.clone().lerp(point, i / steps)
          cells.add(`${Math.round(p.x)},${Math.round(p.y)}`)
        }
        from = point
      }
      for (let d = 0; d <= 2; d++) {
        const p = entry.door.world.clone().addScaledVector(entry.door.outward, 0.5 + d)
        cells.add(`${Math.round(p.x)},${Math.round(p.z)}`)
      }
    }
    return cells
  }

  private plantTrees(grid: VoxelGrid, paths: Set<string>, floors: Array<[number, number]>) {
    const rnd = seeded(this.entries.size * 7919 + this.worldRadius)
    const taken = new Set(floors.map(([x, z]) => `${x},${z}`))
    const rects: Rect[] = []
    const planted: THREE.Vector2[] = []
    const spawn = new THREE.Vector2(this.spawnPosition.x, this.spawnPosition.z)
    const target = Math.round(this.worldRadius * 0.6)
    for (let attempt = 0; attempt < 400 && planted.length < target; attempt++) {
      const angle = rnd() * Math.PI * 2
      const radius = Math.sqrt(rnd()) * (this.worldRadius - 3)
      const x = Math.round(Math.cos(angle) * radius)
      const z = Math.round(Math.sin(angle) * radius)
      const point = new THREE.Vector2(x, z)
      let nearPath = false
      for (let dx = -1; dx <= 1 && !nearPath; dx++) {
        for (let dz = -1; dz <= 1 && !nearPath; dz++) {
          nearPath = paths.has(`${x + dx},${z + dz}`)
        }
      }
      if (
        nearPath ||
        taken.has(`${x},${z}`) ||
        !this.nav?.isClear(point, 2.6) ||
        point.distanceTo(spawn) < 5 ||
        planted.some((other) => other.distanceTo(point) < 4) ||
        [...this.entries.values()].some(
          (entry) => point.distanceTo(new THREE.Vector2(entry.door.front.x, entry.door.front.z)) < 4,
        )
      ) {
        continue
      }
      planted.push(point)
      const trunk = 3 + Math.floor(rnd() * 2)
      for (let y = 0; y < trunk; y++) {
        grid.set(x, y, z, 'log')
      }
      for (let y = trunk - 1; y <= trunk + 2; y++) {
        const r = y >= trunk + 1 ? 1 : 2
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            const corner = Math.abs(dx) === r && Math.abs(dz) === r
            if ((corner && (r === 1 ? y === trunk + 2 : rnd() < 0.6)) || (dx === 0 && dz === 0 && y < trunk)) {
              continue
            }
            grid.set(x + dx, y, z + dz, 'leaves')
          }
        }
      }
      rects.push({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5 })
    }
    return rects
  }

  private buildTerrain(grid: VoxelGrid, paths: Set<string>, floors: Array<[number, number]>) {
    const rnd = seeded(this.worldRadius * 31)
    const floorSet = new Set(floors.map(([x, z]) => `${x},${z}`))
    const radius = this.worldRadius
    for (let x = -radius - 1; x <= radius + 1; x++) {
      for (let z = -radius - 1; z <= radius + 1; z++) {
        const k = `${x},${z}`
        const jitter = rnd() * 0.9
        const distance = Math.hypot(x, z) - jitter
        if (distance > radius) {
          continue
        }
        grid.set(x, -1, z, floorSet.has(k) ? 'planks' : paths.has(k) ? 'path' : 'grass')
        for (let level = 2; level <= 9; level++) {
          if (distance > radius - (level - 1) * 1.6 - jitter * 1.5) {
            break
          }
          grid.set(x, -level, z, level <= 3 ? 'dirt' : 'stone')
        }
      }
    }
  }

  private buildClouds() {
    this.clouds.clear()
    const rnd = seeded(4242)
    const grid = new VoxelGrid()
    for (let c = 0; c < 9; c++) {
      const angle = rnd() * Math.PI * 2
      const distance = 20 + rnd() * 70
      const cx = Math.round(Math.cos(angle) * distance)
      const cz = Math.round(Math.sin(angle) * distance)
      const cy = 26 + Math.floor(rnd() * 10)
      const w = 4 + Math.floor(rnd() * 5)
      const d = 3 + Math.floor(rnd() * 4)
      for (let x = -w; x <= w; x++) {
        for (let z = -d; z <= d; z++) {
          if ((x * x) / (w * w) + (z * z) / (d * d) <= 1 + rnd() * 0.2) {
            grid.set(cx + x, cy, cz + z, 'cloud')
          }
        }
      }
    }
    this.clouds.add(grid.build({ shadows: false }))
  }

  private async loadModels() {
    const withModels = [...this.entries.values()].filter((entry) => entry.object.model)
    if (!withModels.length) {
      return
    }
    if (!this.gltfLoader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
      this.gltfLoader = new GLTFLoader()
    }
    for (const entry of withModels) {
      if (this.disposed) {
        return
      }
      try {
        const gltf = await this.gltfLoader.loadAsync(entry.object.model as string)
        const model = gltf.scene
        const { width, depth } = (entry.hitbox.geometry as THREE.BoxGeometry).parameters
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const fit = Math.min(width / Math.max(size.x, 0.001), depth / Math.max(size.z, 0.001))
        model.scale.setScalar(fit)
        model.position.y = -box.min.y * fit
        entry.frame.add(model)
      } catch (error) {
        console.warn(`[digital-world] GLB for "${entry.object.slug}" failed`, error)
      }
    }
  }

  private zoneAt(point: THREE.Vector3) {
    let current: string | null = null
    let best = Infinity
    for (const [slug, entry] of this.entries) {
      const offset = point.clone().sub(entry.door.world)
      const depth = offset.dot(entry.door.outward)
      const lateral = Math.abs(offset.x * entry.door.outward.z - offset.z * entry.door.outward.x)
      if (depth >= 0 && depth <= ZONE_DEPTH && lateral <= ZONE_HALF_WIDTH && depth < best) {
        current = slug
        best = depth
      }
    }
    return current
  }

  private placeAt(point: THREE.Vector3, heading: number) {
    this.player.position.set(point.x, 0, point.z)
    this.player.heading = heading
    this.yawOffset = 0
    this.pitchOffset = 0
    this.mode = 'chase'
    this.snapCamera()
    this.updateZone()
  }

  private snapCamera() {
    const { position, target } = this.chasePose()
    this.camera.position.copy(position)
    this.look.copy(target)
    this.camera.lookAt(this.look)
  }

  private chasePose() {
    const yaw = this.player.heading + this.yawOffset
    const base = THREE.MathUtils.clamp(0.36 + this.pitchOffset, 0.05, 1.25)
    const target = this.player.position.clone().add(EYE)
    let chosen: { direction: THREE.Vector3; distance: number } | null = null
    for (const pitch of [base, Math.max(base, 0.75), Math.max(base, 1.05)]) {
      const direction = new THREE.Vector3(
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      )
      this.raycaster.set(target, direction)
      this.raycaster.far = this.distance
      const hit = this.raycaster.intersectObjects(this.hitboxes, false)[0]
      const distance = hit ? Math.max(1.4, hit.distance - 0.3) : this.distance
      chosen ??= { direction, distance }
      if (distance >= Math.min(this.distance, 5)) {
        chosen = { direction, distance }
        break
      }
    }
    const best = chosen as { direction: THREE.Vector3; distance: number }
    this.raycaster.far = Infinity
    return { position: target.clone().addScaledVector(best.direction, best.distance), target }
  }

  placeAtDoor(slug: string) {
    const entry = this.entries.get(slug)
    if (!entry) {
      return
    }
    this.timeline?.kill()
    this.resetDoor(entry)
    this.cancelWalk()
    this.locked = false
    this.player.reach(0)
    this.player.root.visible = true
    this.placeAt(entry.door.front, headingOf(entry.door.outward.clone().negate()))
  }

  overview() {
    if (!this.locked) {
      this.mode = 'overview'
    }
  }

  walkTo(slug: string, transition: CameraTransition = 'fly'): Promise<boolean> {
    const entry = this.entries.get(slug)
    if (!entry || this.locked) {
      return Promise.resolve(false)
    }
    const doorHeading = headingOf(entry.door.outward.clone().negate())
    if (transition === 'instant' || this.options.reducedMotion) {
      this.cancelWalk()
      this.placeAt(entry.door.front, doorHeading)
      return Promise.resolve(true)
    }
    return this.startWalk(new THREE.Vector2(entry.door.front.x, entry.door.front.z), doorHeading)
  }

  private startWalk(goal: THREE.Vector2, face: number | null = null) {
    this.cancelWalk()
    const from = new THREE.Vector2(this.player.position.x, this.player.position.z)
    const points = this.nav?.findPath(from, goal)
    if (!points?.length) {
      return Promise.resolve(false)
    }
    this.mode = 'chase'
    const last = points[points.length - 1]
    this.marker.position.set(last.x, 0.03, last.y)
    this.marker.visible = true
    return new Promise<boolean>((resolve) => {
      this.walk = {
        points,
        stuck: 0,
        resolve: (arrived) => {
          if (arrived) {
            this.faceAfterWalk = face
          }
          resolve(arrived)
        },
      }
    })
  }

  private cancelWalk() {
    this.faceAfterWalk = null
    if (this.walk) {
      const { resolve } = this.walk
      this.walk = null
      resolve(false)
    }
    this.marker.visible = false
  }

  private resolve(point: THREE.Vector2) {
    for (const rect of this.colliders) {
      pushOut(point, rect, PLAYER_RADIUS)
    }
    const limit = this.worldRadius - 1.3
    const distance = point.length()
    if (distance > limit) {
      point.multiplyScalar(limit / distance)
    }
    return point
  }

  private pressed(list: string[]) {
    return list.some((code) => this.keys.has(code))
  }

  private stepPlayer(dt: number) {
    if (this.locked) {
      return
    }
    const turn = (this.pressed(KEYS.left) ? 1 : 0) - (this.pressed(KEYS.right) ? 1 : 0)
    const move = (this.pressed(KEYS.forward) ? 1 : 0) - (this.pressed(KEYS.back) ? 1 : 0)
    const before = new THREE.Vector2(this.player.position.x, this.player.position.z)
    let velocity: THREE.Vector2 | null = null

    if (turn || move) {
      this.cancelWalk()
      this.mode = 'chase'
      this.player.heading += turn * TURN_SPEED * dt
      if (move) {
        const forward = this.player.forward
        velocity = new THREE.Vector2(forward.x, forward.z).multiplyScalar(move * WALK_SPEED * (move > 0 ? 1 : 0.55))
      }
    } else if (this.walk) {
      const toNext = this.walk.points[0].clone().sub(before)
      if (toNext.length() < 0.2) {
        this.walk.points.shift()
        if (!this.walk.points.length) {
          const { resolve } = this.walk
          this.walk = null
          this.marker.visible = false
          resolve(true)
        }
      } else {
        this.player.turnTowards(new THREE.Vector3(toNext.x, 0, toNext.y), dt, 9)
        const remaining = toNext.length()
        velocity = toNext.normalize().multiplyScalar(Math.min(WALK_SPEED, remaining / Math.max(dt, 1e-3)))
      }
    } else if (this.faceAfterWalk !== null) {
      const target = this.faceAfterWalk
      this.player.turnTowards(new THREE.Vector3(Math.sin(target), 0, Math.cos(target)), dt, 8)
      if (Math.abs(Math.atan2(Math.sin(target - this.player.heading), Math.cos(target - this.player.heading))) < 0.02) {
        this.faceAfterWalk = null
      }
    }

    this.moveSpeed = 0
    if (velocity && dt > 0) {
      const substeps = Math.ceil(dt / 0.03)
      const step = velocity.clone().multiplyScalar(dt / substeps)
      const next = before.clone()
      for (let i = 0; i < substeps; i++) {
        this.resolve(next.add(step))
      }
      this.player.position.set(next.x, 0, next.y)
      const moved = next.distanceTo(before)
      this.moveSpeed = moved / dt
      if (this.walk) {
        this.walk.stuck = moved < velocity.length() * dt * 0.2 ? this.walk.stuck + dt : 0
        if (this.walk.stuck > 0.6) {
          this.cancelWalk()
        }
      }
    }
  }

  private updateCamera(dt: number) {
    if (this.mode === 'cinematic') {
      this.camera.lookAt(this.cinematicLook)
      return
    }
    if (!this.drag?.moved) {
      const decay = Math.exp(-dt * 3)
      this.yawOffset *= decay
      this.pitchOffset *= decay
    }
    let position: THREE.Vector3
    let target: THREE.Vector3
    if (this.mode === 'overview') {
      const radius = this.worldRadius
      const away = new THREE.Vector3(this.player.position.x, 0, this.player.position.z)
      if (away.lengthSq() < 1) {
        away.set(0, 0, 1)
      }
      position = away.normalize().multiplyScalar(radius * 1.5).add(new THREE.Vector3(0, radius * 1.4, 0))
      target = new THREE.Vector3()
    } else {
      ;({ position, target } = this.chasePose())
    }
    const k = 1 - Math.exp(-dt * (this.mode === 'overview' ? 2.5 : 9))
    this.camera.position.lerp(position, k)
    this.look.lerp(target, k)
    this.camera.lookAt(this.look)
  }

  private updateZone() {
    const current = this.locked ? this.zone : this.zoneAt(this.player.position)
    if (current !== this.zone) {
      this.zone = current
      this.applyHighlight()
      this.options.onZoneChange(current)
    }
  }

  private setHovered(slug: string | null) {
    if (this.hovered === slug) {
      return
    }
    this.hovered = slug
    this.renderer.domElement.style.cursor = slug ? 'pointer' : ''
    this.applyHighlight()
  }

  private applyHighlight() {
    for (const [slug, entry] of this.entries) {
      const inZone = slug === this.zone
      entry.label.classList.toggle('is-active', inZone || slug === this.hovered)
      entry.label.classList.toggle('is-zone', inZone)
      ;(entry.mat.material as THREE.MeshBasicMaterial).opacity = inZone ? 0.45 : 0.18
    }
  }

  private resetDoor(entry: Entry) {
    entry.door.pivot.rotation.y = 0
    ;(entry.door.glow.material as THREE.MeshBasicMaterial).opacity = 0
  }

  private apertureRect(entry: Entry): ScreenRect {
    const lateral = new THREE.Vector3(entry.door.outward.z, 0, -entry.door.outward.x)
    const bounds = this.container.getBoundingClientRect()
    const xs: number[] = []
    const ys: number[] = []
    this.camera.updateMatrixWorld()
    for (const side of [-0.5, 0.5]) {
      for (const y of [0, 2]) {
        const point = entry.door.world.clone().addScaledVector(lateral, side).setY(y).project(this.camera)
        xs.push(bounds.left + ((point.x + 1) / 2) * bounds.width)
        ys.push(bounds.top + ((1 - point.y) / 2) * bounds.height)
      }
    }
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) }
  }

  enter(slug: string, portal: { prepare: () => Promise<void>; frame: (rect: ScreenRect, progress: number) => void }) {
    const entry = this.entries.get(slug)
    if (!entry || this.locked) {
      return Promise.resolve(false)
    }
    this.locked = true
    this.cancelWalk()
    this.keys.clear()
    const { door } = entry
    const inward = door.outward.clone().negate()
    const doorHeading = headingOf(inward)

    if (this.options.reducedMotion) {
      door.pivot.rotation.y = 1.8
      return portal.prepare().then(() => {
        portal.frame(this.apertureRect(entry), 1)
        return true
      })
    }

    const player = this.player
    const start = player.position.clone()
    const right = new THREE.Vector3().crossVectors(inward, UP).normalize()
    const doorCenter = door.world.clone().setY(1)
    const portrait = this.camera.aspect < 1 ? 1.6 : 1
    const shoulder = door.world.clone().addScaledVector(door.outward, 4.2 * portrait).addScaledVector(right, 0.65).setY(2.2 + (portrait - 1))
    const approach = door.world.clone().addScaledVector(door.outward, 3.1 * portrait).setY(1.15)
    const through = door.world.clone().addScaledVector(door.outward, 0.25).setY(1)
    const inside = door.world.clone().addScaledVector(inward, 1.2)
    const cameraFrom = this.camera.position.clone()
    const lookFrom = this.look.clone()
    this.cinematicLook.copy(lookFrom)
    this.mode = 'cinematic'

    const state = { approach: 0, camera: 0, reach: 0, door: 0, walkIn: 0, dolly: 0, push: 0 }
    const startHeading = player.heading
    const turn = Math.atan2(Math.sin(doorHeading - startHeading), Math.cos(doorHeading - startHeading))
    const approachTime = Math.min(0.8, start.distanceTo(door.front) / WALK_SPEED)

    return new Promise<boolean>((resolve) => {
      const tl = gsap.timeline()
      this.timeline = tl
      tl.to(state, {
        approach: 1,
        duration: Math.max(approachTime, 0.3),
        ease: 'power1.inOut',
        onUpdate: () => {
          player.position.lerpVectors(start, door.front, state.approach)
          player.heading = startHeading + turn * state.approach
          this.moveSpeed = approachTime > 0.05 ? WALK_SPEED : 0
        },
        onComplete: () => {
          this.moveSpeed = 0
        },
      })
      tl.to(
        state,
        {
          camera: 1,
          duration: 0.9,
          ease: 'power2.inOut',
          onUpdate: () => {
            const arc = Math.sin(Math.PI * state.camera)
            this.camera.position
              .lerpVectors(cameraFrom, shoulder, state.camera)
              .addScaledVector(right, arc * 1.6)
              .add(new THREE.Vector3(0, arc * 1.4, 0))
            this.cinematicLook.lerpVectors(lookFrom, doorCenter, state.camera)
          },
        },
        0,
      )
      tl.to(state, { reach: 1, duration: 0.25, onUpdate: () => player.reach(state.reach) })
      tl.to(state, {
        door: 1,
        duration: 0.6,
        ease: 'power2.out',
        onUpdate: () => {
          door.pivot.rotation.y = state.door * 1.8
          ;(door.glow.material as THREE.MeshBasicMaterial).opacity = state.door
        },
      })
      tl.to(state, { reach: 0, duration: 0.25, onUpdate: () => player.reach(state.reach) }, '-=0.15')
      tl.to(
        state,
        {
          walkIn: 1,
          duration: 0.95,
          ease: 'none',
          onUpdate: () => {
            player.position.lerpVectors(door.front, inside, state.walkIn)
            this.moveSpeed = WALK_SPEED * 0.8
            player.root.visible = state.walkIn < 0.8
          },
          onComplete: () => {
            this.moveSpeed = 0
          },
        },
        '-=0.05',
      )
      tl.to(
        state,
        {
          dolly: 1,
          duration: 1,
          ease: 'power1.inOut',
          onUpdate: () => {
            this.camera.position.lerpVectors(shoulder, approach, state.dolly)
          },
        },
        '<0.2',
      )
      tl.add(() => {
        void portal.prepare().then(() => {
          this.timeline = gsap.timeline().to(state, {
            push: 1,
            duration: 1.15,
            ease: 'power2.in',
            onUpdate: () => {
              this.camera.position.lerpVectors(approach, through, state.push)
              this.cinematicLook.copy(doorCenter).addScaledVector(inward, state.push * 1.5)
              this.camera.lookAt(this.cinematicLook)
              portal.frame(this.apertureRect(entry), state.push)
            },
            onComplete: () => resolve(true),
          })
        })
      })
    })
  }

  private onPointerDown = (event: PointerEvent) => {
    if (!this.drag) {
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.drag && this.drag.id === event.pointerId) {
      const dx = event.clientX - this.drag.x
      const dy = event.clientY - this.drag.y
      if (!this.drag.moved && Math.hypot(dx, dy) > 6) {
        this.drag.moved = true
        this.renderer.domElement.setPointerCapture(event.pointerId)
      }
      if (this.drag.moved) {
        if (!this.locked) {
          this.yawOffset -= dx * 0.006
          this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset + dy * 0.004, -0.3, 0.85)
        }
        this.drag.x = event.clientX
        this.drag.y = event.clientY
      }
      return
    }
    if (event.pointerType === 'mouse') {
      this.setPointer(event)
      this.setHovered(this.pickObject())
    }
  }

  private onPointerUp = (event: PointerEvent) => {
    const drag = this.drag
    if (!drag || drag.id !== event.pointerId) {
      return
    }
    this.drag = null
    if (drag.moved || event.type === 'pointercancel' || this.locked) {
      return
    }
    this.setPointer(event)
    const slug = this.pickObject()
    if (slug) {
      this.options.onObjectClick(slug)
      return
    }
    const point = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3())
    if (point && Math.hypot(point.x, point.z) < this.worldRadius - 1) {
      void this.startWalk(this.resolve(new THREE.Vector2(point.x, point.z)))
    }
  }

  private onPointerLeave = () => this.setHovered(null)

  private onWheel = (event: WheelEvent) => {
    event.preventDefault()
    if (!this.locked) {
      this.distance = THREE.MathUtils.clamp(this.distance + event.deltaY * 0.01, 4, 20)
    }
  }

  private setPointer(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
  }

  private pickObject() {
    const hit = this.raycaster.intersectObjects(this.hitboxes, false)[0]
    return (hit?.object.userData.slug as string | undefined) ?? null
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!ALL_KEYS.has(event.code) || isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }
    event.preventDefault()
    if (!this.locked) {
      this.keys.add(event.code)
    }
  }

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code)
  }

  private onBlur = () => this.keys.clear()

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.keys.clear()
    } else if (!this.frame && !this.disposed) {
      this.clock.getDelta()
      this.loop()
    }
  }

  private loop = () => {
    if (this.disposed) {
      return
    }
    this.frame = requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const elapsed = this.clock.elapsedTime
    this.stepPlayer(dt)
    this.updateZone()
    this.player.animate(dt, this.moveSpeed, elapsed, !!this.options.reducedMotion)
    this.updateCamera(dt)
    if (!this.options.reducedMotion) {
      this.clouds.position.x = ((elapsed * 0.6 + 80) % 160) - 80
      if (this.marker.visible) {
        this.marker.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.15)
      }
    }
    this.sun.position.set(this.player.position.x + 28, 46, this.player.position.z + 18)
    this.sun.target.position.copy(this.player.position)
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.container
    if (!width || !height) {
      return
    }
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.labels.setSize(width, height)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.timeline?.kill()
    this.cancelWalk()
    this.resizeObserver.disconnect()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      ;(Array.isArray(material) ? material : material ? [material] : []).forEach((m) => m.dispose())
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }
}
