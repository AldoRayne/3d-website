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

function markEdges(geometry: THREE.BufferGeometry) {
  const count = geometry.attributes.position.count
  const edge = new Float32Array(count)
  for (const group of geometry.groups) {
    if (group.materialIndex === 1) {
      edge.fill(1, group.start, group.start + group.count)
    }
  }
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1))
  geometry.clearGroups()
  return geometry
}

export async function warmGlyphs(doc: Document) {
  const win = doc.defaultView
  if (!win || !doc.body) {
    return
  }
  await doc.fonts?.ready
  const wanted = new Map<Weight, Set<string>>()
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement
    if (!parent || !node.data.trim() || parent.closest('script, style, noscript, template')) {
      continue
    }
    const css = win.getComputedStyle(parent)
    const weight = weightOf(css.fontWeight)
    const text = css.textTransform === 'uppercase' ? node.data.toUpperCase() : css.textTransform === 'lowercase' ? node.data.toLowerCase() : node.data
    const set = wanted.get(weight) ?? new Set<string>()
    for (const char of text) {
      if (char.trim()) {
        set.add(char)
      }
    }
    wanted.set(weight, set)
  }
  for (const [weight, chars] of wanted) {
    const font = await loadFont(weight)
    let index = 0
    for (const char of chars) {
      font.glyph(char)
      if (++index % 6 === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    }
  }
}

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
                ? markEdges(new THREE.ExtrudeGeometry(shapes, { depth: 1, curveSegments: 3, bevelEnabled: false }))
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
