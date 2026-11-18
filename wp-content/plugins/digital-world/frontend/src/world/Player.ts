import * as THREE from 'three'

const ACCENT = new THREE.Color('#5eead4')

export const PLAYER_RADIUS = 0.55

export class Player {
  readonly root = new THREE.Group()
  private body = new THREE.Group()
  private legs: THREE.Mesh[] = []
  private arms: THREE.Mesh[] = []
  private halo: THREE.Mesh
  private visor: THREE.MeshStandardMaterial
  private stride = 0
  private heading = 0

  constructor() {
    const shell = new THREE.MeshStandardMaterial({ color: '#dbe7ff', roughness: 0.35, metalness: 0.25 })
    const dark = new THREE.MeshStandardMaterial({ color: '#33476f', roughness: 0.55, metalness: 0.35 })
    this.visor = new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 2.2 })

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 6, 16), shell)
    torso.position.y = 1.25
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.05, 8, 32), this.visor)
    belt.rotation.x = Math.PI / 2
    belt.position.y = 1.02

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 16), shell)
    head.position.y = 2.15
    const visor = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.36, 4, 12), this.visor)
    visor.rotation.z = Math.PI / 2
    visor.position.set(0, 2.18, 0.31)

    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.22), dark)
    pack.position.set(0, 1.35, -0.42)
    const antenna = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), this.visor)
    antenna.position.set(0.18, 1.72, -0.48)

    this.body.add(torso, belt, head, visor, pack, antenna)

    const legGeometry = new THREE.CapsuleGeometry(0.13, 0.42, 4, 10)
    legGeometry.translate(0, -0.34, 0)
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeometry, dark)
      leg.position.set(side * 0.2, 0.78, 0)
      this.legs.push(leg)
      this.body.add(leg)
    }

    const armGeometry = new THREE.CapsuleGeometry(0.1, 0.4, 4, 10)
    armGeometry.translate(0, -0.3, 0)
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeometry, shell)
      arm.position.set(side * 0.52, 1.55, 0)
      arm.rotation.z = side * 0.12
      this.arms.push(arm)
      this.body.add(arm)
    }

    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 40),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    )
    this.halo.rotation.x = -Math.PI / 2
    this.halo.position.y = 0.03

    this.root.add(this.body, this.halo)
  }

  get position() {
    return this.root.position
  }

  faceTowards(direction: THREE.Vector3, dt: number) {
    if (direction.lengthSq() < 1e-6) {
      return
    }
    const target = Math.atan2(direction.x, direction.z)
    let delta = target - this.heading
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    this.heading += delta * Math.min(1, dt * 12)
    this.root.rotation.y = this.heading
  }

  animate(dt: number, speed: number, elapsed: number, still: boolean) {
    const moving = speed > 0.05
    if (moving && !still) {
      this.stride += dt * speed * 1.9
    } else {
      this.stride *= Math.max(0, 1 - dt * 10)
    }
    const swing = Math.sin(this.stride) * (moving ? 0.6 : 0)
    this.legs[0].rotation.x = swing
    this.legs[1].rotation.x = -swing
    this.arms[0].rotation.x = -swing * 0.8
    this.arms[1].rotation.x = swing * 0.8
    this.body.position.y = still ? 0 : moving ? Math.abs(Math.sin(this.stride)) * 0.08 : Math.sin(elapsed * 2) * 0.03
    this.body.rotation.x = moving ? 0.08 : 0
    const haloMaterial = this.halo.material as THREE.MeshBasicMaterial
    haloMaterial.opacity = still ? 0.6 : 0.45 + Math.sin(elapsed * 3) * 0.15
  }
}
