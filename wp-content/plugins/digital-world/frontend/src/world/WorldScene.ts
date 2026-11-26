import * as THREE from 'three'
import gsap from 'gsap'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import type { CameraTransition, WorldObject } from '@/types'
import { isEditableTarget } from './dom'
import { pushOut } from './navigation'
import { foliageUniforms } from './foliage'
import { BOOK_SETTLED, PRINT_OPACITY, snapshotPage } from './book'
import { Interior } from './interior'
import { BookSpace } from './reading/BookSpace'
import { loadFont, warmGlyphs } from './reading/font'
import { sculptPage, type Sculpture } from './reading/sculpt'
import { Player, PLAYER_RADIUS } from './Player'
import { WorldModel, type Building } from './WorldModel'
import { STAND_READ_DISTANCE, STAND_READER_DISTANCE, STAND_SLUG } from './stand'
import { MiniIsland } from './island'
import { PageFigure } from './figure'
import type { Avatar } from './avatar'
import type { Placement, PlacementProblem } from './WorldModel'

export { isEditableTarget, isWebGLAvailable } from './dom'

interface Walk {
  points: THREE.Vector2[]
  resolve: (arrived: boolean) => void
  stuck: number
}

interface Drive {
  move: -1 | 0 | 1
  turn: -1 | 0 | 1
  remaining: number
  stuck: number
}

interface Sweep {
  from: number
  elapsed: number
  duration: number
}

export const MIN_DISTANCE = 4
export const MAX_DISTANCE = 20
const DRIVE_LIMIT = 80
const SPIN_DURATION = 7
const ORBIT_DURATION = 24

export type EnterResult = 'read' | 'navigate' | false

export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenPoint {
  x: number
  y: number
}

export interface StandLayout {
  spread: boolean
  left: ScreenRect | null
  right: ScreenRect
  leftQuad: ScreenPoint[] | null
  rightQuad: ScreenPoint[]
  pageAspect: number
}

export interface WorldSceneOptions {
  onObjectClick: (slug: string) => void
  onZoneChange: (slug: string | null) => void
  onStandZone?: (active: boolean) => void
  onStandLayout?: (layout: StandLayout | null) => void
  onIslandSelect?: (slug: string | null) => void
  onIslandProblem?: (problem: PlacementProblem) => void
  onIslandChange?: (placements: Map<string, Placement>) => void
  onLink?: (href: string) => void
  onBlocked?: () => void
  onMotion?: (moving: boolean) => void
  reducedMotion?: boolean
  avatar?: Avatar
}

const WALK_SPEED = 5.2
const TURN_SPEED = 2.6
const EYE = new THREE.Vector3(0, 1.6, 0)
const UP = new THREE.Vector3(0, 1, 0)
const SEE_TARGET = new THREE.Vector3(0, 1.3, 0)
const STAND_SPREAD_MIN_ASPECT = 1.05
const STAND_COVERAGE = 0.86
const STAND_ARC = 1.4
const ISLAND_TILT = THREE.MathUtils.degToRad(56)
const ISLAND_GROW = 1.4
const HIDE_PLAYER_WITHIN = 1.8
const KEYS = {
  forward: ['ArrowUp', 'KeyW'],
  back: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
}
const ALL_KEYS = new Set(Object.values(KEYS).flat())

function wait(ms: number) {
  return new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms))
}

function removeEnterButton(frame: HTMLIFrameElement) {
  const button = frame.contentDocument?.querySelector('.dw-enter')
  if (!button) {
    return
  }
  if (button.nextElementSibling?.tagName === 'STYLE') {
    button.nextElementSibling.remove()
  }
  button.remove()
}

function headingOf(direction: THREE.Vector3) {
  return Math.atan2(direction.x, direction.z)
}

export class WorldScene {
  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private pages: CSS3DRenderer
  private veil: HTMLDivElement
  private revealed = false
  private scene = new THREE.Scene()
  private activeScene: THREE.Scene = this.scene
  private interior: Interior | null = null
  private finish: (() => void) | null = null
  private speed = 1
  private maxRatio = 1
  private minRatio = 1
  private ratio = 1
  private pace = { frames: 0, time: 0, refresh: 0, calm: 0, cooldown: 0 }
  private camera: THREE.PerspectiveCamera
  private timer = new THREE.Timer()
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private sun: THREE.DirectionalLight
  private hovered: string | null = null
  private zone: string | null = null
  private atStand = false
  private standState: 'closed' | 'opening' | 'open' | 'closing' = 'closed'
  private standLayoutKey = ''
  private island: MiniIsland | null = null
  private islandReady = false
  private islandTilt = 0
  private islandTween: gsap.core.Tween | null = null
  private islandPress: { id: number; x: number; y: number; dragging: boolean } | null = null
  private figure: PageFigure | null = null
  private figureReady = false
  private figurePress: { id: number; x: number } | null = null
  private frame = 0
  private resizeObserver: ResizeObserver
  private disposed = false
  private player = new Player()
  private model: WorldModel
  private labelButtons = new Map<string, HTMLButtonElement>()
  private keys = new Set<string>()
  private walk: Walk | null = null
  private faceAfterWalk: number | null = null
  private marker: THREE.Mesh
  private mode: 'chase' | 'overview' | 'orbit' | 'cinematic' | 'reading' | 'book' = 'chase'
  private drive: Drive | null = null
  private spin: Sweep | null = null
  private orbit: Sweep | null = null
  private viewHold = false
  private space: BookSpace | null = null
  private reading = false
  private yawOffset = 0
  private pitchOffset = 0
  private distance = 9
  private look = new THREE.Vector3()
  private cinematicLook = new THREE.Vector3()
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null
  private locked = false
  private moving = false
  private pageLoads = 0
  private reservedRight = 0
  private timeline: gsap.core.Timeline | null = null
  private moveSpeed = 0
  private shadows: boolean

