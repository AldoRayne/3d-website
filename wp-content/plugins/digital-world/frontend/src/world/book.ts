import gsap from 'gsap'
import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { shade, texture } from './textures'

const PAPER = '#f4ecd9'
const PAGE_HEIGHT = 0.62
const BOOK_TILT = 0.38
const BLOCK_TOP = 0.085
const SEGMENTS = 24
const ROWS = 8
const CORNER_LEAD = 0.3
const CURL = 2.8
const SHADOW = 0.38
const SHEET_LIFTS = [0.009, 0.006, 0.003]
const MARGIN = 1.03
const SHEET_START = 0.5
const SHEET_STEP = 0.32
const SHEET_DURATION = 0.85
const LAST_SHEET = SHEET_START + (SHEET_LIFTS.length - 1) * SHEET_STEP

export const PRINT_OPACITY = 0.14
export const BOOK_SETTLED = LAST_SHEET + 1.35

export interface BookContent {
  title: string
  color: string
  description?: string
}

export interface LivePage {
  element: HTMLElement
  pixelHeight: number
}

export interface BookOptions {
  content: BookContent
  aspect: number
  live?: LivePage
  blank?: boolean
}

type Disposable = { dispose(): void }
type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d') as CanvasRenderingContext2D)
  const result = new THREE.CanvasTexture(canvas)
  result.colorSpace = THREE.SRGBColorSpace
  result.anisotropy = 4
  return result
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) {
    lines.push(line)
  }
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}…`
  }
  return lines
}

function coverTexture(content: BookContent, width: number, depth: number) {
  const w = 256
  const h = Math.round((w * depth) / width)
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = content.color
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = shade(content.color, -0.18)
    ctx.fillRect(10, 10, w - 20, h - 20)
    ctx.fillStyle = content.color
    ctx.fillRect(18, 18, w - 36, h - 36)
    ctx.fillStyle = '#f7e7b4'
    ctx.fillRect(18, h * 0.3, w - 36, 4)
    ctx.fillRect(18, h * 0.7 - 4, w - 36, 4)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${Math.round(w * 0.11)}px system-ui, sans-serif`
    const lines = wrapLines(ctx, content.title, w - 56, 3)
    const step = w * 0.13
    lines.forEach((text, index) => {
      ctx.fillText(text, w / 2, h / 2 + (index - (lines.length - 1) / 2) * step)
    })
  })
}

function drawTitlePage(content: BookContent): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = content.color
    ctx.fillRect(w * 0.12, h * 0.16, w * 0.76, Math.max(4, w * 0.016))
    ctx.fillStyle = '#2b2118'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = `700 ${Math.round(w * 0.1)}px Georgia, serif`
    let y = h * 0.22
    for (const line of wrapLines(ctx, content.title, w * 0.76, 3)) {
      ctx.fillText(line, w / 2, y)
      y += w * 0.12
    }
    ctx.fillStyle = '#5b4a39'
    ctx.font = `400 ${Math.round(w * 0.055)}px Georgia, serif`
    y += w * 0.05
    for (const line of wrapLines(ctx, content.description ?? '', w * 0.76, 10)) {
      ctx.fillText(line, w / 2, y)
      y += w * 0.075
    }
  }
}

export async function snapshotPage(frame: HTMLIFrameElement, width: number, height: number) {
  const root = frame.contentDocument?.documentElement
  if (!root) {
    return null
  }
  const { domToCanvas } = await import('modern-screenshot')
  return domToCanvas(root, { width, height, scale: Math.min(1, 900 / width), backgroundColor: '#ffffff', timeout: 2000 })
}

export class Book {
  readonly group = new THREE.Group()
  readonly pageWidth: number
  readonly pageHeight = PAGE_HEIGHT
  readonly spread: boolean
  private cover = new THREE.Group()
  private sheets: Array<{ geometry: THREE.PlaneGeometry; lift: number; meshes: THREE.Mesh[]; shadows: THREE.Mesh[] }> = []
  private leftPrint: THREE.Mesh | null = null
  private print: THREE.MeshLambertMaterial
  private lastFront: THREE.MeshLambertMaterial
  private lastBack: THREE.MeshLambertMaterial
  private backTexture: THREE.CanvasTexture | null = null
  private owned: Disposable[] = []
  private page: CSS3DObject | null = null
  private state = { cover: 0, sheets: SHEET_LIFTS.map(() => 0), reveal: 0 }

