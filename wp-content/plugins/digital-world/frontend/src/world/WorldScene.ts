import * as THREE from 'three'
import gsap from 'gsap'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CameraTransition, WorldObject } from '@/types'
import { createPad, createProceduralModel, type ProceduralModel } from './models'
import { Player, PLAYER_RADIUS } from './Player'

interface Entry {
  object: WorldObject
  root: THREE.Group
  body: THREE.Group
  model: ProceduralModel
  hitbox: THREE.Mesh
  label: HTMLButtonElement
  ring: THREE.Mesh
  zoneRing: THREE.Mesh
  zoneFill: THREE.Mesh
  center: THREE.Vector2
  radius: number
  zoneRadius: number
  phase: number
}

interface Walk {
  points: THREE.Vector3[]
  slug: string | null
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

const WALK_SPEED = 7.5
const ZONE_WIDTH = 2.2
const CAMERA_HEIGHT = 3
const MOVE_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  KeyW: [0, 1],
  ArrowDown: [0, -1],
  KeyS: [0, -1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
}

export function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

export class WorldScene {
  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private composer: EffectComposer | null = null
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private clock = new THREE.Clock()
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private entries = new Map<string, Entry>()
  private hitboxes: THREE.Mesh[] = []
  private hovered: string | null = null
  private zone: string | null = null
  private frame = 0
  private cameraTween: gsap.core.Tween | null = null
  private resizeObserver: ResizeObserver
  private downAt = { x: 0, y: 0 }
  private worldRadius = 24
  private gltfLoader: GLTFLoader | null = null
  private disposed = false
  private player = new Player()
  private previousPlayer = new THREE.Vector3()
  private keys = new Set<string>()
  private walk: Walk | null = null
  private marker: THREE.Mesh
  private zoomedOut = false

  constructor(
    private container: HTMLElement,
    private options: WorldSceneOptions,
  ) {
    const { clientWidth: width, clientHeight: height } = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.classList.add('dw-canvas')
    container.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    this.labels.setSize(width, height)
    this.labels.domElement.classList.add('dw-labels')
    container.appendChild(this.labels.domElement)

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 600)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 6
    this.controls.maxDistance = 140
    this.controls.minPolarAngle = Math.PI * 0.12
    this.controls.maxPolarAngle = Math.PI * 0.46

    this.scene.background = new THREE.Color('#05070f')
    this.scene.fog = new THREE.FogExp2('#05070f', 0.0085)

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: '#5eead4', transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    )
    this.marker.rotation.x = -Math.PI / 2
    this.marker.position.y = 0.04
    this.marker.visible = false

    this.buildEnvironment()
    this.scene.add(this.player.root, this.marker)
    this.setupPostprocessing(width, height)

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
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

  private get followDistance() {
    return this.camera.aspect < 1 ? 24 / Math.max(this.camera.aspect * 1.4, 0.6) : 24
  }

