import * as THREE from 'three'
import type { WorldObject } from '@/types'
import { checkPlacement, WorldModel, type Placement, type PlacementProblem } from './WorldModel'

const VALID = new THREE.Color('#0f766e')
const INVALID = new THREE.Color('#dc2626')
const FILL = 0.9
const STAGGER = 0.35

interface Drag {
  slug: string
  offset: THREE.Vector2
  origin: Placement
  current: Placement
  problem: PlacementProblem
}

export class MiniIsland {
  readonly root = new THREE.Group()
  readonly model = new WorldModel({ shadows: false, clouds: false, underground: false })
  selected: string | null = null
  private scale = 1
  private growth = 0
  private drag: Drag | null = null
  private selection: THREE.LineSegments
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  constructor(
    anchor: THREE.Object3D,
    private pageWidth: number,
    private pageHeight: number,
  ) {
    this.selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: VALID, depthTest: false, transparent: true }),
    )
    this.selection.renderOrder = 10
    this.selection.visible = false
    this.root.add(this.model.root, this.selection)
    anchor.add(this.root)
  }

  setWorld(objects: WorldObject[], radius: number) {
    this.model.setWorld(objects, radius)
    this.scale = (Math.min(this.pageWidth, this.pageHeight) * FILL) / (2 * (this.model.radius + 1))
    this.select(this.selected)
    this.setGrowth(this.growth)
  }

  get placements() {
    return new Map([...this.model.buildings.keys()].map((slug) => [slug, this.model.placementOf(slug) as Placement]))
  }

  get dragging() {
    return this.drag !== null
  }

  setGrowth(t: number) {
    this.growth = t
    const ease = (value: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(value, 0, 1), 3)
    this.root.scale.set(this.scale, this.scale * Math.max(0.001, ease(t * 1.6)), this.scale)
    const slugs = [...this.model.buildings.keys()]
    slugs.forEach((slug, index) => {
      const delay = slugs.length > 1 ? (index / (slugs.length - 1)) * STAGGER : 0
      const local = ease((t - delay) / (1 - STAGGER))
      this.model.buildings.get(slug)?.frame.scale.set(1, Math.max(0.001, local), 1)
    })
    this.selection.visible = t >= 1 && this.selected !== null
  }

  pick(raycaster: THREE.Raycaster) {
    const hit = raycaster.intersectObjects(this.model.hitboxes, false)[0]
    return (hit?.object.userData.slug as string | undefined) ?? null
  }

  groundPoint(raycaster: THREE.Raycaster) {
    this.root.updateMatrixWorld()
    const ray = raycaster.ray.clone().applyMatrix4(this.root.matrixWorld.clone().invert())
    const point = ray.intersectPlane(this.plane, new THREE.Vector3())
    return point ? new THREE.Vector2(point.x, point.z) : null
  }

  select(slug: string | null) {
    this.selected = slug && this.model.buildings.has(slug) ? slug : null
    this.refreshSelection()
  }

  beginDrag(slug: string, point: THREE.Vector2) {
    const placement = this.model.placementOf(slug)
    if (!placement) {
      return false
    }
    this.select(slug)
    this.drag = { slug, offset: point.clone().sub(new THREE.Vector2(placement.x, placement.z)), origin: placement, current: placement, problem: null }
    return true
  }

  moveDrag(point: THREE.Vector2) {
    const drag = this.drag
    const building = drag && this.model.buildings.get(drag.slug)
    if (!drag || !building) {
      return null
    }
    const x = Math.round(point.x - drag.offset.x)
    const z = Math.round(point.y - drag.offset.y)
    if (x !== drag.current.x || z !== drag.current.z) {
      drag.current = { ...drag.current, x, z }
      this.model.place(building, x, z, drag.current.quarter)
      drag.problem = checkPlacement(drag.current, this.model.othersThan(drag.slug), this.model.radius)
      this.refreshSelection()
    }
    return drag.problem
  }

  endDrag() {
    const drag = this.drag
    this.drag = null
    const building = drag && this.model.buildings.get(drag.slug)
    if (!drag || !building) {
      return false
    }
    const moved = drag.current.x !== drag.origin.x || drag.current.z !== drag.origin.z
    if (drag.problem || !moved) {
      this.model.place(building, drag.origin.x, drag.origin.z, drag.origin.quarter)
      this.refreshSelection()
      return false
    }
    this.model.rebuildTerrain()
    this.refreshSelection()
    return true
  }

  moveSelected(dx: number, dz: number): PlacementProblem | 'none' {
    const slug = this.selected
    const building = slug && this.model.buildings.get(slug)
    const placement = slug ? this.model.placementOf(slug) : null
    if (!slug || !building || !placement) {
      return 'none'
    }
    const next = { ...placement, x: placement.x + dx, z: placement.z + dz }
    const problem = checkPlacement(next, this.model.othersThan(slug), this.model.radius)
    if (problem) {
      return problem
    }
    this.model.place(building, next.x, next.z, next.quarter)
    this.model.rebuildTerrain()
    this.refreshSelection()
    return null
  }

  get axes() {
    this.root.updateMatrixWorld()
    const origin = new THREE.Vector3().applyMatrix4(this.root.matrixWorld)
    return {
      origin,
      x: new THREE.Vector3(1, 0, 0).applyMatrix4(this.root.matrixWorld),
      z: new THREE.Vector3(0, 0, 1).applyMatrix4(this.root.matrixWorld),
    }
  }

  rotateSelected(step = 1) {
    const slug = this.selected
    const building = slug && this.model.buildings.get(slug)
    const next = slug ? this.model.rotationFor(slug, step) : null
    if (!building || !next) {
      return false
    }
    this.model.place(building, next.x, next.z, next.quarter)
    this.model.rebuildTerrain()
    this.refreshSelection()
    return true
  }

  private refreshSelection() {
    const building = this.selected ? this.model.buildings.get(this.selected) : null
    this.selection.visible = !!building && this.growth >= 1
    if (!building) {
      return
    }
    const { rect, height } = building
    this.selection.scale.set(rect.maxX - rect.minX + 0.4, height + 0.4, rect.maxZ - rect.minZ + 0.4)
    this.selection.position.set((rect.minX + rect.maxX) / 2, height / 2, (rect.minZ + rect.maxZ) / 2)
    ;(this.selection.material as THREE.LineBasicMaterial).color.copy(this.drag?.problem ? INVALID : VALID)
  }

  dispose() {
    this.root.removeFromParent()
    this.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
    })
    this.model.stand.dispose()
  }
}
