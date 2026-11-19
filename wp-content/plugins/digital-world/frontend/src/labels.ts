import { describeBuilding, specFromSeed } from '@/world/buildings'

export function buildingKind(seed: number) {
  return describeBuilding(seed).split(',').slice(0, 2).join(' ·')
}

export { describeBuilding, specFromSeed }
