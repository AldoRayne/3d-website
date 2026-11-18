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

interface Entry {
  object: WorldObject
  root: THREE.Group
  body: THREE.Group
  model: ProceduralModel
  hitbox: THREE.Mesh
  label: HTMLButtonElement
  ring: THREE.Mesh
  height: number
  baseY: number
  phase: number
}

export interface WorldSceneOptions {
  onSelect: (slug: string | null) => void
  onHover?: (slug: string | null) => void
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

const FLY_DURATION = 1.9

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
  private entries = new Map<string, Entry>()
  private hitboxes: THREE.Mesh[] = []
  private hovered: string | null = null
  private highlighted: string | null = null
  private frame = 0
  private tween: gsap.core.Tween | null = null
  private resizeObserver: ResizeObserver
  private downAt = { x: 0, y: 0 }
  private worldRadius = 24
  private gltfLoader: GLTFLoader | null = null
  private disposed = false

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
    this.camera.position.set(0, 60, 90)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 8
    this.controls.maxDistance = 140
    this.controls.maxPolarAngle = Math.PI * 0.47
    this.controls.target.set(0, 2, 0)

    this.scene.background = new THREE.Color('#05070f')
    this.scene.fog = new THREE.FogExp2('#05070f', 0.0085)

    this.buildEnvironment()
    this.setupPostprocessing(width, height)

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)

    this.loop()
  }

  private get lowPower() {
    return window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600
  }

  private setupPostprocessing(width: number, height: number) {
    if (this.lowPower) {
      return
    }
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.85, 0.45, 0.2))
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

  setObjects(objects: WorldObject[]) {
    for (const entry of this.entries.values()) {
      entry.root.removeFromParent()
      entry.label.remove()
    }
    this.entries.clear()
    this.hitboxes = []

    this.worldRadius = Math.max(
      22,
      ...objects.map((object) => Math.hypot(object.position.x, object.position.z) + 9 * object.scale),
    )
    this.buildIsland(this.worldRadius)
    this.buildPaths(objects)

    objects.forEach((object, index) => {
      const model = createProceduralModel(object.type, object.color)
      const root = new THREE.Group()
      root.position.set(object.position.x, object.position.y, object.position.z)
      root.scale.setScalar(object.scale)
      root.userData.slug = object.slug

      const { group: pad, ring } = createPad(object.color, model.footprint + 0.6)
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
      label.addEventListener('click', () => this.options.onSelect(object.slug))
      label.addEventListener('pointerenter', () => this.setHovered(object.slug))
      label.addEventListener('pointerleave', () => this.setHovered(null))
      const labelObject = new CSS2DObject(label)
      labelObject.position.set(0, model.height + 1.4, 0)
      root.add(labelObject)

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
        height: model.height * object.scale,
        baseY: object.position.y,
        phase: index * 1.3,
      })
    })

    this.applyHighlight()
    this.overview('instant')
    void this.loadModels()
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

  private transitionFor(transition: CameraTransition) {
    return this.options.reducedMotion ? 'instant' : transition
  }

  private moveCamera(position: THREE.Vector3, target: THREE.Vector3, transition: CameraTransition) {
    this.tween?.kill()
    if (this.transitionFor(transition) === 'instant') {
      this.camera.position.copy(position)
      this.controls.target.copy(target)
      this.controls.update()
      return Promise.resolve()
    }

    const startPosition = this.camera.position.clone()
    const startTarget = this.controls.target.clone()
    const lift = Math.max(6, startPosition.distanceTo(position) * 0.35)
    const middle = startPosition.clone().lerp(position, 0.5)
    middle.y += lift
    const state = { t: 0 }
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()

    this.controls.enabled = false
    return new Promise<void>((resolve) => {
      this.tween = gsap.to(state, {
        t: 1,
        duration: FLY_DURATION,
        ease: 'power2.inOut',
        onUpdate: () => {
          a.copy(startPosition).lerp(middle, state.t)
          b.copy(middle).lerp(position, state.t)
          this.camera.position.copy(a.lerp(b, state.t))
          this.controls.target.copy(startTarget).lerp(target, state.t)
        },
        onComplete: () => {
          this.controls.enabled = true
          resolve()
        },
        onInterrupt: () => {
          this.controls.enabled = true
          resolve()
        },
      })
    })
  }

  flyTo(slug: string, transition: CameraTransition = 'fly') {
    const entry = this.entries.get(slug)
    if (!entry) {
      return Promise.resolve()
    }
    const focus = entry.root.position.clone()
    focus.y += entry.height * 0.45

    const outward = new THREE.Vector3(focus.x, 0, focus.z)
    if (outward.lengthSq() < 4) {
      outward.set(this.camera.position.x - focus.x, 0, this.camera.position.z - focus.z)
    }
    if (outward.lengthSq() < 0.01) {
      outward.set(0, 0, 1)
    }
    outward.normalize()

    const portrait = this.camera.aspect < 1
    const distance = Math.max(entry.height * 1.5, 16) / (portrait ? Math.max(this.camera.aspect * 1.1, 0.45) : 1)
    const position = focus
      .clone()
      .addScaledVector(outward, distance)
      .add(new THREE.Vector3(0, entry.height * 0.35 + 4, 0))
    const lookAt = focus.clone()
    if (portrait) {
      lookAt.y -= entry.height * 0.3 + 2
    }

    this.highlight(slug)
    return this.moveCamera(position, lookAt, transition)
  }

  overview(transition: CameraTransition = 'fly') {
    const radius = this.worldRadius
    const halfV = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect)
    const distance = Math.max(radius * 2.2, (radius / Math.tan(halfH)) * 1.3)
    const direction = new THREE.Vector3(0, 0.57, 0.82).normalize()
    this.highlight(null)
    return this.moveCamera(direction.multiplyScalar(distance), new THREE.Vector3(0, 2, 0), transition)
  }

  highlight(slug: string | null) {
    this.highlighted = slug
    this.applyHighlight()
  }

  private setHovered(slug: string | null) {
    if (this.hovered === slug) {
      return
    }
    this.hovered = slug
    this.renderer.domElement.style.cursor = slug ? 'pointer' : ''
    this.applyHighlight()
    this.options.onHover?.(slug)
  }

  private applyHighlight() {
    for (const [slug, entry] of this.entries) {
      const active = slug === this.highlighted || slug === this.hovered
      entry.label.classList.toggle('is-active', active)
      const ringMaterial = entry.ring.material as THREE.MeshBasicMaterial
      ringMaterial.opacity = active ? 1 : 0.5
      for (const material of entry.model.glowMaterials) {
        material.userData.boost = active ? 1.6 : 1
      }
    }
  }

  private pick(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.hitboxes, false)[0]
    return (hit?.object.userData.slug as string | undefined) ?? null
  }

  private onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') {
      this.setHovered(this.pick(event))
    }
  }

  private onPointerDown = (event: PointerEvent) => {
    this.downAt = { x: event.clientX, y: event.clientY }
  }

  private onPointerUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y) > 6) {
      return
    }
    const slug = this.pick(event)
    if (slug) {
      this.options.onSelect(slug)
    }
  }

  private onPointerLeave = () => this.setHovered(null)

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
    } else if (!this.frame && !this.disposed) {
      this.clock.getDelta()
      this.loop()
    }
  }

  private animate(elapsed: number) {
    const still = this.options.reducedMotion
    for (const entry of this.entries.values()) {
      const pulse = entry.object.animation === 'pulse' && !still ? 0.75 + Math.sin(elapsed * 2 + entry.phase) * 0.35 : 1
      for (const material of entry.model.glowMaterials) {
        material.userData.base ??= material.emissiveIntensity
        material.emissiveIntensity = (material.userData.base as number) * pulse * ((material.userData.boost as number) ?? 1)
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
        spinner.rotation.y += 0.004
      }
      for (const floater of entry.model.floaters) {
        floater.userData.baseY ??= floater.position.y
        floater.position.y = (floater.userData.baseY as number) + Math.sin(elapsed * 1.6 + entry.phase) * 0.25
      }
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
    this.animate(this.clock.getElapsedTime())
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
    this.tween?.kill()
    this.resizeObserver.disconnect()
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
