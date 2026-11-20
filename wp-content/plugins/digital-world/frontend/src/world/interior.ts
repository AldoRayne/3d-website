import * as THREE from 'three'
import type { WorldObject } from '@/types'
import { Book, Lectern } from './book'
import { generateBuilding, seededRandom, specFromSeed } from './buildings'
import { texture } from './textures'
import { VoxelGrid } from './voxels'

const ROOM_HEIGHT = 5
const SCALE = 2

type Disposable = { dispose(): void }

export class Interior {
  readonly scene = new THREE.Scene()
  readonly entry: THREE.Vector3
  readonly stand: THREE.Vector3
  readonly doorway: THREE.Vector3
  readonly backWall: number
  readonly book: Book
  private lectern: Lectern
  private owned: Disposable[] = []

  constructor(object: WorldObject, aspect: number, element: HTMLElement, pixelHeight: number) {
    const spec = specFromSeed(object.seed)
    const plan = generateBuilding(object.seed, object.color)
    const outside = new Map(plan.cells.map(([x, y, z, id]) => [`${x},${y},${z}`, id]))
    const rnd = seededRandom((object.seed ^ 0x5bd1e995) >>> 0)
    const pick = <T>(items: readonly T[]) => items[Math.floor(rnd() * items.length)]
    const groundHeight = Math.max(spec.floorHeight, 3)
    const wallX = spec.halfX * SCALE
    const wallZ = spec.halfZ * SCALE
    const hw = wallX - 1
    const dz = wallZ - 1
    const floor = pick(['planks', 'planks', 'stoneBrick', 'stone'])
    const lecternZ = -dz + 1.6
    const accent = `accent:${object.color}`

    const toOutside = (i: number) => Math.sign(i) * Math.floor((Math.abs(i) + 1) / SCALE)
    const rowOutside = (y: number) => Math.min(groundHeight - 1, Math.floor((y * groundHeight) / ROOM_HEIGHT))
    const wallBlock = (x: number, y: number, z: number) =>
      outside.get(`${toOutside(x)},${rowOutside(y)},${toOutside(z)}`) ?? spec.wall

    const radius = Math.max(wallX, wallZ) + 1
    const level = (x: number, z: number) => {
      if (spec.floors > 1) {
        return 0
      }
      switch (spec.roof) {
        case 'gable':
          return Math.floor((wallZ - Math.abs(z)) / SCALE)
        case 'pyramid':
          return Math.floor(Math.min(wallX - Math.abs(x), wallZ - Math.abs(z)) / SCALE)
        case 'dome':
          return Math.floor(Math.sqrt(Math.max(0, radius * radius - x * x - z * z)) / SCALE)
        default:
          return 0
      }
    }
    const ceilingBlock = (height: number) => {
      if (spec.floors > 1) {
        return 'planks'
      }
      switch (spec.roof) {
        case 'flat':
          return spec.wall
        case 'battlement':
          return 'stoneBrick'
        case 'dome':
          return height % 2 ? 'glass' : accent
        default:
          return `roof:${object.color}`
      }
    }

    this.scene.background = new THREE.Color('#9dd4f7')
    this.scene.add(new THREE.HemisphereLight('#fff1dc', '#5a4632', 1.5))
    const fill = new THREE.DirectionalLight('#fff4e0', 0.9)
    fill.position.set(2, 6, 8)
    this.scene.add(fill)

    const grid = new VoxelGrid()
    const isWall = (x: number, z: number) => Math.abs(x) === wallX || Math.abs(z) === wallZ
    for (let x = -wallX; x <= wallX; x++) {
      for (let z = -wallZ; z <= wallZ; z++) {
        grid.set(x, -1, z, floor)
        const own = level(x, z)
        const top = Math.max(
          own,
          ...[
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].map(([dx, dzz]) => (Math.abs(x + dx) <= wallX && Math.abs(z + dzz) <= wallZ ? level(x + dx, z + dzz) : own)),
        )
        for (let h = own; h <= top; h++) {
          grid.set(x, ROOM_HEIGHT + h, z, ceilingBlock(h))
        }
        if (isWall(x, z)) {
          for (let y = 0; y < ROOM_HEIGHT + own; y++) {
            grid.set(x, y, z, y < ROOM_HEIGHT ? wallBlock(x, y, z) : spec.wall)
          }
        }
      }
    }
    grid.delete(0, 0, wallZ)
    grid.delete(0, 1, wallZ)

    const stairsSide = spec.floors > 1 ? pick([-1, 1]) : 0
    if (stairsSide) {
      const x = stairsSide * hw
      for (let k = 0; k < ROOM_HEIGHT; k++) {
        const z = dz - 1 - k
        for (let y = 0; y <= k; y++) {
          grid.set(x, y, z, 'planks')
        }
        if (k >= ROOM_HEIGHT - 2) {
          grid.delete(x, ROOM_HEIGHT, z)
          grid.set(x, ROOM_HEIGHT + 1, z, 'planks')
        }
      }
    }

    const fireplace = spec.extra === 'chimney' ? Math.min(hw - 1, wallX - 2) : null
    if (fireplace !== null) {
      for (let x = fireplace - 1; x <= fireplace + 1; x++) {
        for (let y = 0; y < 3; y++) {
          grid.set(x, y, -dz, 'stoneBrick')
        }
      }
      for (let y = 3; y < ROOM_HEIGHT; y++) {
        grid.set(fireplace, y, -dz, 'stoneBrick')
      }
      grid.delete(fireplace, 0, -dz)
      const fire = new THREE.Mesh(
        this.own(new THREE.BoxGeometry(0.6, 0.45, 0.4)),
        this.own(new THREE.MeshBasicMaterial({ color: '#ff9a3c' })),
      )
      fire.position.set(fireplace, 0.25, -dz - 0.05)
      const flame = new THREE.PointLight('#ff8a3c', 6, 8, 1.6)
      flame.position.set(fireplace, 0.8, -dz + 0.8)
      this.scene.add(fire, flame)
    }

    for (const side of [-1, 1]) {
      const glassAt = (x: number, y: number, z: number) => grid.get(x, y, z) === 'glass'
      for (const z of [-1, 0, -2, 1]) {
        if (!glassAt(side * wallX, 3, z) && !(stairsSide === side && z > dz - 1 - ROOM_HEIGHT)) {
          grid.set(side * wallX, 3, z, 'lamp')
          break
        }
      }
      if (fireplace === null || Math.sign(fireplace) !== side) {
        for (let x = 2; x <= hw; x++) {
          const rows = [0, 1, 2, 3].some((y) => glassAt(side * x, y, -wallZ)) ? 2 : 3
          for (let y = 0; y < rows; y++) {
            grid.set(side * x, y, -dz, 'shelf')
          }
        }
      }
      if (stairsSide === side) {
        continue
      }
      const furnish = pick(['shelves', 'barrels', 'plants', 'crates'])
      for (const z of [-dz + 2, dz - 2]) {
        const x = side * hw
        if (furnish === 'shelves') {
          grid.set(x, 0, z, 'shelf')
          grid.set(x, 1, z, 'shelf')
        } else if (furnish === 'barrels') {
          grid.set(x, 0, z, 'log')
        } else if (furnish === 'plants') {
          grid.set(x, 0, z, 'planks')
          grid.set(x, 1, z, 'leaves')
        } else {
          grid.set(x, 0, z, 'planks')
          grid.set(x, 1, z, 'planks')
        }
      }
    }
    const lampY = ROOM_HEIGHT - 1 + level(0, -dz + 1)
    grid.set(0, lampY, -dz + 1, 'lamp')
    this.scene.add(grid.build({ shadows: false }))

    for (const [x, y, z, intensity] of [
      [0, lampY - 0.4, lecternZ + 0.4, 9],
      [-hw + 0.2, 3.5, -1, 5],
      [hw - 0.2, 3.5, -1, 5],
    ]) {
      const light = new THREE.PointLight('#ffcf8a', intensity, 14, 1.6)
      light.position.set(x, y, z)
      this.scene.add(light)
    }

    const glow = new THREE.Mesh(
      this.own(new THREE.PlaneGeometry(1, 2)),
      this.own(new THREE.MeshBasicMaterial({ color: '#fff4cf', fog: false })),
    )
    glow.position.set(0, 1, wallZ + 0.45)
    glow.rotation.y = Math.PI
    this.scene.add(glow)

    const pivot = new THREE.Group()
    pivot.position.set(-0.5, 0, wallZ - 0.57)
    pivot.rotation.y = 1.75
    const plank = this.own(new THREE.MeshLambertMaterial({ map: texture('door') }))
    for (const [y, name] of [
      [0.5, 'doorBottom'],
      [1.5, 'doorTop'],
    ] as const) {
      const side = this.own(new THREE.MeshLambertMaterial({ map: texture(name) }))
      const leaf = new THREE.Mesh(this.own(new THREE.BoxGeometry(0.98, 1, 0.12)), [plank, plank, plank, plank, side, side])
      leaf.position.set(0.5, y, 0)
      pivot.add(leaf)
    }
    this.scene.add(pivot)

    const carpetLength = wallZ - 0.5 - (lecternZ - 0.4)
    const carpetTexture = this.own(texture('accent', object.color).clone())
    carpetTexture.wrapS = THREE.RepeatWrapping
    carpetTexture.wrapT = THREE.RepeatWrapping
    carpetTexture.repeat.set(2, Math.round(carpetLength))
    carpetTexture.needsUpdate = true
    const carpet = new THREE.Mesh(
      this.own(new THREE.PlaneGeometry(2, carpetLength)),
      this.own(new THREE.MeshLambertMaterial({ map: carpetTexture })),
    )
    carpet.rotation.x = -Math.PI / 2
    carpet.position.set(0, 0.012, wallZ - 0.5 - carpetLength / 2)
    this.scene.add(carpet)

    this.book = new Book({ content: object, aspect, live: { element, pixelHeight } })
    this.lectern = new Lectern(this.book)
    this.lectern.group.position.set(0, 0, lecternZ)
    this.scene.add(this.lectern.group)
    this.scene.updateMatrixWorld(true)

    this.entry = new THREE.Vector3(0, 0, wallZ - 1.1)
    this.stand = new THREE.Vector3(0, 0, lecternZ + 0.95)
    this.doorway = new THREE.Vector3(0, 1.45, wallZ + 0.2)
    this.backWall = wallZ - 0.7
  }

  private own<T extends Disposable>(item: T) {
    this.owned.push(item)
    return item
  }

  dispose() {
    this.book.dispose()
    this.lectern.dispose()
    this.scene.traverse((node) => (node as THREE.Mesh).geometry?.dispose())
    this.owned.forEach((item) => item.dispose())
  }
}
