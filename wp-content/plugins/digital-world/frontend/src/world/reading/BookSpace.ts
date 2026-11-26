import * as THREE from 'three'
import gsap from 'gsap'
import { isEditableTarget } from '../dom'
import type { Sculpture } from './sculpt'

const SPACE = new THREE.Color('#ece3d0')
const SPEED = 4
const LOOK = 0.005
const MARGIN = 8
const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyE', 'Space'],
  down: ['KeyQ', 'KeyC'],
}
const ALL_KEYS = new Set([...Object.values(KEYS).flat(), 'ShiftLeft', 'ShiftRight'])

export interface BookSpaceOptions {
  container: HTMLElement
  canvas: HTMLCanvasElement
  camera: THREE.PerspectiveCamera
  reducedMotion: boolean
  onLink: (href: string) => void
}

interface Pointer {
  id: number
  x: number
  y: number
  startX: number
  startY: number
  moved: boolean
  stick: boolean
}

export class BookSpace {
  readonly scene = new THREE.Scene()
  private sculpture: Sculpture | null = null
  private dust: THREE.Points
  private dustMaterial: THREE.PointsMaterial
  private fog = new THREE.Fog(SPACE, 1000, 2000)
  private yaw = 0
  private pitch = 0
  private velocity = new THREE.Vector3()
  private keys = new Set<string>()
  private pointers = new Map<number, Pointer>()
  private stick = new THREE.Vector2()
  private stickRing: HTMLDivElement
  private flying = false
  private attached = false
  private timeline: gsap.core.Timeline | null = null
  private raycaster = new THREE.Raycaster()