  private setupPostprocessing(width: number, height: number) {
    if (this.lowPower) {
      return
    }
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.4, 0.3))
    this.composer.addPass(new OutputPass())
  }

  private buildEnvironment() {
    this.scene.add(new THREE.HemisphereLight('#6b8cff', '#05070f', 0.9))
    const sun = new THREE.DirectionalLight('#cfe3ff', 1.4)
    sun.position.set(30, 50, 20)
    this.scene.add(sun)
    const rim = new THREE.PointLight('#5eead4', 60, 80, 1.6)
    rim.position.set(0, 18, 0)
    this.scene.add(rim)

    const starCount = 1600
    const positions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      const radius = 160 + Math.random() * 180
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(Math.random() * 0.9 + 0.05)
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = radius * Math.cos(phi) - 20
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
      new THREE.PointsMaterial({ color: '#9fb8ff', size: 0.9, sizeAttenuation: true, fog: false }),
    )
    stars.name = 'stars'
    this.scene.add(stars)
  }

  private buildIsland(radius: number) {
    this.scene.getObjectByName('island')?.removeFromParent()
    const island = new THREE.Group()
    island.name = 'island'

    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.92, 1.6, 72),
      new THREE.MeshStandardMaterial({ color: '#08101f', roughness: 0.9, metalness: 0.2 }),
    )
    top.position.y = -0.8
    const rock = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.92, radius * 0.75, 72, 1, true),
      new THREE.MeshStandardMaterial({ color: '#060b16', roughness: 1, side: THREE.DoubleSide }),
    )
    rock.rotation.x = Math.PI
    rock.position.y = -1.6 - (radius * 0.75) / 2
    island.add(top, rock)

    const grid = new THREE.GridHelper(radius * 2, Math.round(radius), '#1d3b5c', '#10213a')
    const gridMaterial = grid.material as THREE.Material
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.45
    grid.position.y = 0.01
    const mask = new THREE.Mesh(
      new THREE.RingGeometry(radius, radius * 1.5, 72),
      new THREE.MeshBasicMaterial({ color: '#05070f', side: THREE.DoubleSide }),
    )
    mask.rotation.x = -Math.PI / 2
    mask.position.y = 0.02
    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.08, 8, 160),
      new THREE.MeshStandardMaterial({ color: '#5eead4', emissive: '#5eead4', emissiveIntensity: 1.5 }),
    )
    edge.rotation.x = Math.PI / 2
    island.add(grid, mask, edge)

    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + 0.4
      const distance = radius * (1.35 + (i % 3) * 0.18)
      const size = 1.5 + (i % 4)
      const shard = new THREE.Mesh(
        new THREE.ConeGeometry(size, size * 1.8, 6),
        new THREE.MeshStandardMaterial({ color: '#0a1324', emissive: '#1e3a8a', emissiveIntensity: 0.25 }),
      )
      shard.rotation.x = Math.PI
      shard.position.set(Math.cos(angle) * distance, -3 + (i % 3) * 3, Math.sin(angle) * distance)
      shard.userData.float = { base: shard.position.y, phase: i }
      island.add(shard)
    }

    this.scene.add(island)
  }

  private buildPaths(objects: WorldObject[]) {
    this.scene.getObjectByName('paths')?.removeFromParent()
    const paths = new THREE.Group()
    paths.name = 'paths'
    const hub = objects.reduce<WorldObject | null>(
      (closest, object) =>
        !closest || Math.hypot(object.position.x, object.position.z) < Math.hypot(closest.position.x, closest.position.z)
          ? object
          : closest,
      null,
    )
    if (!hub) {
      return
    }
    for (const object of objects) {
      if (object === hub) {
        continue
      }
      const from = new THREE.Vector3(hub.position.x, 0.05, hub.position.z)
      const to = new THREE.Vector3(object.position.x, 0.05, object.position.z)
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([from, to]),
        new THREE.LineDashedMaterial({ color: object.color, dashSize: 0.6, gapSize: 0.5, transparent: true, opacity: 0.6 }),
      )
      line.computeLineDistances()
      paths.add(line)
    }
    this.scene.add(paths)
  }

  private createZone(object: WorldObject, zoneRadius: number) {
    const color = new THREE.Color(object.color)
    const zoneRing = new THREE.Mesh(
      new THREE.RingGeometry(zoneRadius - 0.07, zoneRadius, 72),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
    )
    zoneRing.rotation.x = -Math.PI / 2
    zoneRing.position.set(object.position.x, 0.035, object.position.z)
    const zoneFill = new THREE.Mesh(
      new THREE.CircleGeometry(zoneRadius, 72),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    )
    zoneFill.rotation.x = -Math.PI / 2
    zoneFill.position.set(object.position.x, 0.03, object.position.z)
    this.scene.add(zoneRing, zoneFill)
    return { zoneRing, zoneFill }
  }

  setObjects(objects: WorldObject[]) {
    for (const entry of this.entries.values()) {
      entry.root.removeFromParent()
      entry.zoneRing.removeFromParent()
      entry.zoneFill.removeFromParent()
      entry.label.remove()
    }
    this.entries.clear()
    this.hitboxes = []

    this.worldRadius = Math.max(
      22,
      ...objects.map((object) => Math.hypot(object.position.x, object.position.z) + 9 * object.scale),
    )
    this.controls.maxDistance = this.worldRadius * 3
    this.buildIsland(this.worldRadius)
    this.buildPaths(objects)

    objects.forEach((object, index) => {
      const model = createProceduralModel(object.type, object.color)
      const root = new THREE.Group()
      root.position.set(object.position.x, object.position.y, object.position.z)
      root.scale.setScalar(object.scale)
      root.userData.slug = object.slug

      const padRadius = model.footprint + 0.6
      const { group: pad, ring } = createPad(object.color, padRadius)
      const body = new THREE.Group()
      body.add(model.group)
      root.add(pad, body)

      const hitbox = new THREE.Mesh(
        new THREE.CylinderGeometry(model.footprint + 1, model.footprint + 1, model.height + 1, 8),
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
      )
      hitbox.position.y = (model.height + 1) / 2
      hitbox.userData.slug = object.slug
      root.add(hitbox)

      const label = document.createElement('button')
      label.type = 'button'
      label.tabIndex = -1
      label.className = 'dw-label'
      label.style.setProperty('--dw-accent', object.color)
      label.textContent = object.title
      label.addEventListener('click', () => this.options.onObjectClick(object.slug))
      label.addEventListener('pointerenter', () => this.setHovered(object.slug))
      label.addEventListener('pointerleave', () => this.setHovered(null))
      const labelObject = new CSS2DObject(label)
      labelObject.position.set(0, model.height + 1.4, 0)
      root.add(labelObject)

      const radius = (padRadius + 0.3) * object.scale
      const zoneRadius = radius + ZONE_WIDTH
      const { zoneRing, zoneFill } = this.createZone(object, zoneRadius)

      this.scene.add(root)
      this.hitboxes.push(hitbox)
      this.entries.set(object.slug, {
        object,
        root,
        body,
        model,
        hitbox,
        label,
        ring,
        zoneRing,
        zoneFill,
        center: new THREE.Vector2(object.position.x, object.position.z),
        radius,
        zoneRadius,
        phase: index * 1.3,
      })
    })

    this.spawn()
    this.applyHighlight()
    void this.loadModels()
  }

  private spawnPoint() {
    const inAnyZone = (point: THREE.Vector3) =>
      [...this.entries.values()].some(
        (entry) => entry.center.distanceTo(new THREE.Vector2(point.x, point.z)) <= entry.zoneRadius + 0.5,
      )
    const angles = [...this.entries.values()]
      .filter((entry) => entry.center.length() > 2)
      .map((entry) => Math.atan2(entry.center.y, entry.center.x))
      .sort((a, b) => a - b)
    let heading = Math.PI / 2
    if (angles.length) {
      let widest = -1
      angles.forEach((angle, i) => {
        const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2
        if (next - angle > widest) {
          widest = next - angle
          heading = angle + widest / 2
        }
      })
    }
    for (const share of [0.78, 0.68, 0.88, 0.55]) {
      for (let i = 0; i < 24; i++) {
        const angle = heading + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 24)
        const point = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(this.worldRadius * share)
        if (!inAnyZone(point)) {
          return point
        }
      }
    }
    return new THREE.Vector3(0, 0, this.worldRadius * 0.62)
  }

  private spawn() {
    this.player.position.copy(this.resolveCollisions(this.spawnPoint()))
    this.player.faceTowards(this.player.position.clone().negate().setY(0), 1)
    this.previousPlayer.copy(this.player.position)
    this.resetCamera(true)
    this.updateZone()
  }

  private resetCamera(instant: boolean) {
    const target = this.player.position.clone().setY(CAMERA_HEIGHT)
    const away = new THREE.Vector3(this.player.position.x, 0, this.player.position.z)
    if (away.lengthSq() < 1) {
      away.set(0, 0, 1)
    }
    away.normalize()
    const position = target
      .clone()
      .addScaledVector(away, this.followDistance * 0.86)
      .add(new THREE.Vector3(0, this.followDistance * 0.5, 0))
    this.zoomedOut = false
    this.moveCamera(position, target, instant ? 'instant' : 'fly', 0.9)
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
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const fit = entry.model.height / Math.max(size.y, 0.001)
        model.scale.setScalar(fit)
        model.position.y = -box.min.y * fit
        entry.body.clear()
        entry.body.add(model)
        entry.model.spinners = []
        entry.model.floaters = []
      } catch (error) {
        console.warn(`[digital-world] GLB for "${entry.object.slug}" failed, keeping procedural model`, error)
      }
    }
  }

  private moveCamera(position: THREE.Vector3, target: THREE.Vector3, transition: CameraTransition, duration = 1.4) {
    this.cameraTween?.kill()
    if (this.options.reducedMotion || transition === 'instant') {
      this.camera.position.copy(position)
      this.controls.target.copy(target)
      this.controls.update()
      return
    }
    const fromPosition = this.camera.position.clone()
    const fromTarget = this.controls.target.clone()
    const fromPlayer = this.player.position.clone()
    const shift = new THREE.Vector3()
    const state = { t: 0 }
    this.cameraTween = gsap.to(state, {
      t: 1,
      duration,
      ease: 'power2.inOut',
      onUpdate: () => {
        shift.copy(this.player.position).sub(fromPlayer)
        this.camera.position.copy(fromPosition).lerp(position, state.t).add(shift)
        this.controls.target.copy(fromTarget).lerp(target, state.t).add(shift)
      },
    })
  }

  overview(transition: CameraTransition = 'fly') {
    const radius = this.worldRadius
    const halfV = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect)
    const distance = Math.max(radius * 2.2, (radius / Math.tan(halfH)) * 1.3)
    const target = this.player.position.clone().setY(CAMERA_HEIGHT)
    const direction = new THREE.Vector3(0, 0.57, 0.82).normalize()
    this.zoomedOut = true
    this.moveCamera(target.clone().addScaledVector(direction, distance), target, transition)
  }

  approachPoint(slug: string) {
    const entry = this.entries.get(slug)
    if (!entry) {
      return null
    }
    const from = new THREE.Vector2(this.player.position.x, this.player.position.z).sub(entry.center)
    if (from.lengthSq() < 0.01) {
      from.set(0, 1)
    }
    from.normalize().multiplyScalar(entry.radius + PLAYER_RADIUS + 0.9)
    return this.clampToIsland(new THREE.Vector3(entry.center.x + from.x, 0, entry.center.y + from.y))
  }

  walkTo(slug: string, transition: CameraTransition = 'fly'): Promise<boolean> {
    const point = this.approachPoint(slug)
    if (!point) {
      return Promise.resolve(false)
    }
    if (transition === 'instant') {
      this.cancelWalk()
      this.player.position.copy(this.resolveCollisions(point))
      const entry = this.entries.get(slug) as Entry
      this.player.faceTowards(new THREE.Vector3(entry.center.x - point.x, 0, entry.center.y - point.z), 1)
      this.followPlayer()
      this.resetCamera(true)
      this.updateZone()
      return Promise.resolve(true)
    }
    return this.startWalk(point, slug)
  }

  private startWalk(point: THREE.Vector3, slug: string | null) {
    this.cancelWalk()
    if (this.zoomedOut) {
      this.resetCamera(false)
    }
    this.marker.position.set(point.x, 0.04, point.z)
    this.marker.visible = true
    return new Promise<boolean>((resolve) => {
      this.walk = { points: this.buildPath(this.player.position.clone(), point, 0), slug, resolve, stuck: 0 }
    })
  }

  private cancelWalk() {
    if (this.walk) {
      const { resolve } = this.walk
      this.walk = null
      resolve(false)
    }
    this.marker.visible = false
  }

  private buildPath(start: THREE.Vector3, end: THREE.Vector3, depth: number): THREE.Vector3[] {
    if (depth > 3) {
      return [end]
    }
    const segment = new THREE.Vector2(end.x - start.x, end.z - start.z)
    const length = segment.length()
    if (length < 0.01) {
      return [end]
    }
    const direction = segment.clone().divideScalar(length)
    let blocker: { entry: Entry; t: number; closest: THREE.Vector2 } | null = null
    for (const entry of this.entries.values()) {
      const toCenter = entry.center.clone().sub(new THREE.Vector2(start.x, start.z))
      const t = THREE.MathUtils.clamp(toCenter.dot(direction), 0, length)
      const closest = new THREE.Vector2(start.x, start.z).addScaledVector(direction, t)
      const clearance = entry.radius + PLAYER_RADIUS + 0.15
      if (t > 0 && t < length && closest.distanceTo(entry.center) < clearance && (!blocker || t < blocker.t)) {
        blocker = { entry, t, closest }
      }
    }
    if (!blocker) {
      return [end]
    }
    const side = blocker.closest.clone().sub(blocker.entry.center)
    if (side.lengthSq() < 1e-4) {
      side.set(-direction.y, direction.x)
    }
    side.normalize().multiplyScalar(blocker.entry.radius + PLAYER_RADIUS + 1.4)
    const waypoint = this.clampToIsland(
      new THREE.Vector3(blocker.entry.center.x + side.x, 0, blocker.entry.center.y + side.y),
    )
    return [...this.buildPath(start, waypoint, depth + 1), ...this.buildPath(waypoint, end, depth + 1)]
  }

  private clampToIsland(point: THREE.Vector3) {
    const limit = this.worldRadius - 1.2
    const distance = Math.hypot(point.x, point.z)
    if (distance > limit) {
      point.x *= limit / distance
      point.z *= limit / distance
    }
    return point
  }

  private resolveCollisions(point: THREE.Vector3) {
    for (const entry of this.entries.values()) {
      const dx = point.x - entry.center.x
      const dz = point.z - entry.center.y
      const distance = Math.hypot(dx, dz)
      const minimum = entry.radius + PLAYER_RADIUS
      if (distance < minimum) {
        const scale = distance > 1e-4 ? minimum / distance : 0
        point.x = entry.center.x + (scale ? dx * scale : minimum)
        point.z = entry.center.y + dz * scale
      }
    }
    return this.clampToIsland(point)
  }

  private keyboardDirection() {
    let right = 0
    let forward = 0
    for (const code of this.keys) {
      const axis = MOVE_KEYS[code]
      if (axis) {
        right += axis[0]
        forward += axis[1]
      }
    }
    if (!right && !forward) {
      return null
    }
    const ahead = new THREE.Vector3()
    this.camera.getWorldDirection(ahead)
    ahead.y = 0
    ahead.normalize()
    const side = new THREE.Vector3().crossVectors(ahead, new THREE.Vector3(0, 1, 0))
    return ahead.multiplyScalar(forward).addScaledVector(side, right).normalize()
  }

  private stepPlayer(dt: number) {
    const before = this.player.position.clone()
    const manual = this.keyboardDirection()
    let direction: THREE.Vector3 | null = null

    if (manual) {
      if (this.walk) {
        this.cancelWalk()
      }
      if (this.zoomedOut) {
        this.resetCamera(false)
      }
      direction = manual
    } else if (this.walk) {
      const next = this.walk.points[0]
      const toNext = new THREE.Vector3(next.x - before.x, 0, next.z - before.z)
      if (toNext.length() < 0.25) {
        this.walk.points.shift()
        if (!this.walk.points.length) {
          const { resolve, slug } = this.walk
          this.walk = null
          this.marker.visible = false
          if (slug) {
            const entry = this.entries.get(slug) as Entry
            this.player.faceTowards(new THREE.Vector3(entry.center.x - before.x, 0, entry.center.y - before.z), 1)
          }
          resolve(true)
        }
      } else {
        direction = toNext.normalize()
      }
    }

    if (direction) {
      const step = Math.min(WALK_SPEED * dt, 1)
      const next = this.resolveCollisions(before.clone().addScaledVector(direction, step))
      this.player.position.copy(next)
      this.player.faceTowards(direction, dt)
      if (this.walk) {
        this.walk.stuck = before.distanceTo(next) < step * 0.2 ? this.walk.stuck + dt : 0
        if (this.walk.stuck > 0.6) {
          this.cancelWalk()
        }
      }
    }

    const moved = this.player.position.distanceTo(before)
    return dt > 0 ? moved / dt : 0
  }

  private followPlayer() {
    const delta = this.player.position.clone().sub(this.previousPlayer)
    if (delta.lengthSq() > 0) {
      if (!this.cameraTween?.isActive()) {
        this.camera.position.add(delta)
        this.controls.target.add(delta)
      }
      this.previousPlayer.copy(this.player.position)
    }
  }

  private updateZone() {
    let current: string | null = null
    let best = Infinity
    for (const [slug, entry] of this.entries) {
      const distance = entry.center.distanceTo(new THREE.Vector2(this.player.position.x, this.player.position.z))
      if (distance <= entry.zoneRadius && distance < best) {
        current = slug
        best = distance
      }
    }
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
      const active = inZone || slug === this.hovered
      entry.label.classList.toggle('is-active', active)
      entry.label.classList.toggle('is-zone', inZone)
      ;(entry.ring.material as THREE.MeshBasicMaterial).opacity = active ? 1 : 0.5
      ;(entry.zoneRing.material as THREE.MeshBasicMaterial).opacity = inZone ? 0.9 : 0.22
      ;(entry.zoneFill.material as THREE.MeshBasicMaterial).opacity = inZone ? 0.12 : 0
      for (const material of entry.model.glowMaterials) {
        material.userData.boost = active ? 1.6 : 1
      }
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

  private onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') {
      this.setPointer(event)
      this.setHovered(this.pickObject())
    }
  }

  private onPointerDown = (event: PointerEvent) => {
    this.downAt = { x: event.clientX, y: event.clientY }
  }

  private onPointerUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y) > 6) {
      return
    }
    this.setPointer(event)
    const slug = this.pickObject()
    if (slug) {
      this.options.onObjectClick(slug)
      return
    }
    const point = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3())
    if (point && Math.hypot(point.x, point.z) < this.worldRadius) {
      void this.startWalk(this.resolveCollisions(point), null)
    }
  }

  private onPointerLeave = () => this.setHovered(null)

  private onKeyDown = (event: KeyboardEvent) => {
    if (!(event.code in MOVE_KEYS) || isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }
    event.preventDefault()
    this.keys.add(event.code)
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

  private animate(dt: number, elapsed: number, speed: number) {
    const still = !!this.options.reducedMotion
    this.player.animate(dt, speed, elapsed, still)

    for (const [slug, entry] of this.entries) {
      const pulse = entry.object.animation === 'pulse' && !still ? 0.75 + Math.sin(elapsed * 2 + entry.phase) * 0.35 : 1
      for (const material of entry.model.glowMaterials) {
        material.userData.base ??= material.emissiveIntensity
        material.emissiveIntensity = (material.userData.base as number) * pulse * ((material.userData.boost as number) ?? 1)
      }
      if (slug === this.zone && !still) {
        ;(entry.zoneFill.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.sin(elapsed * 3) * 0.04
      }
      if (still) {
        continue
      }
      if (entry.object.animation === 'floating') {
        entry.body.position.y = Math.sin(elapsed * 1.1 + entry.phase) * 0.45 + 0.45
      }
      if (entry.object.animation === 'rotating') {
        entry.body.rotation.y = elapsed * 0.35
      }
      for (const spinner of entry.model.spinners) {
        spinner.rotation.y += dt * 0.25
      }
      for (const floater of entry.model.floaters) {
        floater.userData.baseY ??= floater.position.y
        floater.position.y = (floater.userData.baseY as number) + Math.sin(elapsed * 1.6 + entry.phase) * 0.25
      }
    }

    if (this.marker.visible && !still) {
      const scale = 1 + Math.sin(elapsed * 6) * 0.15
      this.marker.scale.set(scale, scale, scale)
    }

    if (!still) {
      this.scene.getObjectByName('island')?.children.forEach((child) => {
        const float = child.userData.float as { base: number; phase: number } | undefined
        if (float) {
          child.position.y = float.base + Math.sin(elapsed * 0.6 + float.phase) * 0.8
        }
      })
      const stars = this.scene.getObjectByName('stars')
      if (stars) {
        stars.rotation.y = elapsed * 0.004
      }
    }
  }

  private loop = () => {
    if (this.disposed) {
      return
    }
    this.frame = requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const elapsed = this.clock.elapsedTime
    const speed = this.stepPlayer(dt)
    this.followPlayer()
    this.updateZone()
    this.animate(dt, elapsed, speed)
    this.controls.update()
    if (this.composer) {
      this.composer.render()
    } else {
      this.renderer.render(this.scene, this.camera)
    }
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
    this.composer?.setSize(width, height)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.cameraTween?.kill()
    this.cancelWalk()
    this.resizeObserver.disconnect()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.controls.dispose()
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      ;(Array.isArray(material) ? material : material ? [material] : []).forEach((m) => m.dispose())
    })
    this.composer?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }
}
