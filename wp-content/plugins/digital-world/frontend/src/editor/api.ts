import type { DoorSide, WorldObject, WorldResponse } from '@/types'

export interface EditorBoot {
  restUrl: string
  nonce: string
  editUrl: string
  newUrl: string
  worldUrl: string
}

declare global {
  interface Window {
    DigitalWorldEditor?: EditorBoot
  }
}

export const boot: EditorBoot = window.DigitalWorldEditor ?? {
  restUrl: '/wp-json/digital-world/v1',
  nonce: '',
  editUrl: '/wp/wp-admin/post.php?action=edit&post=',
  newUrl: '/wp/wp-admin/post-new.php?post_type=digital_world_object',
  worldUrl: '/digital-world/',
}

export interface ObjectPatch {
  x?: number
  z?: number
  door?: DoorSide
  seed?: number
  color?: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${boot.restUrl}${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'X-WP-Nonce': boot.nonce,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.message ?? `HTTP ${response.status}`)
  }
  return data as T
}

export const loadWorld = () => request<WorldResponse>('/world')

export const saveObject = (id: number, patch: ObjectPatch) =>
  request<WorldObject>(`/objects/${id}`, { method: 'POST', body: JSON.stringify(patch) })

export const saveRadius = (radius: number) =>
  request<{ island_radius: number }>('/settings', { method: 'POST', body: JSON.stringify({ island_radius: radius }) })
