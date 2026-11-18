import * as THREE from 'three'

const SIZE = 16

type Ctx = CanvasRenderingContext2D
type Random = () => number

function random(seed: number): Random {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  }
  return h >>> 0
}

function shade(hex: string, amount: number) {
  const color = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  color.getHSL(hsl)
  color.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amount, 0, 1))
  return `#${color.getHexString()}`
}

function px(ctx: Ctx, x: number, y: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, 1, 1)
}

function noise(ctx: Ctx, rnd: Random, palette: string[], x0 = 0, y0 = 0, w = SIZE, h = SIZE) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      px(ctx, x, y, palette[Math.floor(rnd() * palette.length)])
    }
  }
}

function tones(base: string, spread = 0.05) {
  return [shade(base, -spread), base, base, shade(base, spread * 0.6), shade(base, -spread * 0.4)]
}

const painters: Record<string, (ctx: Ctx, rnd: Random, arg: string) => void> = {
  grassTop(ctx, rnd) {
    noise(ctx, rnd, ['#66a54b', '#6aaa4f', '#6fae53', '#63a148', '#73b257', '#5f9d46'])
  },
  dirt(ctx, rnd) {
    noise(ctx, rnd, ['#86593a', '#7a5034', '#946545', '#6f472e', '#8c5f3f'])
    for (let i = 0; i < 6; i++) {
      px(ctx, Math.floor(rnd() * SIZE), Math.floor(rnd() * SIZE), '#a8a29a')
    }
  },
  grassSide(ctx, rnd) {
    painters.dirt(ctx, rnd, '')
    for (let x = 0; x < SIZE; x++) {
      const depth = 3 + Math.floor(rnd() * 3)
      for (let y = 0; y < depth; y++) {
        px(ctx, x, y, ['#66a54b', '#6aaa4f', '#6fae53', '#63a148'][Math.floor(rnd() * 4)])
      }
    }
  },
  path(ctx, rnd) {
    noise(ctx, rnd, ['#cdb98a', '#d6c497', '#c4ae7e', '#dccb9f', '#bfa879'])
    for (let i = 0; i < 8; i++) {
      px(ctx, Math.floor(rnd() * SIZE), Math.floor(rnd() * SIZE), '#9e8f73')
    }
  },
  stone(ctx, rnd) {
    noise(ctx, rnd, ['#8b8d91', '#7e8084', '#96989c', '#727478', '#8f9195'])
  },
  stoneBrick(ctx, rnd) {
    noise(ctx, rnd, ['#9a9ca0', '#8e9094', '#a3a5a9', '#94969a'])
    ctx.fillStyle = '#6b6d71'
    for (let y = 0; y < SIZE; y += 8) {
      ctx.fillRect(0, y + 7, SIZE, 1)
      const offset = (y / 8) % 2 ? 4 : 12
      ctx.fillRect(offset, y, 1, 7)
    }
  },
  planks(ctx, rnd) {
    noise(ctx, rnd, ['#c99a62', '#bf8f58', '#d1a46c', '#c59660'])
    ctx.fillStyle = '#8f6539'
    for (let y = 3; y < SIZE; y += 4) {
      ctx.fillRect(0, y, SIZE, 1)
    }
    for (let row = 0; row < 4; row++) {
      px(ctx, (row * 7 + 3) % SIZE, row * 4 + 1, '#8f6539')
      px(ctx, (row * 7 + 3) % SIZE, row * 4 + 2, '#8f6539')
    }
  },
  logSide(ctx, rnd) {
    for (let x = 0; x < SIZE; x++) {
      const stripe = x % 4 === 0 ? '#4a321f' : x % 4 === 2 ? '#5c4029' : '#664831'
      for (let y = 0; y < SIZE; y++) {
        px(ctx, x, y, rnd() < 0.15 ? '#3f2a19' : stripe)
      }
    }
  },
  logTop(ctx, rnd) {
    noise(ctx, rnd, ['#b8915e', '#ad8655'])
    ctx.strokeStyle = '#8a6740'
    ctx.lineWidth = 1
    for (const r of [2.5, 5, 7.5]) {
      ctx.strokeRect(8 - r, 8 - r, r * 2, r * 2)
    }
    ctx.strokeStyle = '#5c4029'
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1)
  },
  leaves(ctx, rnd) {
    noise(ctx, rnd, ['#3f7f35', '#4a8c3e', '#356f2d', '#56984a', '#2f6328'])
  },
  glass(ctx, rnd) {
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = 'rgba(190, 228, 245, 0.35)'
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = '#e8f5fb'
    ctx.fillRect(0, 0, SIZE, 1)
    ctx.fillRect(0, SIZE - 1, SIZE, 1)
    ctx.fillRect(0, 0, 1, SIZE)
    ctx.fillRect(SIZE - 1, 0, 1, SIZE)
    for (let i = 0; i < 4; i++) {
      px(ctx, 3 + i, 9 - i, 'rgba(255,255,255,0.8)')
      px(ctx, 5 + i, 12 - i, 'rgba(255,255,255,0.55)')
    }
    void rnd
  },
  brick(ctx, rnd) {
    noise(ctx, rnd, ['#b4553f', '#a84d39', '#bd5d46', '#9f4733'])
    ctx.fillStyle = '#d9cfc2'
    for (let y = 0; y < SIZE; y += 4) {
      ctx.fillRect(0, y + 3, SIZE, 1)
      const offset = (y / 4) % 2 ? 0 : 4
      for (let x = offset; x < SIZE; x += 8) {
        ctx.fillRect(x, y, 1, 3)
      }
    }
  },
  plaster(ctx, rnd) {
    noise(ctx, rnd, ['#ece7dc', '#e4dfd3', '#f2eee5', '#e8e2d6'])
  },
  shelf(ctx, rnd) {
    noise(ctx, rnd, ['#a87947'])
    const spines = ['#b8423a', '#3b6fb0', '#e1b03c', '#4f9a5b', '#7b4fa0', '#d9d2c3']
    for (const top of [1, 9]) {
      for (let x = 1; x < SIZE - 1; x++) {
        const color = spines[Math.floor(rnd() * spines.length)]
        const height = 5 + Math.floor(rnd() * 2)
        for (let y = top + (6 - height); y < top + 6; y++) {
          px(ctx, x, y, color)
        }
      }
      ctx.fillStyle = '#7a5530'
      ctx.fillRect(0, top + 6, SIZE, 1)
    }
  },
  lamp(ctx, rnd) {
    noise(ctx, rnd, ['#ffe38a', '#ffd766', '#fff0b3'])
    ctx.fillStyle = '#7a5530'
    ctx.fillRect(0, 0, SIZE, 2)
    ctx.fillRect(0, SIZE - 2, SIZE, 2)
    ctx.fillRect(0, 0, 2, SIZE)
    ctx.fillRect(SIZE - 2, 0, 2, SIZE)
  },
  cloud(ctx, rnd) {
    noise(ctx, rnd, ['#ffffff', '#f6f8fb', '#eef2f7'])
  },
  accent(ctx, rnd, color) {
    noise(ctx, rnd, tones(color, 0.06))
    ctx.fillStyle = shade(color, -0.12)
    ctx.fillRect(0, SIZE - 1, SIZE, 1)
    ctx.fillRect(SIZE - 1, 0, 1, SIZE)
  },
  roof(ctx, rnd, color) {
    const base = shade(color, -0.12)
    noise(ctx, rnd, tones(base, 0.04))
    ctx.fillStyle = shade(base, -0.14)
    for (let y = 3; y < SIZE; y += 4) {
      ctx.fillRect(0, y, SIZE, 1)
      const offset = (y + 1) % 8 ? 2 : 10
      ctx.fillRect(offset, y - 3, 1, 3)
    }
  },
  door(ctx, rnd) {
    noise(ctx, rnd, ['#a06f3e', '#986839', '#a87644'])
    ctx.fillStyle = '#6e4825'
    for (let x = 3; x < SIZE; x += 4) {
      ctx.fillRect(x, 0, 1, SIZE)
    }
    ctx.fillRect(0, 0, SIZE, 1)
    ctx.fillRect(0, 0, 1, SIZE)
    ctx.fillRect(SIZE - 1, 0, 1, SIZE)
  },
  doorTop(ctx, rnd) {
    painters.door(ctx, rnd, '')
    ctx.fillStyle = '#bfe3f2'
    ctx.fillRect(3, 3, 4, 5)
    ctx.fillRect(9, 3, 4, 5)
    ctx.fillStyle = '#6e4825'
    ctx.fillRect(2, 2, 12, 1)
    ctx.fillRect(2, 8, 12, 1)
  },
  doorBottom(ctx, rnd) {
    painters.door(ctx, rnd, '')
    ctx.fillStyle = '#2b2b2b'
    ctx.fillRect(12, 1, 2, 2)
    ctx.fillStyle = '#6e4825'
    ctx.fillRect(0, SIZE - 1, SIZE, 1)
  },
  face(ctx) {
    ctx.fillStyle = '#efc29a'
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = '#3a2618'
    ctx.fillRect(0, 0, SIZE, 4)
    ctx.fillRect(0, 4, 2, 2)
    ctx.fillRect(14, 4, 2, 2)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(3, 7, 3, 2)
    ctx.fillRect(10, 7, 3, 2)
    ctx.fillStyle = '#2a3b55'
    ctx.fillRect(4, 7, 2, 2)
    ctx.fillRect(10, 7, 2, 2)
    ctx.fillStyle = '#5a3a26'
    ctx.fillRect(3, 6, 3, 1)
    ctx.fillRect(10, 6, 3, 1)
    ctx.fillStyle = '#c4875f'
    ctx.fillRect(7, 9, 2, 2)
    ctx.fillStyle = '#9b4f3a'
    ctx.fillRect(5, 12, 6, 1)
  },
  headSide(ctx) {
    ctx.fillStyle = '#efc29a'
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = '#3a2618'
    ctx.fillRect(0, 0, SIZE, 6)
    ctx.fillRect(10, 6, 6, 4)
  },
  headBack(ctx) {
    ctx.fillStyle = '#3a2618'
    ctx.fillRect(0, 0, SIZE, 12)
    ctx.fillStyle = '#efc29a'
    ctx.fillRect(0, 12, SIZE, 4)
  },
  hair(ctx, rnd) {
    noise(ctx, rnd, ['#3a2618', '#43301f', '#33211a'])
  },
  jacket(ctx, rnd) {
    noise(ctx, rnd, ['#e07a3c', '#d9733a', '#e6844a'])
    ctx.fillStyle = '#f3e3c8'
    ctx.fillRect(7, 0, 2, SIZE)
  },
  sleeve(ctx, rnd) {
    noise(ctx, rnd, ['#e07a3c', '#d9733a', '#e6844a'])
    ctx.fillStyle = '#efc29a'
    ctx.fillRect(0, SIZE - 4, SIZE, 4)
  },
  pants(ctx, rnd) {
    noise(ctx, rnd, ['#6d6a3e', '#666339', '#737044'])
    ctx.fillStyle = '#3b3328'
    ctx.fillRect(0, SIZE - 3, SIZE, 3)
  },
  pack(ctx, rnd) {
    noise(ctx, rnd, ['#4f6b4a', '#486244', '#577452'])
    ctx.fillStyle = '#2f3f2c'
    ctx.fillRect(0, 5, SIZE, 1)
    ctx.fillStyle = '#c9a24a'
    ctx.fillRect(7, 6, 2, 2)
  },
}

const cache = new Map<string, THREE.Texture>()

export function texture(name: string, arg = '') {
  const key = `${name}:${arg}`
  const cached = cache.get(key)
  if (cached) {
    return cached
  }
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d') as Ctx
  painters[name](ctx, random(hash(key)), arg)
  const result = new THREE.CanvasTexture(canvas)
  result.magFilter = THREE.NearestFilter
  result.minFilter = THREE.NearestMipmapLinearFilter
  result.colorSpace = THREE.SRGBColorSpace
  result.anisotropy = 4
  cache.set(key, result)
  return result
}

export { shade }
