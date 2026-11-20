import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { WorldObject } from '@/types'
import { checkPlacement, MIN_RADIUS, WorldModel, type Placement, type PlacementProblem } from '@/world/WorldModel'

export interface EditorCallbacks {
  onSelect: (slug: string | null) => void
  onCommit: (slug: string, placement: Placement) => void
  onDragProblem: (problem: PlacementProblem) => void
}

const VALID = new THREE.Color('#2271b1')
const INVALID = new THREE.Color('#d63638')

const NORTH = new THREE.Vector3(0, 0, -1)

export class WorldEditor {
  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private compass: HTMLButtonElement
  private compassRose: HTMLElement
  private compassAngle = NaN
  private turn: { from: number; to: number; started: number } | null = null
  private model = new WorldModel({ shadows: false })
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private labelButtons = new Map<string, HTMLButtonElement>()
  private selection: THREE.LineSegments
  private boundary: THREE.Line | null = null
  private grid: THREE.GridHelper | null = null
  private selected: string | null = null
  private drag: { slug: string; offset: THREE.Vector2; origin: Placement; current: Placement; problem: PlacementProblem } | null = null
  private frame = 0
  private resizeObserver: ResizeObserver
  private disposed = false

  constructor(
    private container: HTMLElement,
    private callbacks: EditorCallbacks,
    private options: { readOnly?: boolean } = {},
  ) {
    const { clientWidth: width, clientHeight: height } = container
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height)
    container.appendChild(this.renderer.domElement)

    this.labels = new CSS2DRenderer()
    this.labels.setSize(width, height)
    this.labels.domElement.className = 'dwe-labels'
    container.appendChild(this.labels.domElement)