  constructor({ content, aspect, live, blank }: BookOptions) {
    this.spread = aspect >= 1
    const contentWidth = PAGE_HEIGHT * aspect
    const w = this.spread ? contentWidth / 2 : contentWidth
    this.pageWidth = w
    const d = PAGE_HEIGHT
    const paperW = w * MARGIN
    const paperD = d * MARGIN
    const coverW = w * 1.06 + 0.02
    const coverD = d * 1.06 + 0.02

    const coverSide = this.own(new THREE.MeshLambertMaterial({ color: shade(content.color, -0.22) }))
    const coverArt = this.own(new THREE.MeshLambertMaterial({ map: this.own(coverTexture(content, coverW, coverD)) }))
    const paper = this.own(new THREE.MeshLambertMaterial({ map: texture('paper') }))
    const edge = this.own(new THREE.MeshLambertMaterial({ map: texture('pageEdge') }))
    const box = (width: number, height: number, depth: number, materials: THREE.Material | THREE.Material[]) =>
      new THREE.Mesh(this.own(new THREE.BoxGeometry(width, height, depth)), materials)

    const back = box(coverW, 0.025, coverD, coverSide)
    back.position.set(coverW / 2 - 0.015, 0.0125, 0)
    const block = box(paperW, 0.06, paperD, [edge, edge, paper, paper, edge, edge])
    block.position.set(paperW / 2, 0.055, 0)
    this.group.add(back, block)

    this.cover.position.set(0, BLOCK_TOP, 0)
    const leftBlock = box(paperW, 0.048, paperD, [edge, edge, paper, paper, edge, edge])
    leftBlock.position.set(paperW / 2, 0.036, 0)
    const board = box(coverW, 0.025, coverD, [coverSide, coverSide, coverArt, coverSide, coverSide, coverSide])
    board.position.set(coverW / 2 - 0.015, 0.0725, 0)
    this.cover.add(leftBlock, board)
    this.group.add(this.cover)

    const sheetFront = this.own(new THREE.MeshLambertMaterial({ map: texture('paper') }))
    const sheetBack = this.own(new THREE.MeshLambertMaterial({ map: texture('paper'), side: THREE.BackSide }))
    this.lastFront = this.own(new THREE.MeshLambertMaterial({ map: texture('paper'), transparent: true }))
    this.lastBack = this.own(new THREE.MeshLambertMaterial({ map: texture('paper'), side: THREE.BackSide, transparent: true }))
    const shadowMap = this.own(
      canvasTexture(64, 1, (ctx) => {
        const gradient = ctx.createLinearGradient(0, 0, 64, 0)
        gradient.addColorStop(0, '#999')
        gradient.addColorStop(0.55, '#fff')
        gradient.addColorStop(1, '#000')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 64, 1)
      }),
    )
    const shadowPlane = this.own(new THREE.PlaneGeometry(1, paperD).rotateX(-Math.PI / 2).translate(0.5, 0, 0))
    SHEET_LIFTS.forEach((lift, index) => {
      const last = index === SHEET_LIFTS.length - 1
      const geometry = this.own(new THREE.PlaneGeometry(paperW, paperD, SEGMENTS, ROWS))
      const meshes = [last ? this.lastFront : sheetFront, last ? this.lastBack : sheetBack].map((material) => {
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(0, BLOCK_TOP, 0)
        mesh.frustumCulled = false
        this.group.add(mesh)
        return mesh
      })
      const below = [SHEET_LIFTS[index + 1] ?? 0.001, -(SHEET_LIFTS[index - 1] ?? 0.012)]
      const shadows = below.map((height) => {
        const shadow = new THREE.Mesh(
          shadowPlane,
          this.own(new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: shadowMap, transparent: true, depthWrite: false, opacity: 0 })),
        )
        shadow.position.set(0, BLOCK_TOP + height + 0.0007, 0)
        shadow.visible = false
        this.group.add(shadow)
        return shadow
      })
      this.sheets.push({ geometry, lift, meshes, shadows })
    })
    this.sheets.forEach((_, index) => this.setSheet(index, 0))

    this.print = this.own(
      live
        ? new THREE.MeshLambertMaterial({
            map: texture('paper'),
            blending: THREE.NoBlending,
            premultipliedAlpha: true,
            opacity: PRINT_OPACITY,
          })
        : new THREE.MeshLambertMaterial({ map: texture(blank ? 'blankPaper' : 'paper') }),
    )
    const plane = this.own(new THREE.PlaneGeometry(w, d))
    const right = new THREE.Mesh(plane, this.print)
    right.rotation.x = -Math.PI / 2
    right.position.set(w / 2, BLOCK_TOP + 0.001, 0)
    this.group.add(right)
    if (this.spread) {
      this.leftPrint = new THREE.Mesh(plane, this.print)
      this.leftPrint.rotation.x = -Math.PI / 2
      this.leftPrint.position.set(-w / 2, BLOCK_TOP - 0.0105, 0)
      this.leftPrint.visible = false
      this.group.add(this.leftPrint)
    } else {
      this.setBackPage(drawTitlePage(content))
    }

    if (live) {
      this.page = new CSS3DObject(live.element)
      live.element.style.pointerEvents = 'none'
      this.page.scale.setScalar(d / live.pixelHeight)
      this.page.rotation.x = -Math.PI / 2
      this.page.position.set(this.spread ? 0 : w / 2, BLOCK_TOP + 0.001, 0)
      this.group.add(this.page)
    }
  }

  private own<T extends Disposable>(item: T) {
    this.owned.push(item)
    return item
  }

  private setBackPage(draw: Draw) {
    const sheetW = this.pageWidth * MARGIN
    const sheetD = this.pageHeight * MARGIN
    const height = 1024
    const scale = height / sheetD
    const width = Math.round(sheetW * scale)
    const result = canvasTexture(width, height, (ctx) => {
      ctx.fillStyle = PAPER
      ctx.fillRect(0, 0, width, height)
      const x = (sheetW - this.pageWidth) * scale
      const y = ((sheetD - this.pageHeight) / 2) * scale
      ctx.save()
      ctx.translate(x, y)
      draw(ctx, this.pageWidth * scale, this.pageHeight * scale)
      ctx.restore()
    })
    result.repeat.x = -1
    result.offset.x = 1
    this.backTexture?.dispose()
    this.backTexture = result
    this.lastBack.map = result
    this.lastBack.needsUpdate = true
  }

  setPageImage(image: HTMLCanvasElement) {
    if (!this.spread) {
      return
    }
    this.setBackPage((ctx, w, h) => {
      ctx.drawImage(image, 0, 0, image.width / 2, image.height, 0, 0, w, h)
    })
  }

  setCover(t: number) {
    this.state.cover = t
    this.cover.rotation.z = Math.PI * t
  }

  setSheet(index: number, t: number) {
    this.state.sheets[index] = t
    const { geometry, lift, shadows } = this.sheets[index]
    const width = this.pageWidth * MARGIN
    const depth = this.pageHeight * MARGIN
    const step = width / SEGMENTS
    const position = geometry.attributes.position as THREE.BufferAttribute
    const sides = [
      { extent: 0, height: 0, count: 0 },
      { extent: 0, height: 0, count: 0 },
    ]
    for (let row = 0; row <= ROWS; row++) {
      const v = row / ROWS
      const local = THREE.MathUtils.clamp(t * (1 + CORNER_LEAD) - CORNER_LEAD * (1 - v), 0, 1)
      const theta = Math.PI * THREE.MathUtils.smoothstep(local, 0.08, 1)
      const direction = 1 - 1.8 * THREE.MathUtils.smoothstep(local, 0.3, 0.75)
      const bend = CURL * Math.sin(Math.PI * local) * direction
      const z = (v - 0.5) * depth
      let x = -lift * Math.sin(theta)
      let y = lift * Math.cos(theta)
      position.setXYZ(row * (SEGMENTS + 1), x, y, z)
      for (let i = 0; i < SEGMENTS; i++) {
        const along = (i + 0.5) / SEGMENTS
        const phi = theta + bend * along * along
        x += step * Math.cos(phi)
        y += step * Math.sin(phi)
        position.setXYZ(row * (SEGMENTS + 1) + i + 1, x, y, z)
        const side = sides[x >= 0 ? 0 : 1]
        side.extent = Math.max(side.extent, Math.min(width, Math.abs(x)))
        side.height += y
        side.count++
      }
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    const moving = t > 0 && t < 1
    shadows.forEach((shadow, side) => {
      const { extent, height, count } = sides[side]
      const strength = moving && count ? THREE.MathUtils.clamp(height / count / 0.1, 0, 1) : 0
      shadow.visible = strength > 0.01 && extent > 0.01
      shadow.scale.x = side === 0 ? extent : -extent
      ;(shadow.material as THREE.MeshBasicMaterial).opacity = SHADOW * strength
    })

    if (index === this.sheets.length - 1) {
      const landed = t >= 1
      this.sheets.slice(0, -1).forEach((sheet) => sheet.meshes.forEach((mesh) => (mesh.visible = !landed)))
      if (this.leftPrint) {
        this.leftPrint.visible = landed
      }
    }
  }

  setReveal(t: number) {
    this.state.reveal = t
    if (this.spread) {
      this.lastFront.opacity = 1 - t
      this.lastBack.opacity = 1 - t
      this.sheets[this.sheets.length - 1].meshes.forEach((mesh) => (mesh.visible = t < 1))
    }
  }

  setPrint(opacity: number) {
    if (this.page) {
      this.print.opacity = opacity
    }
  }

  openTimeline() {
    const tl = gsap.timeline()
    const state = { cover: this.state.cover, reveal: this.state.reveal }
    tl.to(state, { cover: 1, duration: 0.75, ease: 'power2.inOut', onUpdate: () => this.setCover(state.cover) }, 0)
    this.state.sheets.forEach((t, index) => {
      const sheet = { t }
      tl.to(
        sheet,
        { t: 1, duration: SHEET_DURATION, ease: 'sine.inOut', onUpdate: () => this.setSheet(index, sheet.t) },
        SHEET_START + index * SHEET_STEP,
      )
    })
    tl.to(state, { reveal: 1, duration: 0.45, ease: 'power1.inOut', onUpdate: () => this.setReveal(state.reveal) }, LAST_SHEET + 0.9)
    return tl
  }

  closeTimeline() {
    const tl = gsap.timeline()
    const state = { cover: this.state.cover, reveal: this.state.reveal }
    tl.to(state, { reveal: 0, duration: 0.3, ease: 'power1.inOut', onUpdate: () => this.setReveal(state.reveal) }, 0)
    const last = this.state.sheets.length - 1
    this.state.sheets.forEach((t, index) => {
      const sheet = { t }
      tl.to(
        sheet,
        { t: 0, duration: SHEET_DURATION * 0.8, ease: 'sine.inOut', onUpdate: () => this.setSheet(index, sheet.t) },
        0.25 + (last - index) * SHEET_STEP * 0.8,
      )
    })
    tl.to(
      state,
      { cover: 0, duration: 0.7, ease: 'power2.inOut', onUpdate: () => this.setCover(state.cover) },
      0.25 + last * SHEET_STEP * 0.8 + SHEET_DURATION * 0.5,
    )
    return tl
  }

  pageCorners(part: 'spread' | 'left' | 'right') {
    const w = this.pageWidth
    const d = this.pageHeight
    const [minX, maxX] = part === 'spread' ? [-w, w] : part === 'left' ? [-w, 0] : [0, w]
    const y = BLOCK_TOP + 0.001
    this.group.updateMatrixWorld()
    return [
      [minX, -d / 2],
      [maxX, -d / 2],
      [maxX, d / 2],
      [minX, d / 2],
    ].map(([x, z]) => this.group.localToWorld(new THREE.Vector3(x, y, z)))
  }

  contentCenter() {
    return this.group.localToWorld(new THREE.Vector3(this.spread ? 0 : this.pageWidth / 2, BLOCK_TOP + 0.001, 0))
  }

  normal() {
    this.group.updateMatrixWorld()
    return new THREE.Vector3(0, 1, 0).transformDirection(this.group.matrixWorld)
  }

  dispose() {
    this.page?.element.remove()
    this.page?.removeFromParent()
    this.backTexture?.dispose()
    this.owned.forEach((item) => item.dispose())
  }
}

