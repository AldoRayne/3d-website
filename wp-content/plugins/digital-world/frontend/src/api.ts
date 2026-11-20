import type { BootData, ChatTurn, NavigatorResponse, WorldResponse } from '@/types'

declare global {
  interface Window {
    DigitalWorld?: BootData
  }
}

export const boot: BootData = window.DigitalWorld ?? {
  restUrl: '/wp-json/digital-world/v1',
  nonce: '',
  homeUrl: '/',
  siteName: 'Digital World',
  ai: false,
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = '',
    public fields: Record<string, string> = {},
  ) {
    super(message)
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${boot.restUrl}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(boot.nonce ? { 'X-WP-Nonce': boot.nonce } : {}),
      ...init.headers,
    },
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(data?.message ?? `HTTP ${response.status}`, response.status, data?.code ?? '', data?.data?.fields ?? {})
  }
  return data as T
}

export function fetchWorld(): Promise<WorldResponse> {
  const inline = boot.world
  if (inline) {
    delete boot.world
    return Promise.resolve(inline)
  }
  return request<WorldResponse>('/world')
}

export function askNavigator(message: string, history: ChatTurn[]): Promise<NavigatorResponse> {
  return request<NavigatorResponse>('/navigate', {
    method: 'POST',
    body: JSON.stringify({ message, history }),
  })
}
