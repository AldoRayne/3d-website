import * as THREE from 'three'
import { Book, Lectern } from './book'
import type { Rect } from './navigation'

export const STAND_SLUG = '@stand'
export const STAND_COLOR = '#5eead4'
export const STAND_TITLE = 'Книга гостей'
export const STAND_READER_DISTANCE = 1.6
export const STAND_READ_DISTANCE = 0.95
export const STAND_SPAWN_DISTANCE = 2.4
export const STAND_SPAWN_SIDE = 1
export const STAND_ZONE_DEPTH = 2.4
export const STAND_ZONE_HALF_WIDTH = 1.3

const STAND_ASPECT = 1.5
const HALF_WIDTH = 0.65
const HALF_DEPTH = 0.45

export class GuestStand {
  readonly group = new THREE.Group()
  readonly book: Book
  readonly position = new THREE.Vector3()
  readonly facing = new THREE.Vector3(0, 0, 1)
  readonly reader = new THREE.Vector3()
  readonly mat: THREE.Mesh
  readonly hitbox: THREE.Mesh
  quarter = 0
  rect: Rect = { minX: -HALF_WIDTH, maxX: HALF_WIDTH, minZ: -HALF_DEPTH, maxZ: HALF_DEPTH }
  private lectern: Lectern

  constructor(options: { shadows: boolean; leaf?: boolean }) {
    this.book = new Book({ content: { title: STAND_TITLE, color: STAND_COLOR }, aspect: STAND_ASPECT, blank: true, leaf: options.leaf })
    this.lectern = new Lectern(this.book)
    this.lectern.group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = options.shadows
        node.receiveShadow = options.shadows
      }
    })
    this.mat = new THREE.Mesh(
      new THREE.PlaneGeometry(STAND_ZONE_HALF_WIDTH * 2, STAND_ZONE_DEPTH),
      new THREE.MeshBasicMaterial({ color: STAND_COLOR, transparent: true, opacity: 0.18, depthWrite: false }),
    )
    this.mat.rotation.x = -Math.PI / 2
    this.mat.position.set(0, 0.015, HALF_DEPTH + STAND_ZONE_DEPTH / 2)
    this.hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(HALF_WIDTH * 2 + 0.2, 1.4, HALF_DEPTH * 2 + 0.2),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    )
    this.hitbox.position.y = 0.7
    this.hitbox.userData.slug = STAND_SLUG
    this.group.add(this.lectern.group, this.mat, this.hitbox)
  }

  place(x: number, z: number, quarter: number, facing: THREE.Vector3) {
    this.quarter = ((quarter % 4) + 4) % 4
    this.position.set(x, 0, z)
    this.facing.copy(facing)
    this.reader.copy(this.position).addScaledVector(facing, STAND_READER_DISTANCE)
    this.group.position.copy(this.position)
    this.group.rotation.y = (this.quarter * Math.PI) / 2
    const swap = this.quarter % 2 === 1
    const ex = swap ? HALF_DEPTH : HALF_WIDTH
    const ez = swap ? HALF_WIDTH : HALF_DEPTH
    this.rect = { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez }
    this.group.updateMatrixWorld(true)
  }

  contains(point: THREE.Vector3) {
    const offset = point.clone().sub(this.position)
    const depth = offset.dot(this.facing) - HALF_DEPTH
    const lateral = Math.abs(offset.x * this.facing.z - offset.z * this.facing.x)
    return depth >= 0 && depth <= STAND_ZONE_DEPTH && lateral <= STAND_ZONE_HALF_WIDTH
  }

  setHighlight(active: boolean) {
    ;(this.mat.material as THREE.MeshBasicMaterial).opacity = active ? 0.45 : 0.18
  }

  dispose() {
    this.book.dispose()
    this.lectern.dispose()
    this.mat.geometry.dispose()
    this.hitbox.geometry.dispose()
    ;(this.hitbox.material as THREE.Material).dispose()
    ;(this.mat.material as THREE.Material).dispose()
  }
}