    this.compass = document.createElement('button')
    this.compass.type = 'button'
    this.compass.className = 'dwe-compass'
    this.compass.title = 'Повернути панораму північчю догори'
    this.compass.setAttribute('aria-label', 'Компас. Натисніть, щоб повернути панораму північчю догори')
    this.compass.innerHTML = `<span class="dwe-compass__rose" aria-hidden="true">
      <svg viewBox="0 0 64 64" width="64" height="64">
        <circle cx="32" cy="32" r="30" class="dwe-compass__dial" />
        <path d="M32 9 L38 32 L26 32 Z" class="dwe-compass__north" />
        <path d="M32 55 L26 32 L38 32 Z" class="dwe-compass__south" />
        <circle cx="32" cy="32" r="3" class="dwe-compass__pin" />
        <text x="32" y="7.5" class="dwe-compass__letter is-north">Пн</text>
        <text x="58.5" y="35" class="dwe-compass__letter">Сх</text>
        <text x="32" y="62" class="dwe-compass__letter">Пд</text>
        <text x="5.5" y="35" class="dwe-compass__letter">Зх</text>
      </svg>
    </span>`
    this.compassRose = this.compass.firstElementChild as HTMLElement
    this.compass.addEventListener('click', () => this.faceNorth())
    container.appendChild(this.compass)

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 600)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = Math.PI * 0.47
    this.controls.minDistance = 12
    this.controls.maxDistance = 220
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }

    this.scene.background = new THREE.Color('#9dd4f7')
    this.scene.fog = new THREE.Fog('#cfe9f8', 160, 420)
    this.scene.add(new THREE.HemisphereLight('#eaf6ff', '#7d6a4c', 1.6))
    const sun = new THREE.DirectionalLight('#fff3d6', 2)
    sun.position.set(28, 46, 18)
    this.scene.add(sun, this.model.root)

    this.selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: VALID, depthTest: false, transparent: true }),
    )
    this.selection.renderOrder = 10
    this.selection.visible = false
    this.scene.add(this.selection)

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true })
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.loop()
  }

  get radius() {
    return this.model.radius
  }

  setWorld(objects: WorldObject[], radius: number) {
    this.labelButtons.forEach((label) => label.remove())
    this.labelButtons.clear()
    this.model.setWorld(objects, radius)
    for (const [slug, building] of this.model.buildings) {
      this.attachLabel(slug, building.object)
    }
    this.drawGuides()
    this.resetCamera()
  }

  private attachLabel(slug: string, object: WorldObject) {
    const building = this.model.buildings.get(slug)
    if (!building) {
      return
    }
    building.anchor.clear()
    const label = document.createElement('button')
    label.type = 'button'
    label.className = 'dwe-tag'
    label.style.setProperty('--dwe-accent', object.color)
    label.textContent = object.title
    label.addEventListener('click', () => this.select(slug))
    building.anchor.add(new CSS2DObject(label))
    this.labelButtons.set(slug, label)
  }

  updateObject(object: WorldObject) {
    this.model.updateBuilding(object)
    this.attachLabel(object.slug, object)
    this.model.rebuildTerrain()
    this.refreshSelection()
  }

  setRadius(radius: number) {
    this.model.setRadius(radius)
    this.drawGuides()
  }

  minimumRadius() {
    let needed = MIN_RADIUS
    for (const building of this.model.buildings.values()) {
      for (const rect of [building.rect, building.zone]) {
        for (const [x, z] of [
          [rect.minX, rect.minZ],
          [rect.minX, rect.maxZ],
          [rect.maxX, rect.minZ],
          [rect.maxX, rect.maxZ],
        ]) {
          needed = Math.max(needed, Math.ceil(Math.hypot(x, z) + 1.5))
        }
      }
    }
    return needed
  }

  placementOf(slug: string) {
    return this.model.placementOf(slug)
  }

  check(slug: string, placement: Placement) {
    return checkPlacement(placement, this.model.othersThan(slug), this.model.radius)
  }

  select(slug: string | null) {
    this.selected = slug && this.model.buildings.has(slug) ? slug : null
    this.labelButtons.forEach((label, key) => label.classList.toggle('is-selected', key === this.selected))
    this.refreshSelection()
    this.callbacks.onSelect(this.selected)
  }

  focus(slug: string) {
    const building = this.model.buildings.get(slug)
    if (!building) {
      return
    }
    const target = new THREE.Vector3(building.center.x, 2, building.center.y)
    const offset = this.camera.position.clone().sub(this.controls.target)
    offset.setLength(Math.min(offset.length(), 45))
    this.controls.target.copy(target)
    this.camera.position.copy(target).add(offset)
  }

  resetCamera() {
    const r = this.model.radius
    this.controls.target.set(0, 0, 0)
    this.camera.position.set(0, r * 1.45, r * 1.55)
    this.controls.update()
  }

  private refreshSelection(color = VALID) {
    const building = this.selected ? this.model.buildings.get(this.selected) : null
    this.selection.visible = !!building
    if (!building) {
      return
    }
    const { rect, height } = building
    this.selection.scale.set(rect.maxX - rect.minX + 0.2, height + 0.2, rect.maxZ - rect.minZ + 0.2)
    this.selection.position.set((rect.minX + rect.maxX) / 2, height / 2, (rect.minZ + rect.maxZ) / 2)
    ;(this.selection.material as THREE.LineBasicMaterial).color.copy(color)
  }

  private drawGuides() {
    this.boundary?.removeFromParent()
    this.grid?.removeFromParent()
    const r = this.model.radius - 1.5
    const points = Array.from({ length: 129 }, (_, i) => {
      const a = (i / 128) * Math.PI * 2
      return new THREE.Vector3(Math.cos(a) * r, 0.06, Math.sin(a) * r)
    })
    this.boundary = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 1, gapSize: 0.6, transparent: true, opacity: 0.85 }),
    )
    this.boundary.computeLineDistances()
    const size = (this.model.radius + 2) * 2
    this.grid = new THREE.GridHelper(size, size, '#ffffff', '#ffffff')
    const material = this.grid.material as THREE.Material
    material.transparent = true
    material.opacity = 0.12
    material.depthWrite = false
    this.grid.position.set(0.5, 0.04, 0.5)
    this.scene.add(this.boundary, this.grid)
  }

  rotate(slug: string, step = 1) {
    return this.model.rotationFor(slug, step)
  }

  nudge(slug: string, dx: number, dz: number) {
    const placement = this.model.placementOf(slug)
    if (!placement) {
      return { placement: null, problem: null as PlacementProblem }
    }
    const candidate = { ...placement, x: placement.x + dx, z: placement.z + dz }
    return { placement: candidate, problem: this.check(slug, candidate) }
  }

  private setPointer(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
  }

  private groundPoint() {
    const point = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3())
    return point ? new THREE.Vector2(point.x, point.z) : null
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return
    }
    this.setPointer(event)
    const hit = this.raycaster.intersectObjects(this.model.hitboxes, false)[0]
    const slug = (hit?.object.userData.slug as string | undefined) ?? null
    if (!slug) {
      this.pointerDownOnEmpty = { x: event.clientX, y: event.clientY }
      return
    }
    if (this.options.readOnly) {
      this.select(slug)
      return
    }
    const point = this.groundPoint()
    const placement = this.model.placementOf(slug)
    if (!point || !placement) {
      return
    }
    event.stopImmediatePropagation()
    this.controls.enabled = false
    this.renderer.domElement.setPointerCapture(event.pointerId)
    this.renderer.domElement.style.cursor = 'grabbing'
    this.select(slug)
    this.drag = {
      slug,
      offset: point.sub(new THREE.Vector2(placement.x, placement.z)),
      origin: placement,
      current: placement,
      problem: null,
    }
  }

  private pointerDownOnEmpty: { x: number; y: number } | null = null

  private onPointerMove = (event: PointerEvent) => {
    this.setPointer(event)
    if (!this.drag) {
      const hit = this.raycaster.intersectObjects(this.model.hitboxes, false)[0]
      this.renderer.domElement.style.cursor = hit ? (this.options.readOnly ? 'pointer' : 'grab') : ''
      return
    }
    const point = this.groundPoint()
    if (!point) {
      return
    }
    const x = Math.round(point.x - this.drag.offset.x)
    const z = Math.round(point.y - this.drag.offset.y)
    if (x === this.drag.current.x && z === this.drag.current.z) {
      return
    }
    const candidate = { ...this.drag.current, x, z }
    const building = this.model.buildings.get(this.drag.slug)
    if (!building) {
      return
    }
    this.model.place(building, x, z, candidate.quarter)
    this.drag.current = candidate
    this.drag.problem = this.check(this.drag.slug, candidate)
    this.refreshSelection(this.drag.problem ? INVALID : VALID)
    this.callbacks.onDragProblem(this.drag.problem)
  }

  private onPointerUp = (event: PointerEvent) => {
    const drag = this.drag
    if (!drag) {
      const start = this.pointerDownOnEmpty
      this.pointerDownOnEmpty = null
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) {
        this.select(null)
      }
      return
    }
    this.drag = null
    this.controls.enabled = true
    this.renderer.domElement.style.cursor = 'grab'
    const building = this.model.buildings.get(drag.slug)
    if (!building) {
      return
    }
    const moved = drag.current.x !== drag.origin.x || drag.current.z !== drag.origin.z
    if (drag.problem || !moved) {
      this.model.place(building, drag.origin.x, drag.origin.z, drag.origin.quarter)
      this.refreshSelection()
      this.callbacks.onDragProblem(null)
      return
    }
    this.model.rebuildTerrain()
    this.refreshSelection()
    this.callbacks.onDragProblem(null)
    this.callbacks.onCommit(drag.slug, drag.current)
  }

  cancelDrag() {
    if (!this.drag) {
      return
    }
    const building = this.model.buildings.get(this.drag.slug)
    if (building) {
      this.model.place(building, this.drag.origin.x, this.drag.origin.z, this.drag.origin.quarter)
    }
    this.drag = null
    this.controls.enabled = true
    this.refreshSelection()
    this.callbacks.onDragProblem(null)
  }

  private faceNorth() {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const from = Math.atan2(offset.x, offset.z)
    if (Math.abs(from) < 1e-3) {
      return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.turn = { from, to: 0, started: performance.now() - (reduced ? 1000 : 0) }
  }

  private stepTurn() {
    if (!this.turn) {
      return
    }
    const t = Math.min(1, (performance.now() - this.turn.started) / 500)
    const eased = t * t * (3 - 2 * t)
    const offset = this.camera.position.clone().sub(this.controls.target)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    spherical.theta = this.turn.from + (this.turn.to - this.turn.from) * eased
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical))
    if (t >= 1) {
      this.turn = null
    }
  }

  private updateCompass() {
    const target = this.controls.target
    const a = target.clone().project(this.camera)
    const b = target.clone().add(NORTH).project(this.camera)
    const { clientWidth: width, clientHeight: height } = this.container
    const angle = Math.atan2(((b.x - a.x) * width) / 2, ((b.y - a.y) * height) / 2)
    if (Math.abs(angle - this.compassAngle) > 0.002 || Number.isNaN(this.compassAngle)) {
      this.compassAngle = angle
      this.compassRose.style.transform = `rotate(${angle}rad)`
    }
  }

  private loop = () => {
    if (this.disposed) {
      return
    }
    this.frame = requestAnimationFrame(this.loop)
    this.stepTurn()
    this.controls.update()
    this.updateCompass()
    this.model.animateClouds(performance.now() / 1000)
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
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
    this.compass.remove()
  }
}
