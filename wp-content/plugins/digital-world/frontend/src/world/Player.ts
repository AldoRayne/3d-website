import * as THREE from 'three'
import { texture } from './textures'
import { DEFAULT_AVATAR, sameAvatar, type Avatar } from './avatar'

export const PLAYER_RADIUS = 0.35

const HEAD_Y = 1.6
const HEAD = 0.56
const FRONT = HEAD / 2 + 0.012
const FRAME = '#2b2b2b'

export class Player {
  readonly root = new THREE.Group()
  private body = new THREE.Group()
  private legs: THREE.Group[] = []
  private arms: THREE.Group[] = []
  private owned: Array<THREE.BufferGeometry | THREE.Material> = []
  private stride = 0
  private reachAmount = 0
  private headingValue = 0
  private current: Avatar | null = null

  constructor(avatar: Avatar = DEFAULT_AVATAR, { shadow = true } = {}) {
    this.root.add(this.body)
    if (shadow) {
      const blob = new THREE.Mesh(
        new THREE.CircleGeometry(0.42, 24),
        new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.18, depthWrite: false }),
      )
      blob.rotation.x = -Math.PI / 2
      blob.position.y = 0.02
      this.root.add(blob)
    }
    this.setAvatar(avatar)
  }

  get avatar() {
    return this.current ?? DEFAULT_AVATAR
  }

  setAvatar(avatar: Avatar) {
    if (this.current && sameAvatar(this.current, avatar)) {
      return
    }
    this.current = { ...avatar }
    this.clear()
    this.build(avatar)
  }

  private own<T extends THREE.BufferGeometry | THREE.Material>(item: T) {
    this.owned.push(item)
    return item
  }

  private material(name: string, arg: string) {
    return this.own(new THREE.MeshLambertMaterial({ map: texture(name, arg) }))
  }

  private color(color: string) {
    return this.own(new THREE.MeshLambertMaterial({ color }))
  }

  private part(w: number, h: number, d: number, materials: THREE.Material | THREE.Material[]) {
    const mesh = new THREE.Mesh(this.own(new THREE.BoxGeometry(w, h, d)), materials)
    mesh.castShadow = true
    return mesh
  }

  private clear() {
    this.body.clear()
    this.legs = []
    this.arms = []
    this.owned.forEach((item) => item.dispose())
    this.owned = []
  }

  private build(avatar: Avatar) {
    const { skin: skinColor, hair: hairColor, hairStyle, face, jacket: jacketColor, pants: pantsColor, pack: packColor } = avatar
    const look = `${skinColor}|${hairColor}|${hairStyle}|${face}`
    const skin = this.color(skinColor)
    const jacket = this.material('jacket', jacketColor)
    const sleeve = this.material('sleeve', `${jacketColor}|${skinColor}`)
    const pants = this.material('pants', pantsColor)
    const hair = this.material('hair', `${skinColor}|${hairColor}|${hairStyle}`)
    const hasPack = packColor !== 'none'
    const pack = hasPack ? this.material('pack', packColor) : jacket

    for (const side of [-1, 1]) {
      const hip = new THREE.Group()
      hip.position.set(side * 0.14, 0.62, 0)
      const leg = this.part(0.26, 0.62, 0.28, pants)
      leg.position.y = -0.31
      hip.add(leg)
      this.legs.push(hip)
      this.body.add(hip)
    }

    const torso = this.part(0.58, 0.7, 0.34, [jacket, jacket, jacket, jacket, jacket, pack])
    torso.position.y = 0.97
    this.body.add(torso)
    if (hasPack) {
      const bag = this.part(0.44, 0.5, 0.2, pack)
      bag.position.set(0, 1.0, -0.27)
      this.body.add(bag)
    }

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.41, 1.3, 0)
      const arm = this.part(0.24, 0.68, 0.26, [sleeve, sleeve, jacket, skin, sleeve, sleeve])
      arm.position.y = -0.3
      shoulder.add(arm)
      this.arms.push(shoulder)
      this.body.add(shoulder)
    }

    const head = this.part(HEAD, HEAD, HEAD, [
      this.material('headSide', `${look}|right`),
      this.material('headSide', `${look}|left`),
      hair,
      skin,
      this.material('face', look),
      this.material('headBack', look),
    ])
    head.position.y = HEAD_Y
    this.body.add(head)

    if (hairStyle === 'long') {
      const tail = this.part(0.56, 0.4, 0.08, hair)
      tail.position.set(0, 1.36, -0.31)
      this.body.add(tail)
    }
    if (hairStyle === 'bun' && avatar.hat !== 'beanie') {
      const bun = this.part(0.24, 0.2, 0.22, hair)
      bun.position.set(0, 1.96, -0.16)
      this.body.add(bun)
    }

    this.buildHat(avatar)
    this.buildGlasses(avatar.glasses)
  }

  private buildHat({ hat, jacket }: Avatar) {
    if (hat === 'cap') {
      const cloth = this.material('cloth', jacket)
      const crown = this.part(0.6, 0.16, 0.6, cloth)
      crown.position.y = 1.84
      const visor = this.part(0.52, 0.05, 0.24, cloth)
      visor.position.set(0, 1.78, HEAD / 2 + 0.12)
      this.body.add(crown, visor)
    } else if (hat === 'beanie') {
      const knit = this.material('knit', jacket)
      const cap = this.part(0.62, 0.27, 0.62, knit)
      cap.position.y = 1.8
      const pompom = this.part(0.16, 0.12, 0.16, knit)
      pompom.position.y = 1.99
      this.body.add(cap, pompom)
    }
  }

  private buildGlasses(kind: Avatar['glasses']) {
    if (kind === 'none') {
      return
    }
    const frame = this.color(FRAME)
    const eyeY = HEAD_Y
    const eyeX = 0.1225
    const bar = (w: number, h: number, x: number, y: number, material = frame, d = 0.025) => {
      const mesh = this.part(w, h, d, material)
      mesh.castShadow = false
      mesh.position.set(x, y, FRONT)
      this.body.add(mesh)
    }
    if (kind === 'shades') {
      const lens = this.color('#141a22')
      for (const side of [-1, 1]) {
        bar(0.17, 0.1, side * eyeX, eyeY, lens)
      }
      bar(0.42, 0.025, 0, eyeY + 0.05)
    } else {
      for (const side of [-1, 1]) {
        const x = side * eyeX
        bar(0.15, 0.022, x, eyeY + 0.06)
        bar(0.15, 0.022, x, eyeY - 0.06)
        bar(0.022, 0.12, x - 0.064, eyeY)
        bar(0.022, 0.12, x + 0.064, eyeY)
      }
      bar(0.1, 0.022, 0, eyeY + 0.03)
    }
    for (const side of [-1, 1]) {
      const temple = this.part(0.02, 0.022, 0.3, frame)
      temple.castShadow = false
      temple.position.set(side * (HEAD / 2 + 0.012), eyeY + 0.04, FRONT - 0.15)
      this.body.add(temple)
    }
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

  dispose() {
    this.clear()
    this.root.removeFromParent()
  }
}
