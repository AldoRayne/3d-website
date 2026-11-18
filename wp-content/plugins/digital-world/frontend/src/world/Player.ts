import * as THREE from 'three'
import { texture } from './textures'

export const PLAYER_RADIUS = 0.35

function material(name: string) {
  return new THREE.MeshLambertMaterial({ map: texture(name) })
}

function part(w: number, h: number, d: number, materials: THREE.Material | THREE.Material[]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials)
  mesh.castShadow = true
  return mesh
}

export class Player {
  readonly root = new THREE.Group()
  private body = new THREE.Group()
  private legs: THREE.Group[] = []
  private arms: THREE.Group[] = []
  private stride = 0
  private reachAmount = 0
  private headingValue = 0

  constructor() {
    const skin = new THREE.MeshLambertMaterial({ color: '#efc29a' })
    const jacket = material('jacket')
    const sleeve = material('sleeve')
    const pants = material('pants')
    const hair = material('hair')

    for (const side of [-1, 1]) {
      const hip = new THREE.Group()
      hip.position.set(side * 0.14, 0.62, 0)
      const leg = part(0.26, 0.62, 0.28, pants)
      leg.position.y = -0.31
      hip.add(leg)
      this.legs.push(hip)
      this.body.add(hip)
    }

    const torso = part(0.58, 0.7, 0.34, [jacket, jacket, jacket, jacket, jacket, material('pack')])
    torso.position.y = 0.97
    const pack = part(0.44, 0.5, 0.2, material('pack'))
    pack.position.set(0, 1.0, -0.27)
    this.body.add(torso, pack)

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.41, 1.3, 0)
      const arm = part(0.24, 0.68, 0.26, [sleeve, sleeve, jacket, skin, sleeve, sleeve])
      arm.position.y = -0.3
      shoulder.add(arm)
      this.arms.push(shoulder)
      this.body.add(shoulder)
    }

    const head = part(0.56, 0.56, 0.56, [
      material('headSide'),
      material('headSide'),
      hair,
      skin,
      material('face'),
      material('headBack'),
    ])
    head.position.y = 1.6
    this.body.add(head)

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.18, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02

    this.root.add(this.body, shadow)
  }

  get position() {
    return this.root.position
  }

  get heading() {
    return this.headingValue
  }

  set heading(value: number) {
    this.headingValue = Math.atan2(Math.sin(value), Math.cos(value))
    this.root.rotation.y = this.headingValue
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.headingValue), 0, Math.cos(this.headingValue))
  }

  turnTowards(direction: THREE.Vector3, dt: number, rate = 10) {
    if (direction.lengthSq() < 1e-6) {
      return
    }
    const target = Math.atan2(direction.x, direction.z)
    const delta = Math.atan2(Math.sin(target - this.headingValue), Math.cos(target - this.headingValue))
    this.heading = this.headingValue + delta * Math.min(1, dt * rate)
  }

  reach(amount: number) {
    this.reachAmount = THREE.MathUtils.clamp(amount, 0, 1)
  }

  animate(dt: number, speed: number, elapsed: number, still: boolean) {
    const moving = Math.abs(speed) > 0.05
    if (moving && !still) {
      this.stride += dt * Math.abs(speed) * 2.2
    } else {
      this.stride *= Math.max(0, 1 - dt * 10)
    }
    const swing = Math.sin(this.stride) * (moving ? 0.75 : Math.min(0.75, Math.abs(Math.sin(this.stride))))
    this.legs[0].rotation.x = swing
    this.legs[1].rotation.x = -swing
    this.arms[0].rotation.x = -swing * 0.8
    this.arms[1].rotation.x = THREE.MathUtils.lerp(swing * 0.8, -1.35, this.reachAmount)
    this.arms[1].rotation.z = THREE.MathUtils.lerp(0, -0.15, this.reachAmount)
    const idle = still ? 0 : Math.sin(elapsed * 2) * 0.012
    this.body.position.y = moving && !still ? Math.abs(Math.sin(this.stride)) * 0.05 : idle
  }
}