  constructor(private options: BookSpaceOptions) {
    this.scene.background = SPACE.clone()
    this.scene.fog = this.fog
    this.scene.add(new THREE.HemisphereLight('#fffaf0', '#b9a98a', 1.7))
    const sun = new THREE.DirectionalLight('#fff4e0', 1.7)
    sun.position.set(-4, 7, 10)
    this.scene.add(sun)

    const positions = new Float32Array(600 * 3)
    for (let i = 0; i < positions.length; i++) {
      positions[i] = Math.random() - 0.5
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.dustMaterial = new THREE.PointsMaterial({ color: '#8f7b5a', size: 0.045, transparent: true, opacity: 0, depthWrite: false })
    this.dust = new THREE.Points(geometry, this.dustMaterial)
    this.scene.add(this.dust)

    this.stickRing = document.createElement('div')
    this.stickRing.className = 'dw-stick'
    options.container.appendChild(this.stickRing)
  }

  get page() {
    return this.sculpture
  }

  private fillDistance(sculpture: Sculpture) {
    return sculpture.viewHeight / 2 / Math.tan(THREE.MathUtils.degToRad(this.options.camera.fov) / 2)
  }

  private placeDust(sculpture: Sculpture) {
    const size = sculpture.bounds.getSize(new THREE.Vector3())
    const center = sculpture.bounds.getCenter(new THREE.Vector3())
    this.dust.scale.set(size.x + MARGIN * 2, size.y + MARGIN * 2, MARGIN * 2.5)
    this.dust.position.set(center.x, center.y, MARGIN * 0.6)
  }

  private syncLook() {
    const camera = this.options.camera
    camera.rotation.order = 'YXZ'
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    this.yaw = euler.y
    this.pitch = euler.x
  }

  get moving() {
    return Boolean(this.timeline?.isActive())
  }

  private play(timeline: gsap.core.Timeline) {
    this.timeline?.kill()
    this.timeline = timeline
    return new Promise<void>((resolve) => timeline.eventCallback('onComplete', () => resolve()))
  }

  show(sculpture: Sculpture, from: 'book' | 'fade') {
    this.sculpture?.dispose()
    this.sculpture = sculpture
    this.scene.add(sculpture.group)
    this.placeDust(sculpture)
    this.attach()
    this.flying = false
    const camera = this.options.camera
    const distance = this.fillDistance(sculpture)
    camera.position.set(0, 0, distance)
    camera.rotation.set(0, 0, 0, 'YXZ')
    const background = this.scene.background as THREE.Color
    background.copy(from === 'book' ? sculpture.background : SPACE)
    this.fog.color.copy(background)
    const state = { rise: 0, mood: from === 'book' ? 0 : 1, move: 0 }
    const end = new THREE.Vector3(-distance * 0.32, distance * 0.08, distance * 1.12)
    const look = new THREE.Vector3(0, -distance * 0.05, 0)
    const start = camera.position.clone()
    const apply = () => {
      sculpture.setRise(state.rise)
      background.copy(sculpture.background).lerp(SPACE, state.mood)
      this.fog.color.copy(background)
      this.fog.near = THREE.MathUtils.lerp(400, distance * 1.3, state.mood)
      this.fog.far = THREE.MathUtils.lerp(800, distance * 7, state.mood)
      this.dustMaterial.opacity = 0.55 * state.mood
      camera.position.lerpVectors(start, end, state.move)
      camera.lookAt(new THREE.Vector3(0, 0, 0).lerp(look, state.move))
    }
    apply()
    const duration = this.options.reducedMotion ? 0.01 : 1
    const tl = gsap.timeline({ onUpdate: apply })
    tl.to(state, { rise: 1, duration: 1.4 * duration, ease: 'power2.out' }, 0)
    tl.to(state, { mood: 1, duration: 1.6 * duration, ease: 'sine.inOut' }, 0.2 * duration)
    tl.to(state, { move: 1, duration: 1.8 * duration, ease: 'power2.inOut' }, 0.3 * duration)
    return this.play(tl).then(() => {
      this.syncLook()
      this.flying = true
    })
  }

  swap(next: Sculpture) {
    const current = this.sculpture
    if (!current) {
      return this.show(next, 'fade')
    }
    this.flying = false
    const state = { rise: 1 }
    const tl = gsap.timeline()
    tl.to(state, { rise: 0, duration: this.options.reducedMotion ? 0.01 : 0.5, ease: 'power2.in', onUpdate: () => current.setRise(state.rise) })
    return this.play(tl).then(() => this.show(next, 'fade'))
  }

  flyTo(target: THREE.Vector3, look: THREE.Vector3) {
    this.flying = false
    const camera = this.options.camera
    const from = camera.position.clone()
    const fromLook = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()))
    const state = { t: 0 }
    const tl = gsap.timeline()
    tl.to(state, {
      t: 1,
      duration: this.options.reducedMotion ? 0.01 : 0.9,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.position.lerpVectors(from, target, state.t)
        camera.lookAt(fromLook.clone().lerp(look, state.t))
      },
    })
    return this.play(tl).then(() => {
      this.syncLook()
      this.flying = true
    })
  }

  readHere() {
    const sculpture = this.sculpture
    if (!sculpture) {
      return
    }
    const y = THREE.MathUtils.clamp(this.options.camera.position.y, sculpture.bounds.min.y, sculpture.bounds.max.y)
    void this.flyTo(new THREE.Vector3(0, y, this.fillDistance(sculpture) * 1.05), new THREE.Vector3(0, y, 0))
  }

  flyToTop() {
    const sculpture = this.sculpture
    if (sculpture) {
      void this.flyTo(new THREE.Vector3(0, 0, this.fillDistance(sculpture) * 1.05), new THREE.Vector3(0, 0, 0))
    }
  }

  flyToAnchor(id: string) {
    const y = this.sculpture?.anchors.get(id)
    if (y !== undefined) {
      this.flyToY(y)
    }
  }

  flyToY(y: number) {
    const sculpture = this.sculpture
    if (!sculpture) {
      return false
    }
    const distance = this.fillDistance(sculpture)
    const target = y - sculpture.viewHeight * 0.3
    void this.flyTo(new THREE.Vector3(0, target, distance), new THREE.Vector3(0, target, 0))
    return true
  }

  text(scope: 'screen' | 'rest', limit: number) {
    const sculpture = this.sculpture
    if (!sculpture) {
      return ''
    }
    const center = this.options.camera.position.y
    const top = center + sculpture.viewHeight * 0.55
    const bottom = center - sculpture.viewHeight * 0.5
    let text = ''
    for (const block of sculpture.paragraphs) {
      if (block.y > top || (scope === 'screen' && block.y < bottom)) {
        continue
      }
      if (text.length + block.text.length > limit) {
        if (!text) {
          const cut = block.text.slice(0, limit)
          text = cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))) || cut
        }
        break
      }
      text += `${text ? '\n' : ''}${block.text}`
    }
    return text
  }

  readStep(direction: 1 | -1) {
    const sculpture = this.sculpture
    if (!sculpture) {
      return null
    }
    const camera = this.options.camera
    const top = 0
    const bottom = Math.min(0, sculpture.bounds.min.y + sculpture.viewHeight * 0.4)
    const y = THREE.MathUtils.clamp(camera.position.y - direction * sculpture.viewHeight * 0.8, bottom, top)
    if (Math.abs(y - camera.position.y) < 0.01) {
      return false
    }
    void this.flyTo(new THREE.Vector3(0, y, this.fillDistance(sculpture) * 1.05), new THREE.Vector3(0, y, 0))
    return true
  }

  flyToBottom() {
    const sculpture = this.sculpture
    if (!sculpture) {
      return false
    }
    const y = Math.min(0, sculpture.bounds.min.y + sculpture.viewHeight * 0.4)
    void this.flyTo(new THREE.Vector3(0, y, this.fillDistance(sculpture) * 1.05), new THREE.Vector3(0, y, 0))
    return true
  }

  update(dt: number, elapsed: number) {
    this.dust.rotation.y = Math.sin(elapsed * 0.05) * 0.02
    this.dust.position.y += Math.sin(elapsed * 0.3) * 0.0008
    if (!this.flying || !this.sculpture) {
      return
    }
    const camera = this.options.camera
    const pressed = (codes: string[]) => codes.some((code) => this.keys.has(code))
    const forward = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const want = new THREE.Vector3()
    want.addScaledVector(forward, (pressed(KEYS.forward) ? 1 : 0) - (pressed(KEYS.back) ? 1 : 0) - this.stick.y)
    want.addScaledVector(right, (pressed(KEYS.right) ? 1 : 0) - (pressed(KEYS.left) ? 1 : 0) + this.stick.x)
    want.y += (pressed(KEYS.up) ? 1 : 0) - (pressed(KEYS.down) ? 1 : 0)
    if (want.lengthSq() > 1) {
      want.normalize()
    }
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.5 : 1
    want.multiplyScalar(SPEED * boost)
    this.velocity.lerp(want, 1 - Math.exp(-dt * 6))
    camera.position.addScaledVector(this.velocity, dt)
    const box = this.sculpture.bounds
    camera.position.set(
      THREE.MathUtils.clamp(camera.position.x, box.min.x - MARGIN, box.max.x + MARGIN),
      THREE.MathUtils.clamp(camera.position.y, box.min.y - MARGIN, box.max.y + MARGIN),
      THREE.MathUtils.clamp(camera.position.z, box.min.z - MARGIN, box.max.z + MARGIN * 2),
    )
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
  }

  private attach() {
    if (this.attached) {
      return
    }
    this.attached = true
    const canvas = this.options.canvas
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  detach() {
    if (!this.attached) {
      return
    }
    this.attached = false
    const canvas = this.options.canvas
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointercancel', this.onPointerUp)
    canvas.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.keys.clear()
    this.pointers.clear()
    this.stick.set(0, 0)
    this.stickRing.classList.remove('is-active')
    canvas.style.cursor = ''
  }

  private linkAt(clientX: number, clientY: number) {
    const sculpture = this.sculpture
    if (!sculpture) {
      return null
    }
    const rect = this.options.canvas.getBoundingClientRect()
    this.raycaster.setFromCamera(
      new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1),
      this.options.camera,
    )
    let best: { href: string; distance: number } | null = null
    const hit = new THREE.Vector3()
    for (const link of sculpture.links) {
      if (this.raycaster.ray.intersectBox(link.box, hit)) {
        const distance = hit.distanceTo(this.raycaster.ray.origin)
        if (!best || distance < best.distance) {
          best = { href: link.href, distance }
        }
      }
    }
    return best?.href ?? null
  }

  private onPointerDown = (event: PointerEvent) => {
    const stick = event.pointerType !== 'mouse' && event.clientX < window.innerWidth / 2
    this.pointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, stick })
    this.options.canvas.setPointerCapture(event.pointerId)
    if (stick) {
      Object.assign(this.stickRing.style, { left: `${event.clientX}px`, top: `${event.clientY}px` })
      this.stickRing.classList.add('is-active')
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId)
    if (!pointer) {
      if (event.pointerType === 'mouse') {
        this.options.canvas.style.cursor = this.flying && this.linkAt(event.clientX, event.clientY) ? 'pointer' : ''
      }
      return
    }
    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 6) {
      pointer.moved = true
    }
    if (pointer.stick) {
      const dx = (event.clientX - pointer.startX) / 60
      const dy = (event.clientY - pointer.startY) / 60
      this.stick.set(dx, dy)
      if (this.stick.length() > 1) {
        this.stick.normalize()
      }
    } else if (this.flying) {
      this.yaw -= (event.clientX - pointer.x) * LOOK
      this.pitch = THREE.MathUtils.clamp(this.pitch - (event.clientY - pointer.y) * LOOK, -1.45, 1.45)
    }
    pointer.x = event.clientX
    pointer.y = event.clientY
  }

  private onPointerUp = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId)
    if (!pointer) {
      return
    }
    this.pointers.delete(event.pointerId)
    if (pointer.stick) {
      this.stick.set(0, 0)
      this.stickRing.classList.remove('is-active')
    }
    if (!pointer.moved && event.type === 'pointerup' && this.flying) {
      const href = this.linkAt(event.clientX, event.clientY)
      if (href) {
        this.options.onLink(href)
      }
    }
  }

  private onWheel = (event: WheelEvent) => {
    event.preventDefault()
    if (!this.flying) {
      return
    }
    const forward = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
    this.velocity.addScaledVector(forward, -event.deltaY * 0.02)
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!ALL_KEYS.has(event.code) || isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }
    event.preventDefault()
    this.keys.add(event.code)
  }

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code)
  }

  private onBlur = () => this.keys.clear()

  clear() {
    this.timeline?.kill()
    this.timeline = null
    this.flying = false
    this.detach()
    this.sculpture?.dispose()
    this.sculpture = null
    this.options.camera.rotation.order = 'XYZ'
  }

  dispose() {
    this.clear()
    this.stickRing.remove()
    this.dust.geometry.dispose()
    this.dustMaterial.dispose()
  }
}
