import * as THREE from 'three'
import gsap from 'gsap'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import type { CameraTransition, WorldObject } from '@/types'
import { isEditableTarget } from './dom'
import { pushOut } from './navigation'
import { foliageUniforms } from './foliage'
import { Interior, PRINT_OPACITY, SHEET_COUNT, snapshotPage } from './interior'
import { BookSpace } from './reading/BookSpace'
import { loadFont, warmGlyphs } from './reading/font'
import { sculptPage, type Sculpture } from './reading/sculpt'
import { Player, PLAYER_RADIUS } from './Player'
import { WorldModel, type Building } from './WorldModel'

export { isEditableTarget, isWebGLAvailable } from './dom'

interface Walk {
  points: THREE.Vector2[]
  resolve: (arrived: boolean) => void
  stuck: number
}

export type EnterResult = 'read' | 'navigate' | false

export interface WorldSceneOptions {
  onObjectClick: (slug: string) => void
  onZoneChange: (slug: string | null) => void
  onLink?: (href: string) => void
  reducedMotion?: boolean
}

const WALK_SPEED = 5.2
const TURN_SPEED = 2.6
const EYE = new THREE.Vector3(0, 1.6, 0)
const UP = new THREE.Vector3(0, 1, 0)
const SEE_TARGET = new THREE.Vector3(0, 1.3, 0)
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

function headingOf(direction: THREE.Vector3) {
  return Math.atan2(direction.x, direction.z)
}

export class WorldScene {
  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private pages: CSS3DRenderer
  private veil: HTMLDivElement
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
  private mode: 'chase' | 'overview' | 'cinematic' | 'reading' = 'chase'
  private space: BookSpace | null = null
  private reading = false
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

    this.model = new WorldModel({ shadows: this.shadows })
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
    this.placeAt(this.model.spawn, headingOf(this.model.spawn.clone().negate()))
    this.applyHighlight()
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

  walkTo(slug: string, transition: CameraTransition = 'fly'): Promise<boolean> {
    const entry = this.model.buildings.get(slug)
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
    if (this.mode === 'reading') {
      return
    }
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
    const k = 1 - Math.exp(-dt * (this.mode === 'overview' ? 2.5 : 9))
    this.camera.position.lerp(position, k)
    this.look.lerp(target, k)
    this.camera.lookAt(this.look)
  }

  private updateZone() {
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
      frame.addEventListener('load', () => resolve(), { once: true })
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
    this.veil.style.opacity = '0'
  }

  hurry() {
    if (this.locked && this.interior) {
      this.speed = 4
      this.timeline?.timeScale(this.speed)
    }
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
      frame.addEventListener('load', () => resolve(frame), { once: true })
      window.setTimeout(() => resolve(frame), 8000)
    })
  }

  async readUrl(url: string, color: string, slug: string | null) {
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
    const state = { cover: 0, reach: 1, reveal: 0, drift: 0, push: 0, sheets: Array.from({ length: SHEET_COUNT }, () => 0) }
    const tl = gsap.timeline()
    tl.to(state, { cover: 1, duration: 0.75, ease: 'power2.inOut', onUpdate: () => book.setCover(state.cover) }, 0)
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
    state.sheets.forEach((_, index) => {
      const sheet = { t: 0 }
      tl.to(sheet, { t: 1, duration: 0.85, ease: 'sine.inOut', onUpdate: () => book.setSheet(index, sheet.t) }, 0.5 + index * 0.32)
    })
    const lastSheet = 0.5 + (state.sheets.length - 1) * 0.32
    tl.to(state, { reveal: 1, duration: 0.45, ease: 'power1.inOut', onUpdate: () => book.setReveal(state.reveal) }, lastSheet + 0.9)
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
      Math.max(2.3, lastSheet + 1.35),
    )
    return tl
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.locked) {
      this.hurry()
    }
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
    if (point && Math.hypot(point.x, point.z) < this.model.radius - 1) {
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
    const hit = this.raycaster.intersectObjects(this.model.hitboxes, false)[0]
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
    this.player.animate(dt, this.moveSpeed, elapsed, !!this.options.reducedMotion)
    this.updateCamera(dt)
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
      foliageUniforms.uSeeStrength.value = 1
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
