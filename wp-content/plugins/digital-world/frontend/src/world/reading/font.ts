import * as THREE from 'three'
import { Font, FontLoader, type FontData } from 'three/addons/loaders/FontLoader.js'

export type Weight = 300 | 400 | 700

const SOURCES: Record<Weight, string> = {
  300: new URL('../../assets/fonts/manrope-300.json', import.meta.url).href,
  400: new URL('../../assets/fonts/manrope-400.json', import.meta.url).href,
  700: new URL('../../assets/fonts/manrope-700.json', import.meta.url).href,
}

export interface Glyph {
  geometry: THREE.BufferGeometry
  advance: number
}

export interface LoadedFont {
  font: Font
  resolution: number
  ascender: number
  descender: number
  glyph(char: string): Glyph | null
}

const loader = new FontLoader()
const fonts = new Map<Weight, Promise<LoadedFont>>()

export function weightOf(css: string): Weight {
  const value = Number(css) || 400
  return value >= 600 ? 700 : value >= 350 ? 400 : 300
}

export function loadFont(weight: Weight) {
  let pending = fonts.get(weight)
  if (!pending) {
    pending = fetch(SOURCES[weight])
      .then((response) => response.json() as Promise<FontData & { ascender: number; descender: number; resolution: number }>)
      .then((data) => {
        const font = loader.parse(data)
        const cache = new Map<string, Glyph | null>()
        return {
          font,
          resolution: data.resolution,
          ascender: data.ascender,
          descender: data.descender,
          glyph(char: string) {
            if (cache.has(char)) {
              return cache.get(char) as Glyph | null
            }
            const source = (data.glyphs as Record<string, { ha: number; o?: string }>)[char]
            let result: Glyph | null = null
            if (source) {
              const shapes = font.generateShapes(char, 1)
              const geometry = shapes.length
                ? new THREE.ExtrudeGeometry(shapes, {
                    depth: 1,
                    curveSegments: 4,
                    bevelEnabled: true,
                    bevelThickness: 0.04,
                    bevelSize: 0.01,
                    bevelSegments: 1,
                  })
                : new THREE.BufferGeometry()
              result = { geometry, advance: source.ha / data.resolution }
            }
            cache.set(char, result)
            return result
          },
        }
      })
    fonts.set(weight, pending)
  }
  return pending
}