  constructor(
    private container: HTMLElement,
    private options: WorldSceneOptions,
  ) {
    const { clientWidth: width, clientHeight: height } = container
    this.shadows = !this.lowPower

    this.pages = new CSS3DRenderer()
    this.pages.setSize(width, height)
    this.pages.domElement.classList.add('dw-pages')
    container.appendChild(this.pages.domElement)

    this.maxRatio = Math.min(window.devicePixelRatio || 1, 2)
    this.minRatio = this.maxRatio >= 2 ? 1 : 0.75
    this.ratio = this.maxRatio
    this.renderer = new THREE.WebGLRenderer({ antialias: this.maxRatio < 2, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(this.ratio)
    this.renderer.setSize(width, height)
    this.renderer.shadowMap.enabled = this.shadows
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.domElement.classList.add('dw-canvas')
    container.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    this.labels.setSize(width, height)
    this.labels.domElement.classList.add('dw-labels')
    container.appendChild(this.labels.domElement)

    this.veil = document.createElement('div')
    this.veil.className = 'dw-veil'
    container.appendChild(this.veil)

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

    this.model = new WorldModel({ shadows: this.shadows, standLeaf: true })
    if (options.avatar) {
      this.player.setAvatar(options.avatar)
    }
    this.scene.add(this.player.root, this.marker, this.model.root)

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

  async reveal() {
    if (this.revealed) {
      return
    }
    this.revealed = true
    await this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    if (this.disposed || this.interior) {
      return
    }
    const veil = { value: Number(this.veil.style.opacity || 1) }
    gsap.to(veil, {
      value: 0,
      duration: this.options.reducedMotion ? 0.01 : 0.5,
      ease: 'power1.out',
      onUpdate: () => (this.veil.style.opacity = String(veil.value)),
    })
  }

  private get lowPower() {
    return window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600
  }

  private get defaultDistance() {
    return this.camera.aspect < 1 ? 12 : 9
  }

  setObjects(objects: WorldObject[], radius: number) {
    this.labelButtons.forEach((label) => label.remove())
    this.labelButtons.clear()
    this.model.setWorld(objects, radius)
    for (const [slug, building] of this.model.buildings) {
      const label = document.createElement('button')
      label.type = 'button'
      label.tabIndex = -1
      label.className = 'dw-label'
      label.style.setProperty('--dw-accent', building.object.color)
      label.textContent = building.object.title
      label.addEventListener('click', () => !this.locked && this.options.onObjectClick(slug))
      label.addEventListener('pointerenter', () => this.setHovered(slug))
      label.addEventListener('pointerleave', () => this.setHovered(null))
      building.anchor.add(new CSS2DObject(label))
      this.labelButtons.set(slug, label)
    }
    const reach = 26
    Object.assign(this.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 140 })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.placeAt(this.model.spawn, this.model.spawnHeading)
    this.applyHighlight()
  }

  private placeAt(point: THREE.Vector3, heading: number) {
    this.player.position.set(point.x, 0, point.z)
    this.player.heading = heading
    this.clearMotion()
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
      const hit = this.raycaster.intersectObjects(this.model.hitboxes, false)[0]
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
    const entry = this.model.buildings.get(slug)
    if (!entry) {
      return
    }
    if (this.reading) {
      this.space?.clear()
      this.reading = false
    }
    this.leaveInterior()
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

  stop() {
    this.cancelWalk()
    this.keys.clear()
    this.clearMotion()
    if (this.mode === 'orbit') {
      this.mode = 'overview'
    }
  }

  private clearMotion() {
    this.drive = null
    this.spin = null
    this.orbit = null
    this.viewHold = false
  }

  step(direction: 1 | -1, distance: number | null = null) {
    if (this.locked) {
      return false
    }
    this.cancelWalk()
    this.orbit = null
    this.mode = 'chase'
    this.drive = { move: direction, turn: 0, remaining: distance ?? DRIVE_LIMIT, stuck: 0 }
    return true
  }

  turnBy(angle: number) {
    if (this.locked || !angle) {
      return false
    }
    this.cancelWalk()
    this.orbit = null
    this.mode = 'chase'
    this.drive = { move: 0, turn: angle > 0 ? 1 : -1, remaining: Math.abs(angle), stuck: 0 }
    return true
  }

  zoom(delta: number) {
    return this.setZoom(this.distance + delta)
  }

  setZoom(distance: number) {
    if (this.locked) {
      return null
    }
    if (this.mode === 'overview' || this.mode === 'orbit') {
      this.orbit = null
      this.mode = 'chase'
    }
    this.distance = THREE.MathUtils.clamp(distance, MIN_DISTANCE, MAX_DISTANCE)
    return this.distance
  }

  lookToward(yaw: number, pitch: number) {
    if (this.locked) {
      return false
    }
    this.orbit = null
    this.spin = null
    this.mode = 'chase'
    this.yawOffset = yaw
    this.pitchOffset = pitch
    this.viewHold = yaw !== 0 || pitch !== 0
    return true
  }

  lookAround() {
    if (this.locked || this.options.reducedMotion) {
      return false
    }
    this.orbit = null
    this.mode = 'chase'
    this.viewHold = false
    this.spin = { from: this.yawOffset, elapsed: 0, duration: SPIN_DURATION }
    return true
  }

  orbitIsland() {
    if (this.locked || this.options.reducedMotion) {
      return false
    }
    this.cancelWalk()
    this.drive = null
    this.spin = null
    this.orbit = { from: Math.atan2(this.camera.position.x, this.camera.position.z), elapsed: 0, duration: ORBIT_DURATION }
    this.mode = 'orbit'
    return true
  }

  chase() {
    if (this.locked) {
      return false
    }
    this.orbit = null
    this.spin = null
    this.viewHold = false
    this.mode = 'chase'
    this.yawOffset = 0
    this.pitchOffset = 0
    this.distance = this.defaultDistance
    return true
  }

  walkTo(slug: string, transition: CameraTransition = 'fly'): Promise<boolean> {
    const target = this.walkTarget(slug)
    if (!target || this.locked) {
      return Promise.resolve(false)
    }
    if (transition === 'instant' || this.options.reducedMotion) {
      this.cancelWalk()
      this.placeAt(target.point, target.heading)
      return Promise.resolve(true)
    }
    return this.startWalk(new THREE.Vector2(target.point.x, target.point.z), target.heading)
  }

  private walkTarget(slug: string) {
    if (slug === STAND_SLUG) {
      const { stand } = this.model
      return {
        point: stand.position.clone().addScaledVector(stand.facing, STAND_READER_DISTANCE),
        heading: headingOf(stand.facing.clone().negate()),
      }
    }
    const entry = this.model.buildings.get(slug)
    return entry ? { point: entry.door.front, heading: headingOf(entry.door.outward.clone().negate()) } : null
  }

  private startWalk(goal: THREE.Vector2, face: number | null = null) {
    this.cancelWalk()
    this.drive = null
    this.orbit = null
    const from = new THREE.Vector2(this.player.position.x, this.player.position.z)
    const points = this.model.nav?.findPath(from, goal)
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
    for (const rect of this.model.colliders) {
      pushOut(point, rect, PLAYER_RADIUS)
    }
    const limit = this.model.radius - 1.3
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
      this.drive = null
      return
    }
    const turn = (this.pressed(KEYS.left) ? 1 : 0) - (this.pressed(KEYS.right) ? 1 : 0)
    const move = (this.pressed(KEYS.forward) ? 1 : 0) - (this.pressed(KEYS.back) ? 1 : 0)
    const before = new THREE.Vector2(this.player.position.x, this.player.position.z)
    let velocity: THREE.Vector2 | null = null

    if (turn || move) {
      this.cancelWalk()
      this.drive = null
      this.spin = null
      this.viewHold = false
      this.mode = 'chase'
      this.player.heading += turn * TURN_SPEED * dt
      if (move) {
        const forward = this.player.forward
        velocity = new THREE.Vector2(forward.x, forward.z).multiplyScalar(move * WALK_SPEED * (move > 0 ? 1 : 0.55))
      }
    } else if (this.drive) {
      const drive = this.drive
      this.viewHold = false
      if (drive.turn) {
        const angle = Math.min(TURN_SPEED * dt, drive.remaining)
        this.player.heading += drive.turn * angle
        drive.remaining -= angle
        if (drive.remaining <= 1e-4) {
          this.drive = null
        }
      } else if (drive.move && dt > 0) {
        const forward = this.player.forward
        const speed = Math.min(WALK_SPEED * (drive.move > 0 ? 1 : 0.55), drive.remaining / dt)
        velocity = new THREE.Vector2(forward.x, forward.z).multiplyScalar(drive.move * speed)
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
      const drive = this.drive
      if (drive?.move) {
        drive.remaining -= moved
        drive.stuck = moved < velocity.length() * dt * 0.2 ? drive.stuck + dt : 0
        if (drive.stuck > 0.4) {
          this.drive = null
          this.options.onBlocked?.()
        } else if (drive.remaining <= 0.01) {
          this.drive = null
        }
      }
    }
  }

  private updateCamera(dt: number) {
    if (this.mode === 'reading') {
      return
    }
    if (this.mode === 'cinematic') {
      this.camera.lookAt(this.cinematicLook)
      return
    }
    if (this.mode === 'book') {
      const pose = this.standPose()
      this.camera.position.copy(pose.position)
      this.cinematicLook.copy(pose.center)
      this.camera.lookAt(pose.center)
      return
    }
    if (this.spin) {
      const spin = this.spin
      spin.elapsed += dt
      const t = Math.min(1, spin.elapsed / spin.duration)
      this.yawOffset = spin.from + Math.PI * 2 * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
      if (t >= 1) {
        this.yawOffset = spin.from
        this.spin = null
      }
    } else if (!this.drag?.moved && !this.viewHold) {
      const decay = Math.exp(-dt * 3)
      this.yawOffset *= decay
      this.pitchOffset *= decay
    }
    let position: THREE.Vector3
    let target: THREE.Vector3
    if (this.mode === 'orbit' && this.orbit) {
      const orbit = this.orbit
      orbit.elapsed += dt
      const radius = this.model.radius
      const angle = orbit.from + (Math.PI * 2 * Math.min(orbit.elapsed, orbit.duration)) / orbit.duration
      position = new THREE.Vector3(Math.sin(angle) * radius * 1.35, radius * 0.75, Math.cos(angle) * radius * 1.35)
      target = new THREE.Vector3(0, 1, 0)
      if (orbit.elapsed >= orbit.duration) {
        this.orbit = null
        this.mode = 'overview'
      }
    } else if (this.mode === 'overview') {
      const radius = this.model.radius
      const away = new THREE.Vector3(this.player.position.x, 0, this.player.position.z)
      if (away.lengthSq() < 1) {
        away.set(0, 0, 1)
      }
      position = away.normalize().multiplyScalar(radius * 1.5).add(new THREE.Vector3(0, radius * 1.4, 0))
      target = new THREE.Vector3()
    } else {
      ;({ position, target } = this.chasePose())
    }
    const k = 1 - Math.exp(-dt * (this.mode === 'overview' || this.mode === 'orbit' ? 2.5 : 9))
    this.camera.position.lerp(position, k)
    this.look.lerp(target, k)
    this.camera.lookAt(this.look)
  }

  private updateMotion() {
    const moving = Boolean(
      this.walk ||
        this.drive ||
        this.spin ||
        this.orbit ||
        this.pageLoads ||
        this.timeline?.isActive() ||
        this.islandTween?.isActive() ||
        (this.reading && this.space?.moving),
    )
    if (moving !== this.moving) {
      this.moving = moving
      this.options.onMotion?.(moving)
    }
  }

  private updateZone() {
    const atStand = this.locked ? this.atStand : this.model.standZoneAt(this.player.position)
    if (atStand !== this.atStand) {
      this.atStand = atStand
      this.applyHighlight()
      this.options.onStandZone?.(atStand)
    }
    const current = this.locked ? this.zone : this.model.zoneAt(this.player.position)
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
    this.model.stand.setHighlight(this.atStand || this.hovered === STAND_SLUG)
    for (const [slug, entry] of this.model.buildings) {
      const inZone = slug === this.zone
      this.labelButtons.get(slug)?.classList.toggle('is-active', inZone || slug === this.hovered)
      this.labelButtons.get(slug)?.classList.toggle('is-zone', inZone)
      ;(entry.mat.material as THREE.MeshBasicMaterial).opacity = inZone ? 0.45 : 0.18
    }
  }

  private resetDoor(entry: Building) {
    entry.door.pivot.rotation.y = 0
    ;(entry.door.glow.material as THREE.MeshBasicMaterial).opacity = 0
  }

  private openPage(url: string) {
    const { clientWidth: width, clientHeight: height } = this.container
    const frame = document.createElement('iframe')
    frame.src = url
    frame.title = ''
    frame.tabIndex = -1
    frame.className = 'dw-page'
    frame.style.width = `${width}px`
    frame.style.height = `${height}px`
    const loaded = new Promise<void>((resolve) => {
      frame.addEventListener(
        'load',
        () => {
          removeEnterButton(frame)
          resolve()
        },
        { once: true },
      )
      window.setTimeout(resolve, 4000)
    })
    return { frame, width, height, loaded }
  }

  private play(timeline: gsap.core.Timeline) {
    return new Promise<boolean>((resolve) => {
      this.finish = () => resolve(false)
      this.timeline = timeline
      timeline.timeScale(this.speed)
      timeline.eventCallback('onComplete', () => {
        this.finish = null
        resolve(true)
      })
    })
  }

  private waitFor(promise: Promise<void>) {
    return new Promise<boolean>((resolve) => {
      this.finish = () => resolve(false)
      void promise.then(() => {
        this.finish = null
        resolve(true)
      })
    })
  }

  private stopCinematic() {
    this.timeline?.kill()
    this.timeline = null
    const finish = this.finish
    this.finish = null
    finish?.()
  }

  private leaveInterior() {
    this.stopCinematic()
    if (this.interior) {
      this.scene.add(this.player.root)
      this.interior.dispose()
      this.interior = null
    }
    this.activeScene = this.scene
    if (this.revealed) {
      this.veil.style.opacity = '0'
    }
  }

  hurry() {
    if (this.locked && (this.interior || this.standState === 'opening' || this.standState === 'closing')) {
      this.speed = 4
      this.timeline?.timeScale(this.speed)
    }
  }

  get standOpen() {
    return this.standState !== 'closed'
  }

  private get standSpread() {
    return this.standAspect >= STAND_SPREAD_MIN_ASPECT
  }

  private get standFree() {
    const width = this.renderer.domElement.clientWidth || window.innerWidth
    return THREE.MathUtils.clamp(1 - this.reservedRight / width, 0.4, 1)
  }

  private get standAspect() {
    return this.camera.aspect * this.standFree
  }

  setReservedRight(pixels: number) {
    this.reservedRight = Math.max(0, pixels)
  }

  private standPose() {
    const pose = this.centeredStandPose()
    const shift = 1 - this.standFree
    if (shift <= 0) {
      return pose
    }
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
    const offset = pose.position.distanceTo(pose.center) * tan * this.camera.aspect * shift
    const right = new THREE.Vector3().crossVectors(pose.center.clone().sub(pose.position), UP).normalize().multiplyScalar(offset)
    return { position: pose.position.add(right), center: pose.center.add(right) }
  }

  private centeredStandPose() {
    const { book } = this.model.stand
    const corners = book.pageCorners(this.standSpread ? 'spread' : 'right')
    const center = corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).multiplyScalar(0.25)
    const width = corners[0].distanceTo(corners[1])
    const height = corners[1].distanceTo(corners[2])
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
    const distance = Math.max(height / 2 / tan, width / 2 / (tan * this.standAspect)) / STAND_COVERAGE
    const flat = { position: center.clone().addScaledVector(book.normal(), distance), center }
    if (!this.island || this.islandTilt <= 0) {
      return flat
    }
    const angled = this.islandAngledPose()
    return {
      position: flat.position.lerp(angled.position, this.islandTilt),
      center: flat.center.lerp(angled.center, this.islandTilt),
    }
  }

  private islandAngledPose() {
    const { book } = this.model.stand
    const normal = book.normal()
    const spread = this.standSpread
    const corners = book.pageCorners(spread ? 'spread' : 'right')
    const middle = (points: THREE.Vector3[]) => points.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).multiplyScalar(1 / points.length)
    const right = middle(book.pageCorners('right'))
    const center = (spread ? middle(corners).lerp(right, 0.3) : right).addScaledVector(normal, 0.03)
    const toward = corners[3].clone().sub(corners[0]).normalize()
    const direction = normal.clone().multiplyScalar(Math.cos(ISLAND_TILT)).addScaledVector(toward, Math.sin(ISLAND_TILT)).normalize()
    const size = Math.min(book.pageWidth, book.pageHeight) * 0.95
    const width = spread ? corners[0].distanceTo(corners[1]) * 0.86 : size
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
    const distance = Math.max(size / 2 / tan, width / 2 / (tan * this.standAspect)) * 1.15
    return { position: center.clone().addScaledVector(direction, distance), center }
  }

  get islandShown() {
    return this.islandReady
  }

  showIsland(objects: WorldObject[], radius: number, turn: boolean): Promise<boolean> {
    if (this.standState !== 'open') {
      return Promise.resolve(false)
    }
    const { book } = this.model.stand
    this.island ??= new MiniIsland(book.pageAnchor, book.pageWidth, book.pageHeight)
    this.island.setWorld(objects, radius)
    this.island.setGrowth(0)
    this.islandReady = false
    const island = this.island
    const state = { grow: 0 }
    const tl = gsap.timeline()
    let start = 0
    if (this.figure) {
      book.setLeaf(1)
      this.shrinkFigure(tl, 0)
      tl.add(book.turnTimeline(false), 0.4)
      start = 1.15
    } else if (turn) {
      tl.add(book.turnTimeline(true), 0)
      start = 0.75
    }
    tl.to(state, { grow: 1, duration: ISLAND_GROW, ease: 'none', onUpdate: () => island.setGrowth(state.grow) }, start)
    this.speed = this.options.reducedMotion ? 50 : 1
    return this.play(tl).then((done) => {
      if (done && this.island === island) {
        island.setGrowth(1)
        this.islandReady = true
      }
      return done
    })
  }

  get avatarShown() {
    return this.figureReady
  }

  showAvatar(avatar: Avatar): Promise<boolean> {
    if (this.standState !== 'open' || this.figure) {
      return Promise.resolve(false)
    }
    const { book } = this.model.stand
    const tl = gsap.timeline()
    let start = 0
    if (this.island) {
      this.shrinkIsland(tl, 0)
      start = 0.4
    }
    book.setLeaf(0)
    tl.add(book.turnTimeline(true), start)
    const compact = !this.standSpread
    const figure = new PageFigure(book.pageAnchor, this.pageUp(), book.pageWidth, book.pageHeight, avatar, {
      fill: compact ? 0.5 : 0.52,
      shift: compact ? 0.2 : 0.06,
    })
    this.figure = figure
    const state = { grow: 0 }
    tl.to(state, { grow: 1, duration: 1.2, ease: 'none', onUpdate: () => figure.setGrowth(state.grow) }, start + 0.75)
    this.speed = this.options.reducedMotion ? 50 : 1
    return this.play(tl).then((done) => {
      if (done && this.figure === figure) {
        figure.setGrowth(1)
        this.figureReady = true
      }
      return done
    })
  }

  updateAvatar(avatar: Avatar) {
    this.figure?.setAvatar(avatar)
  }

  setPlayerAvatar(avatar: Avatar) {
    this.player.setAvatar(avatar)
  }

  private pageUp() {
    const { book } = this.model.stand
    const [topLeft, , , bottomLeft] = book.pageCorners('right')
    book.pageAnchor.updateWorldMatrix(true, false)
    const up = book.pageAnchor.worldToLocal(topLeft.clone()).sub(book.pageAnchor.worldToLocal(bottomLeft.clone()))
    up.y = 0
    return up.lengthSq() > 1e-8 ? up.normalize() : new THREE.Vector3(0, 0, -1)
  }

  private shrinkIsland(tl: gsap.core.Timeline, at: number) {
    const island = this.island
    if (!island) {
      return
    }
    this.islandReady = false
    island.select(null)
    this.islandTween?.kill()
    this.islandTween = null
    const state = { grow: 1, tilt: this.islandTilt }
    tl.to(state, { tilt: 0, duration: 0.6, ease: 'power2.inOut', onUpdate: () => (this.islandTilt = state.tilt) }, at)
    tl.to(state, { grow: 0, duration: 0.45, ease: 'power1.in', onUpdate: () => island.setGrowth(state.grow) }, at)
    tl.call(
      () => {
        if (this.island === island) {
          this.islandTilt = 0
          this.islandPress = null
          island.dispose()
          this.island = null
        }
      },
      [],
      at + 0.6,
    )
  }

  private shrinkFigure(tl: gsap.core.Timeline, at: number) {
    const figure = this.figure
    if (!figure) {
      return
    }
    this.figureReady = false
    this.figurePress = null
    const state = { grow: 1 }
    tl.to(state, { grow: 0, duration: 0.45, ease: 'power1.in', onUpdate: () => figure.setGrowth(state.grow) }, at)
    tl.call(
      () => {
        if (this.figure === figure) {
          this.disposeFigure()
        }
      },
      [],
      at + 0.45,
    )
  }

  private disposeFigure() {
    this.figureReady = false
    this.figurePress = null
    this.figure?.dispose()
    this.figure = null
  }

  updateIsland(objects: WorldObject[], radius: number) {
    if (this.island) {
      this.island.setWorld(objects, radius)
    }
  }

  setIslandMode(mode: 'top' | 'angled') {
    this.islandTween?.kill()
    const target = mode === 'angled' ? 1 : 0
    if (this.options.reducedMotion) {
      this.islandTilt = target
      return
    }
    this.islandTween = gsap.to(this, { islandTilt: target, duration: 1.1, ease: 'power2.inOut' })
  }

  rotateIsland(step = 1) {
    if (!this.islandReady || !this.island?.rotateSelected(step)) {
      return false
    }
    this.options.onIslandChange?.(this.island.placements)
    return true
  }

  get islandSelected() {
    return this.island?.selected ?? null
  }

  moveIslandBuilding(direction: 'up' | 'down' | 'left' | 'right', cells: number): { moved: number; problem: PlacementProblem | 'none' } {
    const island = this.island
    if (!this.islandReady || !island?.selected) {
      return { moved: 0, problem: 'none' }
    }
    const { origin, x, z } = island.axes
    const screen = (point: THREE.Vector3) => {
      const projected = point.clone().project(this.camera)
      return new THREE.Vector2(projected.x, projected.y)
    }
    const center = screen(origin)
    const wanted = { up: new THREE.Vector2(0, 1), down: new THREE.Vector2(0, -1), left: new THREE.Vector2(-1, 0), right: new THREE.Vector2(1, 0) }[direction]
    const options = [
      { dx: 1, dz: 0, along: screen(x).sub(center) },
      { dx: -1, dz: 0, along: center.clone().sub(screen(x)) },
      { dx: 0, dz: 1, along: screen(z).sub(center) },
      { dx: 0, dz: -1, along: center.clone().sub(screen(z)) },
    ]
    const best = options.reduce((a, b) => (b.along.normalize().dot(wanted) > a.along.normalize().dot(wanted) ? b : a))
    let problem: PlacementProblem | 'none' = null
    for (let step = cells; step >= 1; step--) {
      const result = island.moveSelected(best.dx * step, best.dz * step)
      if (!result) {
        this.options.onIslandChange?.(island.placements)
        return { moved: step, problem: step === cells ? null : problem }
      }
      problem ??= result
    }
    return { moved: 0, problem }
  }

  selectIsland(slug: string | null) {
    this.island?.select(slug)
    this.options.onIslandSelect?.(this.island?.selected ?? null)
  }

  hidePage(): Promise<boolean> {
    if ((!this.island && !this.figure) || this.standState !== 'open') {
      return Promise.resolve(false)
    }
    const { book } = this.model.stand
    const tl = gsap.timeline()
    this.shrinkIsland(tl, 0)
    this.shrinkFigure(tl, 0)
    tl.add(book.turnTimeline(false), 0.4)
    this.speed = this.options.reducedMotion ? 50 : 1
    return this.play(tl).then((done) => {
      this.disposeIsland()
      this.disposeFigure()
      return done
    })
  }

  private disposeIsland() {
    this.islandTween?.kill()
    this.islandTween = null
    this.islandTilt = 0
    this.islandReady = false
    this.islandPress = null
    this.island?.dispose()
    this.island = null
    this.model.stand.book.setLeaf(0)
  }

  private screenPoints(corners: THREE.Vector3[]): ScreenPoint[] {
    this.camera.updateMatrixWorld()
    const bounds = this.container.getBoundingClientRect()
    return corners.map((corner) => {
      const point = corner.clone().project(this.camera)
      return { x: bounds.left + ((point.x + 1) / 2) * bounds.width, y: bounds.top + ((1 - point.y) / 2) * bounds.height }
    })
  }

  private screenRect(corners: THREE.Vector3[]): ScreenRect {
    const points = this.screenPoints(corners)
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }

  private emitStandLayout(layout: StandLayout | null) {
    const key = layout
      ? [
          ...[layout.left, layout.right].map((rect) => (rect ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(',') : '-')),
          ...[layout.leftQuad ?? [], layout.rightQuad].map((quad) => quad.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(';')),
        ].join('|')
      : ''
    if (key === this.standLayoutKey) {
      return
    }
    this.standLayoutKey = key
    this.options.onStandLayout?.(layout)
  }

  private updateStandLayout() {
    if (this.standState !== 'open') {
      return
    }
    const { book } = this.model.stand
    const spread = this.standSpread
    const left = spread ? book.pageCorners('left') : null
    const right = book.pageCorners('right')
    this.emitStandLayout({
      spread,
      left: left ? this.screenRect(left) : null,
      right: this.screenRect(right),
      leftQuad: left ? this.screenPoints(left) : null,
      rightQuad: this.screenPoints(right),
      pageAspect: book.pageHeight / book.pageWidth,
    })
  }

  openStand(): Promise<boolean> {
    if (this.locked || this.standState !== 'closed') {
      return Promise.resolve(false)
    }
    this.locked = true
    this.cancelWalk()
    this.keys.clear()
    this.standState = 'opening'
    this.speed = this.options.reducedMotion ? 50 : 1
    this.mode = 'cinematic'
    this.cinematicLook.copy(this.look)
    return this.play(this.standOpenTimeline()).then((done) => {
      if (done && this.standState === 'opening') {
        this.standState = 'open'
        this.mode = 'book'
        this.updateStandLayout()
      }
      return done
    })
  }

  closeStand(): Promise<boolean> {
    if (this.standState === 'closed' || this.standState === 'closing') {
      return Promise.resolve(false)
    }
    this.stopCinematic()
    this.standState = 'closing'
    this.emitStandLayout(null)
    this.mode = 'cinematic'
    this.speed = this.options.reducedMotion ? 50 : 1
    return this.play(this.standCloseTimeline()).then((done) => {
      if (this.standState === 'closing') {
        this.standState = 'closed'
        this.disposeIsland()
        this.disposeFigure()
        this.player.reach(0)
        this.look.copy(this.cinematicLook)
        this.mode = 'chase'
        this.locked = false
      }
      return done
    })
  }

  private standOpenTimeline() {
    const { stand } = this.model
    const player = this.player
    const fromPosition = player.position.clone()
    const toPosition = stand.position.clone().addScaledVector(stand.facing, STAND_READ_DISTANCE)
    const fromHeading = player.heading
    const target = headingOf(stand.facing.clone().negate())
    const toHeading = fromHeading + Math.atan2(Math.sin(target - fromHeading), Math.cos(target - fromHeading))
    const fromCamera = this.camera.position.clone()
    const fromLook = this.cinematicLook.clone()
    const pose = this.standPose()
    const state = { walk: 0, fly: 0, reach: 0 }
    const tl = gsap.timeline()
    tl.to(
      state,
      {
        walk: 1,
        duration: 0.6,
        ease: 'sine.inOut',
        onUpdate: () => {
          player.position.lerpVectors(fromPosition, toPosition, state.walk)
          player.heading = THREE.MathUtils.lerp(fromHeading, toHeading, state.walk)
        },
      },
      0,
    )
    tl.to(
      state,
      {
        fly: 1,
        duration: 1.4,
        ease: 'power2.inOut',
        onUpdate: () => {
          this.camera.position.lerpVectors(fromCamera, pose.position, state.fly)
          this.camera.position.y += STAND_ARC * Math.sin(Math.PI * state.fly)
          this.cinematicLook.lerpVectors(fromLook, pose.center, state.fly)
        },
      },
      0,
    )
    tl.to(state, { reach: 1, duration: 0.35, onUpdate: () => player.reach(state.reach) }, 0.5)
    tl.add(stand.book.openTimeline(), 0.7)
    tl.to(state, { reach: 0, duration: 0.35, onUpdate: () => player.reach(state.reach) }, 1.25)
    return tl
  }

  private standCloseTimeline() {
    const fromCamera = this.camera.position.clone()
    const fromLook = this.cinematicLook.clone()
    this.yawOffset = 0
    this.pitchOffset = 0
    const { position, target } = this.chasePose()
    const state = { fly: 0, grow: 1 }
    const tl = gsap.timeline()
    const island = this.island
    let start = 0
    if (island) {
      this.islandReady = false
      island.select(null)
      tl.to(state, { grow: 0, duration: 0.45, ease: 'power1.in', onUpdate: () => island.setGrowth(state.grow) }, 0)
    }
    if (this.figure) {
      this.shrinkFigure(tl, 0)
    }
    if (island || this.figure) {
      tl.add(this.model.stand.book.turnTimeline(false), 0.4)
      start = 1.25
    }
    tl.add(this.model.stand.book.closeTimeline(), start)
    tl.to(
      state,
      {
        fly: 1,
        duration: 1.3,
        ease: 'power2.inOut',
        onUpdate: () => {
          this.camera.position.lerpVectors(fromCamera, position, state.fly)
          this.camera.position.y += STAND_ARC * Math.sin(Math.PI * state.fly)
          this.cinematicLook.lerpVectors(fromLook, target, state.fly)
        },
      },
      start + 0.9,
    )
    return tl
  }

  enter(slug: string, url: string): Promise<EnterResult> {
    const entry = this.model.buildings.get(slug)
    if (!entry || this.locked) {
      return Promise.resolve(false)
    }
    this.locked = true
    this.cancelWalk()
    this.keys.clear()
    if (this.options.reducedMotion) {
      return Promise.resolve('navigate')
    }
    void loadFont(300)
    void loadFont(400)
    this.leaveInterior()
    this.speed = 1
    const page = this.openPage(url)
    const interior = new Interior(entry.object, page.width / page.height, page.frame, page.height)
    this.interior = interior
    void page.loaded.then(() => (page.frame.contentDocument ? warmGlyphs(page.frame.contentDocument) : undefined)).catch(() => undefined)
    const ready = page.loaded
      .then(() => (interior.book.spread ? Promise.race([snapshotPage(page.frame, page.width, page.height), wait(3000)]) : null))
      .then((image) => {
        if (image) {
          interior.book.setPageImage(image)
        }
      })
      .catch(() => undefined)
    return this.playEntry(entry, ready, page.frame)
  }

  private async playEntry(entry: Building, loaded: Promise<void>, frame: HTMLIFrameElement): Promise<EnterResult> {
    const interior = this.interior as Interior
    const steps = [
      () => this.play(this.doorTimeline(entry)),
      () => {
        this.stepInside(interior)
        return this.play(this.walkTimeline(interior))
      },
      () => this.waitFor(loaded),
      () => this.play(this.bookTimeline(interior)),
    ]
    for (const step of steps) {
      if (!(await step()) || this.interior !== interior) {
        return false
      }
    }
    const sculpture = await this.sculpt(frame, entry.object.color)
    if (this.interior !== interior) {
      return false
    }
    if (!sculpture) {
      return 'navigate'
    }
    this.leaveInterior()
    void this.showSpace(sculpture, 'book')
    return 'read'
  }

  private async sculpt(frame: HTMLIFrameElement, color: string) {
    const doc = frame.contentDocument
    if (!doc) {
      return null
    }
    try {
      await doc.fonts?.ready
      const { clientWidth: width, clientHeight: height } = this.container
      return await sculptPage(doc, { width, height }, color)
    } catch {
      return null
    }
  }

  private showSpace(sculpture: Sculpture, from: 'book' | 'fade') {
    this.space ??= new BookSpace({
      container: this.container,
      canvas: this.renderer.domElement,
      camera: this.camera,
      reducedMotion: !!this.options.reducedMotion,
      onLink: (href) => this.options.onLink?.(href),
    })
    this.reading = true
    this.locked = true
    this.mode = 'reading'
    this.activeScene = this.space.scene
    return this.space.show(sculpture, from)
  }

  get readingTitle() {
    return this.space?.page?.title ?? ''
  }

  get isReading() {
    return this.reading
  }

  get readingLinks() {
    const seen = new Set<string>()
    const links: Array<{ text: string; href: string }> = []
    for (const link of this.space?.page?.links ?? []) {
      const key = `${link.text}|${link.href}`
      if (link.text && !seen.has(key)) {
        seen.add(key)
        links.push({ text: link.text, href: link.href })
      }
    }
    return links
  }

  get readingSections() {
    return this.space?.page?.sections ?? []
  }

  readStep(direction: 1 | -1) {
    return this.reading ? (this.space?.readStep(direction) ?? null) : null
  }

  readBottom() {
    return this.reading && Boolean(this.space?.flyToBottom())
  }

  readSection(y: number) {
    return this.reading && Boolean(this.space?.flyToY(y))
  }

  private loadHidden(url: string) {
    const { clientWidth: width, clientHeight: height } = this.container
    const frame = document.createElement('iframe')
    frame.src = url
    frame.title = ''
    frame.tabIndex = -1
    frame.setAttribute('aria-hidden', 'true')
    Object.assign(frame.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${width}px`,
      height: `${height}px`,
      border: '0',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '-1',
    })
    document.body.appendChild(frame)
    return new Promise<HTMLIFrameElement>((resolve) => {
      frame.addEventListener(
        'load',
        () => {
          removeEnterButton(frame)
          resolve(frame)
        },
        { once: true },
      )
      window.setTimeout(() => resolve(frame), 8000)
    })
  }

  async readUrl(url: string, color: string, slug: string | null) {
    this.pageLoads++
    try {
      return await this.loadPage(url, color, slug)
    } finally {
      this.pageLoads--
    }
  }

  private async loadPage(url: string, color: string, slug: string | null) {
    const frame = await this.loadHidden(url)
    const sculpture = await this.sculpt(frame, color)
    frame.remove()
    if (!sculpture || this.disposed) {
      return false
    }
    if (this.reading && this.space?.page) {
      await this.space.swap(sculpture)
      return true
    }
    if (slug && this.model.buildings.has(slug)) {
      this.placeAtDoor(slug)
    }
    this.cancelWalk()
    this.veil.style.opacity = '1'
    void this.showSpace(sculpture, 'fade')
    const veil = { value: 1 }
    gsap.to(veil, { value: 0, duration: this.options.reducedMotion ? 0.01 : 0.6, onUpdate: () => (this.veil.style.opacity = String(veil.value)) })
    return true
  }

  exitReading(slug: string | null) {
    if (slug && this.model.buildings.has(slug)) {
      this.placeAtDoor(slug)
      return
    }
    this.space?.clear()
    this.reading = false
    this.activeScene = this.scene
    this.mode = 'chase'
    this.locked = false
    this.snapCamera()
  }

  readHere() {
    this.space?.readHere()
  }

  readingText(scope: 'screen' | 'rest') {
    return this.reading ? (this.space?.text(scope, scope === 'rest' ? 4000 : 1200) ?? '') : ''
  }

  readTop() {
    this.space?.flyToTop()
  }

  flyToAnchor(id: string) {
    this.space?.flyToAnchor(id)
  }

  private doorTimeline(entry: Building) {
    const { door } = entry
    const player = this.player
    const inward = door.outward.clone().negate()
    const doorHeading = headingOf(inward)
    const start = player.position.clone()
    const right = new THREE.Vector3().crossVectors(inward, UP).normalize()
    const doorCenter = door.world.clone().setY(1)
    const portrait = this.camera.aspect < 1 ? 1.6 : 1
    const shoulder = door.world.clone().addScaledVector(door.outward, 4.2 * portrait).addScaledVector(right, 0.65).setY(2.2 + (portrait - 1))
    const through = door.world.clone().addScaledVector(door.outward, 0.25).setY(1)
    const inside = door.world.clone().addScaledVector(inward, 1.2)
    const cameraFrom = this.camera.position.clone()
    const lookFrom = this.look.clone()
    this.cinematicLook.copy(lookFrom)
    this.mode = 'cinematic'

    const state = { approach: 0, camera: 0, reach: 0, door: 0, walkIn: 0, push: 0 }
    const startHeading = player.heading
    const turn = Math.atan2(Math.sin(doorHeading - startHeading), Math.cos(doorHeading - startHeading))
    const approachTime = Math.min(0.8, start.distanceTo(door.front) / WALK_SPEED)

    const tl = gsap.timeline()
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
      duration: 0.55,
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
        duration: 0.8,
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
        push: 1,
        duration: 1,
        ease: 'power2.in',
        onUpdate: () => {
          this.camera.position.lerpVectors(shoulder, through, state.push)
          this.cinematicLook.copy(doorCenter).addScaledVector(inward, state.push * 1.5)
          this.veil.style.opacity = String(THREE.MathUtils.smoothstep(state.push, 0.45, 1))
        },
      },
      '<0.3',
    )
    return tl
  }

  private stepInside(interior: Interior) {
    this.activeScene = interior.scene
    interior.scene.add(this.player.root)
    this.player.root.visible = true
    this.player.reach(0)
    this.player.position.copy(interior.entry)
    this.player.heading = Math.PI
    this.camera.position.copy(interior.doorway)
    this.cinematicLook.copy(interior.entry).add(new THREE.Vector3(0, 1.3, -3))
  }

  private bookPose(interior: Interior, distance: number) {
    const center = interior.book.contentCenter()
    return { position: center.clone().addScaledVector(interior.book.normal(), distance), center }
  }

  private fillDistance(interior: Interior) {
    return interior.book.pageHeight / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
  }

  private walkTimeline(interior: Interior) {
    const player = this.player
    const start = interior.entry.clone()
    const stand = interior.stand.clone()
    const walkTime = start.distanceTo(stand) / 3.6
    const doorway = interior.doorway.clone()
    const doorLook = this.cinematicLook.clone()
    const follow = this.camera.aspect < 1 ? new THREE.Vector3(0.3, 2.9, 3.2) : new THREE.Vector3(0.5, 2.45, 2.3)
    const ahead = new THREE.Vector3(0, 1.3, -2.4)
    const view = this.bookPose(interior, this.fillDistance(interior) * 2.2)
    const state = { veil: 1, walk: 0, frame: 0, reach: 0 }
    const cameraFrom = new THREE.Vector3()
    const lookFrom = new THREE.Vector3()

    const tl = gsap.timeline()
    tl.to(state, { veil: 0, duration: 0.45, ease: 'power1.out', onUpdate: () => (this.veil.style.opacity = String(state.veil)) }, 0)
    tl.to(
      state,
      {
        walk: 1,
        duration: walkTime,
        ease: 'sine.out',
        onUpdate: () => {
          player.position.lerpVectors(start, stand, state.walk)
          this.moveSpeed = WALK_SPEED * 0.7 * (1 - state.walk * 0.6)
          const blend = THREE.MathUtils.smoothstep(state.walk, 0, 0.35)
          this.camera.position.lerpVectors(doorway, player.position.clone().add(follow), blend)
          this.camera.position.z = Math.min(this.camera.position.z, THREE.MathUtils.lerp(doorway.z, interior.backWall, blend))
          this.cinematicLook.lerpVectors(doorLook, player.position.clone().add(ahead), blend)
        },
        onComplete: () => {
          this.moveSpeed = 0
        },
      },
      0,
    )
    tl.to(state, { reach: 1, duration: 0.4, onUpdate: () => player.reach(state.reach) }, walkTime - 0.2)
    tl.to(
      state,
      {
        frame: 1,
        duration: 1.1,
        ease: 'power2.inOut',
        onStart: () => {
          cameraFrom.copy(this.camera.position)
          lookFrom.copy(this.cinematicLook)
        },
        onUpdate: () => {
          const arc = Math.sin(Math.PI * state.frame)
          this.camera.position.lerpVectors(cameraFrom, view.position, state.frame).add(new THREE.Vector3(arc * 0.55, arc * 0.45, 0))
          this.cinematicLook.lerpVectors(lookFrom, view.center, state.frame)
        },
      },
      walkTime - 0.35,
    )
    return tl
  }

  private bookTimeline(interior: Interior) {
    const { book } = interior
    const fill = this.fillDistance(interior)
    const near = this.bookPose(interior, fill * 1.75)
    const final = this.bookPose(interior, fill)
    const from = this.camera.position.clone()
    const state = { reach: 1, drift: 0, push: 0 }
    const tl = gsap.timeline()
    tl.add(book.openTimeline(), 0)
    tl.to(state, { reach: 0, duration: 0.35, onUpdate: () => this.player.reach(state.reach) }, 0.25)
    tl.to(
      state,
      {
        drift: 1,
        duration: 2.3,
        ease: 'sine.inOut',
        onUpdate: () => {
          this.camera.position.lerpVectors(from, near.position, state.drift)
          this.cinematicLook.copy(near.center)
        },
      },
      0,
    )
    tl.to(
      state,
      {
        push: 1,
        duration: 0.9,
        ease: 'power2.inOut',
        onUpdate: () => {
          this.camera.position.lerpVectors(near.position, final.position, state.push)
          this.cinematicLook.copy(final.center)
          book.setPrint(PRINT_OPACITY * (1 - state.push))
        },
      },
      Math.max(2.3, BOOK_SETTLED),
    )
    return tl
  }

  private onIslandDown(event: PointerEvent) {
    const island = this.island as MiniIsland
    this.setPointer(event)
    const slug = island.pick(this.raycaster)
    const point = island.groundPoint(this.raycaster)
    this.islandPress = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false }
    if (slug && point && island.beginDrag(slug, point)) {
      this.islandPress.dragging = true
      this.renderer.domElement.setPointerCapture(event.pointerId)
      this.renderer.domElement.style.cursor = 'grabbing'
      this.options.onIslandSelect?.(slug)
    }
  }

  private onIslandMove(event: PointerEvent) {
    const island = this.island as MiniIsland
    this.setPointer(event)
    if (this.islandPress?.dragging && this.islandPress.id === event.pointerId) {
      const point = island.groundPoint(this.raycaster)
      if (point) {
        this.options.onIslandProblem?.(island.moveDrag(point))
      }
      return
    }
    if (event.pointerType === 'mouse') {
      this.renderer.domElement.style.cursor = island.pick(this.raycaster) ? 'grab' : ''
    }
  }

  private onIslandUp(event: PointerEvent) {
    const island = this.island as MiniIsland
    const press = this.islandPress
    if (!press || press.id !== event.pointerId) {
      return
    }
    this.islandPress = null
    this.renderer.domElement.style.cursor = ''
    if (press.dragging) {
      const committed = island.endDrag()
      this.options.onIslandProblem?.(null)
      if (committed) {
        this.options.onIslandChange?.(island.placements)
      }
      return
    }
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) {
      this.selectIsland(null)
    }
  }

  private onFigureDown(event: PointerEvent) {
    this.figurePress = { id: event.pointerId, x: event.clientX }
    this.renderer.domElement.setPointerCapture(event.pointerId)
    this.renderer.domElement.style.cursor = 'grabbing'
  }

  private onFigureMove(event: PointerEvent) {
    const press = this.figurePress
    if (press && press.id === event.pointerId) {
      this.figure?.rotateBy((event.clientX - press.x) * 0.012)
      press.x = event.clientX
      return
    }
    if (event.pointerType === 'mouse' && this.figure) {
      this.setPointer(event)
      this.renderer.domElement.style.cursor = this.figure.pick(this.raycaster) ? 'grab' : ''
    }
  }

  private onFigureUp(event: PointerEvent) {
    if (this.figurePress?.id === event.pointerId) {
      this.figurePress = null
      this.renderer.domElement.style.cursor = ''
    }
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.figureReady && this.figure) {
      this.onFigureDown(event)
      return
    }
    if (this.islandReady && this.island) {
      this.onIslandDown(event)
      return
    }
    if (this.locked) {
      this.hurry()
    }
    if (!this.drag) {
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.figureReady && this.figure) {
      this.onFigureMove(event)
      return
    }
    if (this.islandReady && this.island) {
      this.onIslandMove(event)
      return
    }
    if (this.drag && this.drag.id === event.pointerId) {
      const dx = event.clientX - this.drag.x
      const dy = event.clientY - this.drag.y
      if (!this.drag.moved && Math.hypot(dx, dy) > 6) {
        this.drag.moved = true
        this.renderer.domElement.setPointerCapture(event.pointerId)
      }
      if (this.drag.moved) {
        if (!this.locked) {
          this.viewHold = false
          this.spin = null
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
    if (this.figurePress) {
      this.onFigureUp(event)
      return
    }
    if (this.islandReady && this.island) {
      this.onIslandUp(event)
      return
    }
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
    if (point && Math.hypot(point.x, point.z) < this.model.radius - 1) {
      void this.startWalk(this.resolve(new THREE.Vector2(point.x, point.z)))
    }
  }

  private onPointerLeave = () => this.setHovered(null)

  private onWheel = (event: WheelEvent) => {
    event.preventDefault()
    if (!this.locked) {
      this.distance = THREE.MathUtils.clamp(this.distance + event.deltaY * 0.01, MIN_DISTANCE, MAX_DISTANCE)
    }
  }

  private setPointer(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
  }

  private pickObject() {
    const hit = this.raycaster.intersectObjects([...this.model.hitboxes, this.model.stand.hitbox], false)[0]
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
      this.timer.update()
      this.loop()
    }
  }

  private adaptResolution(dt: number) {
    const pace = this.pace
    if (dt > 0.25) {
      pace.frames = 0
      pace.time = 0
      return
    }
    pace.frames++
    pace.time += dt
    pace.cooldown = Math.max(0, pace.cooldown - dt)
    if (pace.time < 1) {
      return
    }
    const fps = pace.frames / pace.time
    pace.frames = 0
    pace.time = 0
    pace.refresh = Math.max(pace.refresh * 0.98, fps)
    let next = this.ratio
    if (fps < 50 && fps < pace.refresh * 0.8 && pace.cooldown === 0) {
      next = Math.max(this.minRatio, this.ratio - 0.25)
      pace.calm = 0
    } else if (fps > pace.refresh * 0.95) {
      pace.calm++
      if (pace.calm >= 3) {
        next = Math.min(this.maxRatio, this.ratio + 0.25)
        pace.calm = 0
      }
    } else {
      pace.calm = 0
    }
    if (next !== this.ratio) {
      this.ratio = next
      this.renderer.setPixelRatio(next)
      pace.cooldown = 1.5
    }
  }

  private loop = () => {
    if (this.disposed) {
      return
    }
    this.frame = requestAnimationFrame(this.loop)
    this.timer.update()
    const raw = this.timer.getDelta()
    const dt = Math.min(raw, 0.1)
    const elapsed = this.timer.getElapsed()
    this.adaptResolution(raw)
    if (this.reading && this.space) {
      this.space.update(dt, elapsed)
    }
    this.stepPlayer(dt)
    this.updateZone()
    this.updateMotion()
    this.player.animate(dt, this.moveSpeed, elapsed, !!this.options.reducedMotion)
    this.figure?.update(dt, elapsed, !!this.options.reducedMotion)
    this.updateCamera(dt)
    this.updateStandLayout()
    this.player.root.visible =
      this.standState === 'closed' || this.camera.position.distanceTo(this.player.position.clone().add(EYE)) > HIDE_PLAYER_WITHIN
    if (!this.options.reducedMotion) {
      this.model.animateClouds(elapsed)
      if (this.marker.visible) {
        this.marker.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.15)
      }
    }
    this.sun.position.set(this.player.position.x + 28, 46, this.player.position.z + 18)
    this.sun.target.position.copy(this.player.position)
    if (this.activeScene === this.scene) {
      foliageUniforms.uSeeFrom.value.copy(this.camera.position)
      foliageUniforms.uSeeTo.value.copy(this.player.position).add(SEE_TARGET)
      foliageUniforms.uSeeStrength.value = this.standState === 'closed' ? 1 : 0
      foliageUniforms.uSeeCell.value = this.renderer.getPixelRatio()
    }
    this.renderer.render(this.activeScene, this.camera)
    if (this.activeScene === this.scene) {
      this.labels.render(this.scene, this.camera)
    }
    if (this.interior) {
      this.pages.render(this.interior.scene, this.camera)
    }
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
    this.pages.setSize(width, height)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    foliageUniforms.uSeeStrength.value = 0
    this.space?.dispose()
    this.disposeFigure()
    this.leaveInterior()
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
    this.pages.domElement.remove()
    this.veil.remove()
  }
}
