import * as THREE from 'three'
import { Player } from './Player'
import type { Avatar } from './avatar'

const HEIGHT = 2
const RECLINE = THREE.MathUtils.degToRad(20)
const FILL = 0.52
const REST_YAW = 0.42
const SWAY = 0.28

const ease = (value: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(value, 0, 1), 3)

export class PageFigure {
  readonly root = new THREE.Group()
  readonly player: Player
  private pivot = new THREE.Group()
  private spin = new THREE.Group()
  private shadow: THREE.Mesh
  private size: number
  private growth = 0
  private yaw = REST_YAW
  private swayTime = 0
  private touched = false
  private shift: number

  constructor(
    anchor: THREE.Object3D,
    private up: THREE.Vector3,
    pageWidth: number,
    pageHeight: number,
    avatar: Avatar,
    { fill = FILL, shift = 0 } = {},
  ) {
    this.size = Math.min((pageHeight * fill) / (HEIGHT * Math.cos(RECLINE)), (pageWidth * 0.8) / 0.82)
    this.shift = shift * pageHeight
    this.player = new Player(avatar, { shadow: false })
    this.spin.add(this.player.root)
    this.pivot.add(this.spin)
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 32),
      new THREE.MeshBasicMaterial({ color: '#3b2a18', transparent: true, opacity: 0.16, depthWrite: false }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.root.add(this.pivot, this.shadow)
    anchor.add(this.root)
    this.setGrowth(0)
  }

  get ready() {
    return this.growth >= 1
  }

  setAvatar(avatar: Avatar) {
    this.player.setAvatar(avatar)
  }

  setGrowth(t: number) {
    this.growth = t
    const grow = ease(t * 1.25)
    const lift = RECLINE * ease((t - 0.2) / 0.8)
    const normal = new THREE.Vector3(0, 1, 0)
    const figureUp = this.up.clone().multiplyScalar(Math.cos(lift)).addScaledVector(normal, Math.sin(lift)).normalize()
    const front = normal.clone().multiplyScalar(Math.cos(lift)).addScaledVector(this.up, -Math.sin(lift)).normalize()
    const right = new THREE.Vector3().crossVectors(figureUp, front)
    this.pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, figureUp, front))
    const scale = this.size * Math.max(0.001, grow)
    this.pivot.scale.setScalar(scale)
    const span = HEIGHT * scale * Math.cos(lift)
    this.pivot.position.copy(this.up).multiplyScalar(this.shift - span / 2).addScaledVector(normal, 0.2 * scale)
    this.shadow.scale.set(0.9 * scale, span * 1.05, 1)
    this.shadow.position.copy(this.up).multiplyScalar(this.shift).setY(0.002)
    this.shadow.rotation.z = Math.atan2(-this.up.x, -this.up.z)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.16 * grow
  }

  rotateBy(delta: number) {
    this.touched = true
    this.yaw += delta
  }

  pick(raycaster: THREE.Raycaster) {
    return raycaster.intersectObject(this.player.root, true).length > 0
  }

  update(dt: number, elapsed: number, still: boolean) {
    if (!this.touched && !still) {
      this.swayTime += dt
    }
    this.spin.rotation.y = this.yaw + (this.touched ? 0 : Math.sin(this.swayTime * 0.7) * SWAY)
    this.player.animate(dt, 0, elapsed, still)
  }

  dispose() {
    this.player.dispose()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    this.root.removeFromParent()
  }
}
