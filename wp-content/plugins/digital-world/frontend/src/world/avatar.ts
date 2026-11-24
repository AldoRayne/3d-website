import options from '../../../includes/avatar-options.json'

export const AVATAR_OPTIONS = options

export type AvatarKey = keyof typeof AVATAR_OPTIONS

export interface Avatar {
  skin: string
  face: 'calm' | 'smile' | 'freckles' | 'beard'
  hair: string
  hairStyle: 'short' | 'long' | 'bun' | 'buzz'
  jacket: string
  pants: string
  pack: string
  hat: 'none' | 'cap' | 'beanie'
  glasses: 'none' | 'round' | 'shades'
}

export type AvatarPatch = Partial<Avatar>

const KEYS = Object.keys(AVATAR_OPTIONS) as AvatarKey[]

export const DEFAULT_AVATAR = Object.fromEntries(KEYS.map((key) => [key, AVATAR_OPTIONS[key][0]])) as unknown as Avatar

export function resolveAvatar(patch: AvatarPatch | [] | null | undefined): Avatar {
  const avatar = { ...DEFAULT_AVATAR }
  if (!patch || Array.isArray(patch)) {
    return avatar
  }
  for (const key of KEYS) {
    const value = patch[key]
    if (typeof value === 'string' && (AVATAR_OPTIONS[key] as string[]).includes(value)) {
      ;(avatar as unknown as Record<string, string>)[key] = value
    }
  }
  return avatar
}

export function avatarDiff(avatar: Avatar): AvatarPatch {
  return Object.fromEntries(KEYS.filter((key) => avatar[key] !== DEFAULT_AVATAR[key]).map((key) => [key, avatar[key]]))
}

export function sameAvatar(a: Avatar, b: Avatar) {
  return KEYS.every((key) => a[key] === b[key])
}
