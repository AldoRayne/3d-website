import * as THREE from 'three'
import { loadFont, weightOf, type LoadedFont, type Weight } from './font'

export const UNIT = 0.01

const ROOTS = '.wp-site-blocks'
const SKIP = 'script, style, noscript, template, svg, .screen-reader-text, .skip-link, .dw-enter, #wpadminbar'
const BUTTONS = '.wp-element-button, .wp-block-button__link, button, input[type="submit"]'
const SLAB = 0.05

export interface Sculpture {
  group: THREE.Group
  bounds: THREE.Box3
  links: Array<{ box: THREE.Box3; href: string }>
  anchors: Map<string, number>
  background: THREE.Color
  viewHeight: number
  title: string
  setRise(value: number): void
  dispose(): void
}

interface CharItem {
  char: string
  rect: DOMRect
  size: number
  weight: Weight
  color: THREE.Color
  depth: number
  base: number
}

function transparent(color: string) {
  return !color || color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color)
}

function riseMaterial(material: THREE.Material, rise: { value: number }, edge = false) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRise = rise
    if (edge) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.80, 0.70), 0.62);',
      )
    }
    shader.vertexShader = `uniform float uRise;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition.z *= uRise;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
    )
  }
  material.customProgramCacheKey = () => (edge ? 'dw-rise-edge' : 'dw-rise')
  return material
}

function readableAccent(accent: string) {
  const color = new THREE.Color(accent)
  const hsl = { h: 0, s: 0, l: 0 }
  color.getHSL(hsl)
  if (hsl.l > 0.45) {
    color.setHSL(hsl.h, Math.min(1, hsl.s + 0.1), 0.38)
  }
  return color
}

function pickRoots(doc: Document) {
  const site = doc.querySelector<HTMLElement>(ROOTS)
  return [site ?? doc.body]
}

function applyTransform(text: string, transform: string) {
  if (transform === 'uppercase') {
    return text.toUpperCase()
  }
  if (transform === 'lowercase') {
    return text.toLowerCase()
  }
  return text
}

export async function sculptPage(doc: Document, view: { width: number; height: number }, accent: string): Promise<Sculpture | null> {
  const win = doc.defaultView
  if (!win || !doc.body) {
    return null
  }
  const scrollY = win.scrollY
  const x = (px: number) => (px - view.width / 2) * UNIT
  const y = (py: number) => -(py + scrollY - view.height / 2) * UNIT
  const roots = pickRoots(doc)
  const inRoots = (el: Element) => roots.some((root) => root.contains(el))
  const styles = new Map<Element, CSSStyleDeclaration>()
  const style = (el: Element) => {
    let value = styles.get(el)
    if (!value) {
      value = win.getComputedStyle(el)
      styles.set(el, value)
    }
    return value
  }
  const linkColor = readableAccent(accent)

  const surfaces: Array<{ rect: DOMRect; color: THREE.Color; z: number; depth: number }> = []
  const bases = new Map<Element, number>()
  const baseOf = (el: Element | null): number => {
    if (!el || !inRoots(el)) {
      return 0
    }
    const cached = bases.get(el)
    if (cached !== undefined) {
      return cached
    }
    const parentBase = baseOf(el.parentElement)
    const own = style(el)
    let base = parentBase
    if (!transparent(own.backgroundColor) && el.getBoundingClientRect().width > 1) {
      const rect = el.getBoundingClientRect()
      const depth = el.matches(BUTTONS) ? Math.max(0.08, rect.height * UNIT * 0.35) : SLAB
      surfaces.push({ rect, color: new THREE.Color().setStyle(own.backgroundColor), z: parentBase, depth })
      base = parentBase + depth
    }
    bases.set(el, base)
    return base
  }

  const chars: CharItem[] = []
  const range = doc.createRange()
  for (const root of roots) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const parent = node.parentElement
      if (!parent || !node.data.trim() || parent.closest(SKIP)) {
        continue
      }
      const css = style(parent)
      if (css.visibility === 'hidden' || Number(css.opacity) === 0) {
        continue
      }
      const size = parseFloat(css.fontSize) || 16
      const heading = !!parent.closest('h1, h2, h3, h4, h5, h6')
      const link = parent.closest<HTMLAnchorElement>('a[href]')
      const button = !!parent.closest(BUTTONS)
      const color = link && !button ? linkColor : new THREE.Color().setStyle(transparent(css.color) ? '#222' : css.color)
      const text = applyTransform(node.data, css.textTransform)
      const base = baseOf(parent)
      for (let i = 0; i < node.data.length; i++) {
        const char = text[i]
        if (!char || !char.trim()) {
          continue
        }
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const rect = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0)
        if (!rect) {
          continue
        }
        chars.push({
          char,
          rect,
          size,
          weight: weightOf(css.fontWeight),
          color,
          depth: size * UNIT * (button ? 0.25 : heading ? 0.45 : 0.3),
          base,
        })
      }
    }
  }

  const markers: Array<{ kind: 'dot' | 'number'; li: HTMLElement; text: string }> = []
  for (const root of roots) {
    for (const li of root.querySelectorAll<HTMLElement>('ul > li, ol > li')) {
      const type = style(li).listStyleType
      if (type === 'none') {
        continue
      }
      const list = li.parentElement as HTMLElement
      if (list.tagName === 'OL') {
        const items = [...list.children].filter((child) => child.tagName === 'LI')
        const start = Number(list.getAttribute('start') ?? 1) || 1
        const reversed = list.hasAttribute('reversed')
        const index = items.indexOf(li)
        markers.push({ kind: 'number', li, text: `${reversed ? items.length - index + start - 1 : start + index}.` })
      } else {
        markers.push({ kind: 'dot', li, text: '' })
      }
    }
  }

  const weights = new Set<Weight>(chars.map((item) => item.weight))
  for (const marker of markers) {
    if (marker.kind === 'number') {
      weights.add(weightOf(style(marker.li).fontWeight))
    }
  }
  const fonts = new Map<Weight, LoadedFont>()
  await Promise.all([...weights].map(async (weight) => fonts.set(weight, await loadFont(weight))))

  const rise = { value: 0 }
  const group = new THREE.Group()
  const owned: Array<{ dispose(): void }> = []
  const own = <T extends { dispose(): void }>(item: T) => {
    owned.push(item)
    return item
  }
  const glyphMaterial = [
    own(riseMaterial(new THREE.MeshLambertMaterial({ color: '#ffffff' }), rise)),
    own(riseMaterial(new THREE.MeshLambertMaterial({ color: '#ffffff' }), rise, true)),
  ]
  const buckets = new Map<string, { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[]; colors: THREE.Color[] }>()
  const bounds = new THREE.Box3()
  const links: Array<{ box: THREE.Box3; href: string }> = []
  const scale = new THREE.Vector3()
  const position = new THREE.Vector3()
  const identity = new THREE.Quaternion()

  const baselineOf = (rect: DOMRect, size: number, font: LoadedFont) => {
    const content = ((font.ascender - font.descender) / font.resolution) * size
    return rect.top + (font.ascender / font.resolution) * size + (rect.height - content) / 2
  }
  const placeGlyph = (font: LoadedFont, weight: Weight, char: string, left: number, baseline: number, size: number, depth: number, base: number, color: THREE.Color) => {
    const glyph = font.glyph(char)
    if (!glyph) {
      return 0
    }
    const key = `${weight}|${char}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { geometry: glyph.geometry, matrices: [], colors: [] }
      buckets.set(key, bucket)
    }
    position.set(x(left), y(baseline), base)
    scale.set(size * UNIT, size * UNIT, depth)
    bucket.matrices.push(new THREE.Matrix4().compose(position, identity, scale))
    bucket.colors.push(color)
    bounds.expandByPoint(position)
    bounds.expandByPoint(new THREE.Vector3(position.x + glyph.advance * size * UNIT, position.y + size * UNIT, base + depth))
    return glyph.advance * size
  }

  for (const item of chars) {
    const font = fonts.get(item.weight) as LoadedFont
    placeGlyph(font, item.weight, item.char, item.rect.left, baselineOf(item.rect, item.size, font), item.size, item.depth, item.base, item.color)
  }

  for (const root of roots) {
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (anchor.closest(SKIP)) {
        continue
      }
      const size = parseFloat(style(anchor).fontSize) || 16
      const top = baseOf(anchor) + size * UNIT * 0.5
      for (const rect of anchor.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) {
          continue
        }
        links.push({
          box: new THREE.Box3(new THREE.Vector3(x(rect.left), y(rect.bottom), 0), new THREE.Vector3(x(rect.right), y(rect.top), top)),
          href: anchor.href,
        })
      }
    }
  }

  const accentColor = new THREE.Color(accent)
  const dots: THREE.Matrix4[] = []
  for (const marker of markers) {
    range.selectNodeContents(marker.li)
    const first = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0)
    if (!first) {
      continue
    }
    const css = style(marker.li)
    const size = parseFloat(css.fontSize) || 16
    const left = marker.li.getBoundingClientRect().left
    const weight = weightOf(css.fontWeight)
    const font = fonts.get(weight) ?? fonts.values().next().value
    if (!font) {
      continue
    }
    const baseline = baselineOf(first, size, font)
    const base = baseOf(marker.li.parentElement)
    if (marker.kind === 'dot') {
      const radius = size * UNIT * 0.2
      dots.push(new THREE.Matrix4().compose(new THREE.Vector3(x(left - size * 0.75), y(baseline - size * 0.33), base), identity, new THREE.Vector3(radius, radius, radius)))
    } else {
      const width = [...marker.text].reduce((sum, char) => sum + (font.glyph(char)?.advance ?? 0.5) * size, 0)
      let cursor = left - size * 0.3 - width
      for (const char of marker.text) {
        cursor += placeGlyph(font, weight, char, cursor, baseline, size, size * UNIT * 0.55, base, accentColor)
      }
    }
  }

  for (const [, bucket] of buckets) {
    const mesh = new THREE.InstancedMesh(bucket.geometry, glyphMaterial, bucket.matrices.length)
    bucket.matrices.forEach((m, index) => {
      mesh.setMatrixAt(index, m)
      mesh.setColorAt(index, bucket.colors[index])
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }
    mesh.frustumCulled = false
    group.add(mesh)
  }

  if (dots.length) {
    const sphere = own(new THREE.SphereGeometry(1, 16, 12).translate(0, 0, 1))
    const material = own(riseMaterial(new THREE.MeshLambertMaterial({ color: accentColor }), rise))
    const mesh = new THREE.InstancedMesh(sphere, material, dots.length)
    dots.forEach((m, index) => mesh.setMatrixAt(index, m))
    mesh.frustumCulled = false
    group.add(mesh)
  }

  const blocks: Array<{ matrix: THREE.Matrix4; color: THREE.Color }> = []
  const slab = (left: number, top: number, width: number, height: number, z: number, depth: number, color: THREE.Color) => {
    if (width <= 0.5 || height <= 0.5) {
      return
    }
    blocks.push({
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(x(left + width / 2), y(top + height / 2), z), identity, new THREE.Vector3(width * UNIT, height * UNIT, depth)),
      color,
    })
    bounds.expandByPoint(new THREE.Vector3(x(left), y(top + height), z))
    bounds.expandByPoint(new THREE.Vector3(x(left + width), y(top), z + depth))
  }
  for (const surface of surfaces) {
    slab(surface.rect.left, surface.rect.top, surface.rect.width, surface.rect.height, surface.z, surface.depth, surface.color)
  }
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      if (el.closest(SKIP)) {
        continue
      }
      const css = style(el)
      const sides = [
        ['Top', 'width'],
        ['Bottom', 'width'],
        ['Left', 'height'],
        ['Right', 'height'],
      ] as const
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        continue
      }
      for (const [side] of sides) {
        const thickness = parseFloat(css.getPropertyValue(`border-${side.toLowerCase()}-width`))
        const color = css.getPropertyValue(`border-${side.toLowerCase()}-color`)
        if (!thickness || css.getPropertyValue(`border-${side.toLowerCase()}-style`) === 'none' || transparent(color)) {
          continue
        }
        const z = baseOf(el)
        const depth = Math.max(0.03, thickness * UNIT * 1.5)
        const tint = new THREE.Color().setStyle(color)
        if (side === 'Top') slab(rect.left, rect.top, rect.width, thickness, z, depth, tint)
        if (side === 'Bottom') slab(rect.left, rect.bottom - thickness, rect.width, thickness, z, depth, tint)
        if (side === 'Left') slab(rect.left, rect.top, thickness, rect.height, z, depth, tint)
        if (side === 'Right') slab(rect.right - thickness, rect.top, thickness, rect.height, z, depth, tint)
      }
    }
  }
  if (blocks.length) {
    const box = own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5))
    const material = own(riseMaterial(new THREE.MeshLambertMaterial({ color: '#ffffff' }), rise))
    const mesh = new THREE.InstancedMesh(box, material, blocks.length)
    blocks.forEach((block, index) => {
      mesh.setMatrixAt(index, block.matrix)
      mesh.setColorAt(index, block.color)
    })
    mesh.frustumCulled = false
    group.add(mesh)
  }

  const textureLoader = new THREE.TextureLoader()
  const plane = own(new THREE.PlaneGeometry(1, 1))
  const frameBox = own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5))
  const frameMaterial = own(riseMaterial(new THREE.MeshLambertMaterial({ color: '#fbf7ee' }), rise))
  for (const root of roots) {
    for (const img of root.querySelectorAll('img')) {
      const rect = img.getBoundingClientRect()
      const source = img.currentSrc || img.src
      if (rect.width < 2 || rect.height < 2 || !source) {
        continue
      }
      const z = baseOf(img.parentElement)
      const depth = 0.06
      const frame = new THREE.Mesh(frameBox, frameMaterial)
      frame.position.set(x(rect.left + rect.width / 2), y(rect.top + rect.height / 2), z)
      frame.scale.set(rect.width * UNIT + 0.08, rect.height * UNIT + 0.08, depth)
      const texture = own(textureLoader.load(source))
      texture.colorSpace = THREE.SRGBColorSpace
      const picture = new THREE.Mesh(plane, own(riseMaterial(new THREE.MeshBasicMaterial({ map: texture }), rise)))
      picture.position.set(frame.position.x, frame.position.y, z + depth + 0.002)
      picture.scale.set(rect.width * UNIT, rect.height * UNIT, 1)
      group.add(frame, picture)
      bounds.expandByPoint(new THREE.Vector3(x(rect.left), y(rect.bottom), z))
      bounds.expandByPoint(new THREE.Vector3(x(rect.right), y(rect.top), z + depth))
    }
  }

  const anchors = new Map<string, number>()
  for (const root of roots) {
    for (const el of root.querySelectorAll<HTMLElement>('[id]')) {
      anchors.set(el.id, y(el.getBoundingClientRect().top))
    }
  }

  if (bounds.isEmpty()) {
    bounds.set(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 0.1))
  }
  const bodyColor = style(doc.body).backgroundColor
  const htmlColor = style(doc.documentElement).backgroundColor
  const background = new THREE.Color().setStyle(!transparent(bodyColor) ? bodyColor : !transparent(htmlColor) ? htmlColor : '#ffffff')

  return {
    group,
    bounds,
    links,
    anchors,
    background,
    viewHeight: view.height * UNIT,
    title: (doc.querySelector('main .wp-block-post-title, .wp-block-post-title')?.textContent ?? doc.title).trim(),
    setRise(value: number) {
      rise.value = Math.max(0.0001, value)
    },
    dispose() {
      group.removeFromParent()
      owned.forEach((item) => item.dispose())
    },
  }
}