export class Lectern {
  readonly group = new THREE.Group()
  private owned: Disposable[] = []

  constructor(book: Book) {
    const boardWidth = book.pageWidth * 2.12 + 0.14
    const boardDepth = PAGE_HEIGHT * 1.06 + 0.14
    const wood = this.own(new THREE.MeshLambertMaterial({ map: texture('planks') }))
    const log = this.own(new THREE.MeshLambertMaterial({ map: texture('logSide') }))
    const box = (width: number, height: number, depth: number, material: THREE.Material) =>
      new THREE.Mesh(this.own(new THREE.BoxGeometry(width, height, depth)), material)
    const base = box(0.8, 0.12, 0.6, wood)
    base.position.y = 0.06
    const post = box(0.24, 0.86, 0.24, log)
    post.position.y = 0.55
    const top = new THREE.Group()
    top.position.y = 1.02
    top.rotation.x = BOOK_TILT
    const board = box(boardWidth, 0.06, boardDepth, wood)
    board.position.y = -0.03
    const lip = box(boardWidth, 0.06, 0.05, wood)
    lip.position.set(0, 0.02, boardDepth / 2 - 0.025)
    top.add(board, lip, book.group)
    book.group.position.y = 0.002
    this.group.add(base, post, top)
  }

  private own<T extends Disposable>(item: T) {
    this.owned.push(item)
    return item
  }

  dispose() {
    this.group.removeFromParent()
    this.owned.forEach((item) => item.dispose())
  }
}
