import type { AvatarPatch } from '@/world/avatar'

export type DoorSide = 'auto' | 'north' | 'east' | 'south' | 'west'

export interface WorldObject {
  id: number
  slug: string
  title: string
  seed: number
  description: string
  keywords: string[]
  color: string
  door: DoorSide
  position: { x: number; z: number }
  page_id: number | null
  url: string | null
  page_title: string | null
}

export interface WorldResponse {
  site: { name: string; home: string }
  ai: AiProvider | null
  island: { radius: number }
  objects: WorldObject[]
}

export type AiProvider = 'claude' | 'ollama' | 'openai' | 'gemini'

export type NavigatorAction = string

export type CameraTransition = 'fly' | 'instant'

export interface NavigatorCommand {
  action: NavigatorAction
  target: string | null
  value?: string
  amount?: number
  camera: { transition: CameraTransition }
}

export interface NavigatorResponse {
  reply: string
  command: NavigatorCommand
  source: 'ai' | 'fallback'
  provider?: AiProvider
}

export type NavigatorScreen = 'world' | 'entering' | 'reading' | 'book'

export interface NavigatorActionInfo {
  id: string
  description: string
  values: string[]
}

export interface NavigatorContext {
  screen: NavigatorScreen
  bookPage: 'guest' | 'island' | 'avatar' | null
  signedIn: boolean
  visiting: boolean
  near: string | null
  reading: string | null
  selected: string | null
  actions?: NavigatorActionInfo[]
}

export interface Reply {
  text: string
  quiet?: boolean
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
  ai: AiProvider | null
  world?: WorldResponse
  auth?: AuthBoot
  visit?: VisitBoot | null
  realtime?: boolean
}

export interface VisitBoot {
  kind: 'admin' | 'invite'
  id: number
  name: string
  layout: Layout | []
  avatar?: AvatarPatch | []
  returnUrl: string
  invite?: string
}

export type LayoutSide = Exclude<DoorSide, 'auto'>
export type Layout = Record<string, { x: number; z: number; door: LayoutSide }>

export interface AuthUser {
  id: number
  name: string
  canAdmin?: boolean
  layout?: Layout
  avatar?: AvatarPatch | []
}

export interface AuthBoot {
  user: AuthUser | null
  registrationOpen: boolean
  turnstileSiteKey: string
  lostPasswordUrl: string
  privacyUrl: string
  adminUrl: string
  adminLoginUrl: string
  minPassword: number
}
