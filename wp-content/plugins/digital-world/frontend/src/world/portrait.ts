import * as THREE from 'three'
import { Player } from './Player'
import type { Avatar } from './avatar'

export class AvatarPortrait {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  private player: Player
  private timer = new THREE.Timer()
  private frame = 0
  private resizeObserver: ResizeObserver
  private still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(
    private container: HTMLElement,
    avatar: Avatar,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)
    this.scene.add(new THREE.HemisphereLight('#eaf6ff', '#7d6a4c', 1.6))
    const sun = new THREE.DirectionalLight('#fff3d6', 2)
    sun.position.set(3, 5, 4)
    this.scene.add(sun)
    this.player = new Player(avatar)
    this.player.heading = 0.5
    this.scene.add(this.player.root)
    this.camera.position.set(0, 1.3, 5.2)
    this.camera.lookAt(0, 1, 0)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.loop()
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.container
    if (!width || !height) {
      return
    }
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop)
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.1)
    if (!this.still) {
      this.player.heading += dt * 0.6
    }
    this.player.animate(dt, 0, this.timer.getElapsed(), this.still)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.player.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
