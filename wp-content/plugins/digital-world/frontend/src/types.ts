export type WorldObjectType = 'building' | 'tower' | 'dome' | 'library' | 'gallery' | 'portal'

export type WorldAnimation = 'none' | 'floating' | 'rotating' | 'pulse'

export type DoorSide = 'auto' | 'north' | 'east' | 'south' | 'west'

export interface WorldObject {
  id: number
  slug: string
  title: string
  type: WorldObjectType
  description: string
  keywords: string[]
  color: string
  animation: WorldAnimation
  scale: number
  door: DoorSide
  position: { x: number; y: number; z: number }
  model: string | null
  page_id: number | null
  url: string | null
  page_title: string | null
}

export interface WorldResponse {
  site: { name: string; home: string }
  ai: boolean
  objects: WorldObject[]
}

export type NavigatorAction = 'navigate' | 'open' | 'overview' | 'none'

export type CameraTransition = 'fly' | 'instant'

export interface NavigatorCommand {
  action: NavigatorAction
  target: string | null
  camera: { transition: CameraTransition }
}

export interface NavigatorResponse {
  reply: string
  command: NavigatorCommand
  source: 'ai' | 'fallback'
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface BootData {
  restUrl: string
  nonce: string
  homeUrl: string
  siteName: string
  ai: boolean
}
