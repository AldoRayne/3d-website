import type { Layout, WorldObject } from '@/types'
import { checkPlacement, defaultQuarter, DOOR_SIDES, sideOfQuarter, type Placement } from './WorldModel'

function defaultPlacement(object: WorldObject): Placement {
  const x = Math.round(object.position.x)
  const z = Math.round(object.position.z)
  return { x, z, quarter: defaultQuarter(object.door, x, z), seed: object.seed }
}

export function applyLayout(objects: WorldObject[], layout: Layout, radius: number): WorldObject[] {
  const placements = new Map(objects.map((object) => [object.slug, defaultPlacement(object)]))
  for (const object of objects) {
    const entry = layout[object.slug]
    const quarter = entry ? DOOR_SIDES.indexOf(entry.door) : -1
    if (!entry || quarter < 0) {
      continue
    }
    const candidate = { x: entry.x, z: entry.z, quarter, seed: object.seed }
    const others = [...placements].filter(([slug]) => slug !== object.slug).map(([, placement]) => placement)
    if (!checkPlacement(candidate, others, radius)) {
      placements.set(object.slug, candidate)
    }
  }
  return objects.map((object) => {
    const placement = placements.get(object.slug) as Placement
    return {
      ...object,
      position: { x: placement.x, z: placement.z },
      door: object.slug in layout ? sideOfQuarter(placement.quarter) : object.door,
    }
  })
}

export function layoutDiff(defaults: WorldObject[], current: Map<string, Placement>): Layout {
  const layout: Layout = {}
  for (const object of defaults) {
    const base = defaultPlacement(object)
    const now = current.get(object.slug)
    if (now && (now.x !== base.x || now.z !== base.z || now.quarter !== base.quarter)) {
      layout[object.slug] = { x: now.x, z: now.z, door: sideOfQuarter(now.quarter) }
    }
  }
  return layout
}
