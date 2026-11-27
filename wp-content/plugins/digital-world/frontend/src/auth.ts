import { ref } from 'vue'
import { boot, request } from '@/api'
import type { AuthBoot, AuthUser, Layout } from '@/types'
import { avatarDiff, resolveAvatar, type Avatar, type AvatarPatch } from '@/world/avatar'

export const authConfig: AuthBoot = boot.auth ?? {
  user: null,
  registrationOpen: false,
  turnstileSiteKey: '',
  lostPasswordUrl: '',
  privacyUrl: '',
  adminUrl: '',
  adminLoginUrl: '',
  minPassword: 8,
}

export const currentUser = ref<AuthUser | null>(authConfig.user)

interface AuthResponse {
  user: AuthUser | null
  nonce: string
}

export interface LoginInput {
  email: string
  password: string
  remember: boolean
  turnstile: string
}

export interface RegisterInput extends LoginInput {
  name: string
  consent: boolean
}

async function authRequest(path: string, body: object) {
  const data = await request<AuthResponse>(path, { method: 'POST', body: JSON.stringify(body) })
  boot.nonce = data.nonce
  currentUser.value = data.user
  return data.user
}

export const login = (input: LoginInput) => authRequest('/auth/login', input)
export const register = (input: RegisterInput) => authRequest('/auth/register', input)
export const logout = () => authRequest('/auth/logout', {})

interface LayoutResponse {
  layout: Layout | []
}

const normalize = (layout: Layout | []) => (Array.isArray(layout) ? {} : layout)

export async function saveLayout(layout: Layout) {
  const data = await request<LayoutResponse>('/layout', { method: 'PUT', body: JSON.stringify({ layout }) })
  return normalize(data.layout)
}

export async function resetLayout() {
  const data = await request<LayoutResponse>('/layout', { method: 'DELETE' })
  return normalize(data.layout)
}

interface AvatarResponse {
  avatar: AvatarPatch | []
}

export async function saveAvatar(avatar: Avatar) {
  const data = await request<AvatarResponse>('/avatar', { method: 'PUT', body: JSON.stringify({ avatar: avatarDiff(avatar) }) })
  return resolveAvatar(data.avatar)
}

export async function resetAvatar() {
  const data = await request<AvatarResponse>('/avatar', { method: 'DELETE' })
  return resolveAvatar(data.avatar)
}

interface InviteResponse {
  url: string | null
}

export async function inviteLink() {
  const current = await request<InviteResponse>('/invite')
  if (current.url) {
    return current.url
  }
  return renewInviteLink()
}

export async function renewInviteLink() {
  const data = await request<InviteResponse>('/invite', { method: 'POST' })
  return data.url as string
}
