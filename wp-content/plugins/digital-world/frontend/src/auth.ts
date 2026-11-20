import { ref } from 'vue'
import { boot, request } from '@/api'
import type { AuthBoot, AuthUser } from '@/types'

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
