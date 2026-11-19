const ATTR = 'data-dw-block'
const VERSION = 3
const CLASSIC_ROOTS = '.wp-block-post-content, .entry-content'
const SOLID = 'img, svg, video, canvas, iframe, picture, input, textarea, select, button, hr, .wp-element-button'
const GAP = 4
export const NARROW = '(max-width: 599px)'

export interface Offset {
  x: number
  y: number
}

export interface Anchor {
  s: number
  x: number
  y: number
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  }
  return (h >>> 0).toString(36)
}

function markClassic() {
  const seen = new Map<string, number>()
  const mark = (el: Element) => {
    const base = `c${hash(`${el.tagName}|${el.textContent ?? ''}`)}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    el.setAttribute(ATTR, count > 1 ? `${base}-${count}` : base)
  }
  for (const root of document.querySelectorAll(CLASSIC_ROOTS)) {
    for (const child of root.children) {
      if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(child.tagName)) {
        continue
      }
      if (!child.hasAttribute(ATTR)) {
        mark(child)
      }
      if (child.matches('ul, ol')) {
        for (const item of child.children) {
          if (item.tagName === 'LI' && !item.hasAttribute(ATTR)) {
            mark(item)
          }
        }
      }
    }
  }
}

function hasSurface(el: Element) {
  const style = getComputedStyle(el)
  const background = style.backgroundColor
  const painted = background !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(background)
  return painted || style.backgroundImage !== 'none' || parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) > 0
}

export function pageBox(rect: DOMRect | Box): Box {
  return { left: rect.left + window.scrollX, top: rect.top + window.scrollY, right: rect.right + window.scrollX, bottom: rect.bottom + window.scrollY }
}

export function shift(box: Box, dx: number, dy: number): Box {
  return { left: box.left + dx, top: box.top + dy, right: box.right + dx, bottom: box.bottom + dy }
}

export function overlaps(box: Box, others: Box[]) {
  return others.some((o) => box.left < o.right - GAP && box.right > o.left + GAP && box.top < o.bottom - GAP && box.bottom > o.top + GAP)
}

export function inBounds(box: Box) {
  return box.left >= 0 && box.top >= 0 && box.right <= document.documentElement.clientWidth
}

export class Layout {
  readonly blocks = new Map<string, HTMLElement>()
  private anchors = new Map<string, Anchor>()
  private applied = new Map<string, Offset>()
  private key = `dw-layout:${window.location.pathname}`

  constructor() {
    markClassic()
    for (const el of document.querySelectorAll<HTMLElement>(`[${ATTR}]`)) {
      const id = el.getAttribute(ATTR) as string
      if (!this.blocks.has(id)) {
        this.blocks.set(id, el)
      }
    }
  }

  blockAt(el: Element | null) {
    const block = el?.closest<HTMLElement>(`[${ATTR}]`) ?? null
    return block && this.blocks.get(block.getAttribute(ATTR) as string) === block ? block : null
  }

  active() {
    return !window.matchMedia(NARROW).matches
  }

  offset(el: HTMLElement): Offset {
    return { ...(this.applied.get(el.getAttribute(ATTR) as string) ?? { x: 0, y: 0 }) }
  }

  private mark() {
    document.documentElement.classList.toggle('dw-arranged', this.applied.size > 0)
  }

  place(el: HTMLElement, offset: Offset) {
    const id = el.getAttribute(ATTR) as string
    const x = Math.round(offset.x * 100) / 100
    const y = Math.round(offset.y * 100) / 100
    el.style.transform = x || y ? `translate(${x}px, ${y}px)` : ''
    if (x || y) {
      this.applied.set(id, { x, y })
    } else {
      this.applied.delete(id)
    }
    this.mark()
  }

  private sections() {
    const sections = [...document.querySelectorAll<HTMLElement>('.wp-site-blocks > *')]
    return sections.length ? sections : [document.body]
  }

  private frame(section: HTMLElement): Box {
    const rect = section.getBoundingClientRect()
    const style = getComputedStyle(section)
    let left = rect.left + parseFloat(style.paddingLeft)
    let right = rect.right - parseFloat(style.paddingRight)
    const size = parseFloat(style.getPropertyValue('--wp--style--global--content-size'))
    if (section.classList.contains('is-layout-constrained') && size && right - left > size) {
      const center = (left + right) / 2
      left = center - size / 2
      right = center + size / 2
    }
    return pageBox({ left, right, top: rect.top, bottom: rect.bottom })
  }

  commit(el: HTMLElement, box: Box) {
    const sections = this.sections()
    const centerY = (box.top + box.bottom) / 2
    let index = 0
    let best = Infinity
    sections.forEach((section, i) => {
      const frame = pageBox(section.getBoundingClientRect())
      const distance = centerY < frame.top ? frame.top - centerY : centerY > frame.bottom ? centerY - frame.bottom : 0
      if (distance < best) {
        best = distance
        index = i
      }
    })
    const frame = this.frame(sections[index])
    const width = Math.max(1, frame.right - frame.left)
    this.anchors.set(el.getAttribute(ATTR) as string, {
      s: index,
      x: Math.round((((box.left + box.right) / 2 - frame.left) / width) * 10000) / 10000,
      y: Math.round(box.top - frame.top),
    })
  }

  private leafBoxes(el: HTMLElement) {
    const boxes: Box[] = []
    if (el.matches(SOLID) || hasSurface(el)) {
      const rect = el.getBoundingClientRect()
      if (rect.width && rect.height) {
        boxes.push(pageBox(rect))
      }
      return boxes
    }
    const range = document.createRange()
    range.selectNodeContents(el)
    for (const rect of range.getClientRects()) {
      if (rect.width > 0.5 && rect.height > 0.5) {
        boxes.push(pageBox(rect))
      }
    }
    return boxes
  }

  private leaves(within?: HTMLElement) {
    return [...this.blocks.values()].filter(
      (el) => !el.querySelector(`[${ATTR}]`) && (!within || within.contains(el)),
    )
  }

  ink(el: HTMLElement): Box {
    const boxes = this.leaves(el).flatMap((leaf) => this.leafBoxes(leaf))
    if (!boxes.length) {
      return pageBox(el.getBoundingClientRect())
    }
    return boxes.reduce((all, box) => ({
      left: Math.min(all.left, box.left),
      top: Math.min(all.top, box.top),
      right: Math.max(all.right, box.right),
      bottom: Math.max(all.bottom, box.bottom),
    }))
  }

  obstacles(except: HTMLElement) {
    return this.leaves()
      .filter((el) => !except.contains(el) && !el.contains(except))
      .flatMap((el) => this.leafBoxes(el))
  }

  restore() {
    try {
      const raw = window.localStorage.getItem(this.key)
      const saved = raw ? (JSON.parse(raw) as { v: number; items: Record<string, Anchor> }) : null
      if (saved?.v !== VERSION || !saved.items) {
        return
      }
      for (const [id, anchor] of Object.entries(saved.items)) {
        if (this.blocks.has(id) && Number.isFinite(anchor.s) && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
          this.anchors.set(id, anchor)
        }
      }
    } catch {
      return
    }
  }

  private ordered() {
    const depth = (el: HTMLElement) => {
      let count = 0
      for (let node = el.parentElement; node; node = node.parentElement) {
        count++
      }
      return count
    }
    return [...this.anchors.keys()]
      .map((id) => this.blocks.get(id))
      .filter((el): el is HTMLElement => !!el)
      .sort((a, b) => depth(a) - depth(b))
  }

  apply() {
    for (const id of [...this.applied.keys()]) {
      const el = this.blocks.get(id)
      if (el) {
        el.style.transform = ''
      }
    }
    this.applied.clear()
    this.mark()
    if (!this.active()) {
      return
    }
    const sections = this.sections()
    for (const el of this.ordered()) {
      const anchor = this.anchors.get(el.getAttribute(ATTR) as string) as Anchor
      const section = sections[anchor.s]
      if (!section) {
        continue
      }
      const frame = this.frame(section)
      const ink = this.ink(el)
      this.place(el, {
        x: frame.left + anchor.x * (frame.right - frame.left) - (ink.left + ink.right) / 2,
        y: frame.top + anchor.y - ink.top,
      })
    }
    this.settle()
  }

  private settle() {
    for (const el of this.ordered()) {
      const others = this.obstacles(el)
      const offset = this.offset(el)
      let box = this.ink(el)
      const width = document.documentElement.clientWidth
      const dx = box.right > width ? width - box.right : box.left < 0 ? -box.left : 0
      const dy = box.top < 0 ? -box.top : 0
      box = shift(box, dx, dy)
      let down = 0
      while (overlaps(box, others) && down < 6000) {
        box = shift(box, 0, 12)
        down += 12
      }
      if (dx || dy || down) {
        this.place(el, { x: offset.x + dx, y: offset.y + dy + down })
      }
    }
  }

  changed() {
    return this.active() && this.anchors.size > 0
  }

  save() {
    try {
      if (this.anchors.size) {
        window.localStorage.setItem(this.key, JSON.stringify({ v: VERSION, items: Object.fromEntries(this.anchors) }))
      } else {
        window.localStorage.removeItem(this.key)
      }
    } catch {
      return
    }
  }

  placed() {
    return [...this.applied.keys()].map((id) => this.blocks.get(id)).filter((el): el is HTMLElement => !!el)
  }

  reset() {
    for (const el of this.placed()) {
      this.place(el, { x: 0, y: 0 })
    }
    this.anchors.clear()
    this.save()
  }
}
