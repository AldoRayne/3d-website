import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import type { WorldObject } from '@/types'
import { generateBuilding, seededRandom, specFromSeed } from './buildings'
import { shade, texture } from './textures'
import { VoxelGrid } from './voxels'

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
const ROOM_HEIGHT = 5
const SCALE = 2
const MARGIN = 1.03

export const SHEET_COUNT = SHEET_LIFTS.length
export const PRINT_OPACITY = 0.14

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

function coverTexture(object: WorldObject, width: number, depth: number) {
  const w = 256
  const h = Math.round((w * depth) / width)
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = object.color
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = shade(object.color, -0.18)
    ctx.fillRect(10, 10, w - 20, h - 20)
    ctx.fillStyle = object.color
    ctx.fillRect(18, 18, w - 36, h - 36)
    ctx.fillStyle = '#f7e7b4'
    ctx.fillRect(18, h * 0.3, w - 36, 4)
    ctx.fillRect(18, h * 0.7 - 4, w - 36, 4)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${Math.round(w * 0.11)}px system-ui, sans-serif`
    const lines = wrapLines(ctx, object.title, w - 56, 3)
    const step = w * 0.13
    lines.forEach((text, index) => {
      ctx.fillText(text, w / 2, h / 2 + (index - (lines.length - 1) / 2) * step)
    })
  })
}

function drawTitlePage(object: WorldObject): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = object.color
    ctx.fillRect(w * 0.12, h * 0.16, w * 0.76, Math.max(4, w * 0.016))
    ctx.fillStyle = '#2b2118'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = `700 ${Math.round(w * 0.1)}px Georgia, serif`
    let y = h * 0.22
    for (const line of wrapLines(ctx, object.title, w * 0.76, 3)) {
      ctx.fillText(line, w / 2, y)
      y += w * 0.12
    }
    ctx.fillStyle = '#5b4a39'
    ctx.font = `400 ${Math.round(w * 0.055)}px Georgia, serif`
    y += w * 0.05
    for (const line of wrapLines(ctx, object.description, w * 0.76, 10)) {
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
  private page: CSS3DObject

  constructor(
    private object: WorldObject,
    aspect: number,
    element: HTMLElement,
    pixelHeight: number,
  ) {
    this.spread = aspect >= 1
    const contentWidth = PAGE_HEIGHT * aspect
    const w = this.spread ? contentWidth / 2 : contentWidth
    this.pageWidth = w
    const d = PAGE_HEIGHT
    const paperW = w * MARGIN
    const paperD = d * MARGIN
    const coverW = w * 1.06 + 0.02
    const coverD = d * 1.06 + 0.02

    const coverSide = this.own(new THREE.MeshLambertMaterial({ color: shade(object.color, -0.22) }))
    const coverArt = this.own(new THREE.MeshLambertMaterial({ map: this.own(coverTexture(object, coverW, coverD)) }))
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
      new THREE.MeshLambertMaterial({
        map: texture('paper'),
        blending: THREE.NoBlending,
        premultipliedAlpha: true,
        opacity: PRINT_OPACITY,
      }),
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
      this.setBackPage(drawTitlePage(object))
    }

    this.page = new CSS3DObject(element)
    element.style.pointerEvents = 'none'
    this.page.scale.setScalar(d / pixelHeight)
    this.page.rotation.x = -Math.PI / 2
    this.page.position.set(this.spread ? 0 : w / 2, BLOCK_TOP + 0.001, 0)
    this.group.add(this.page)
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
    this.cover.rotation.z = Math.PI * t
  }

  setSheet(index: number, t: number) {
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
    if (this.spread) {
      this.lastFront.opacity = 1 - t
      this.lastBack.opacity = 1 - t
      this.sheets[this.sheets.length - 1].meshes.forEach((mesh) => (mesh.visible = t < 1))
    }
  }

  setPrint(opacity: number) {
    this.print.opacity = opacity
  }

  contentCenter() {
    return this.group.localToWorld(new THREE.Vector3(this.spread ? 0 : this.pageWidth / 2, BLOCK_TOP + 0.001, 0))
  }

  normal() {
    this.group.updateMatrixWorld()
    return new THREE.Vector3(0, 1, 0).transformDirection(this.group.matrixWorld)
  }

  dispose() {
    this.page.element.remove()
    this.page.removeFromParent()
    this.backTexture?.dispose()
    this.owned.forEach((item) => item.dispose())
  }
}

export class Interior {
  readonly scene = new THREE.Scene()
  readonly entry: THREE.Vector3
  readonly stand: THREE.Vector3
  readonly doorway: THREE.Vector3
  readonly backWall: number
  readonly book: Book
  private owned: Disposable[] = []

  constructor(object: WorldObject, aspect: number, element: HTMLElement, pixelHeight: number) {
    const spec = specFromSeed(object.seed)
    const plan = generateBuilding(object.seed, object.color)
    const outside = new Map(plan.cells.map(([x, y, z, id]) => [`${x},${y},${z}`, id]))
    const rnd = seededRandom((object.seed ^ 0x5bd1e995) >>> 0)
    const pick = <T>(items: readonly T[]) => items[Math.floor(rnd() * items.length)]
    const groundHeight = Math.max(spec.floorHeight, 3)
    const wallX = spec.halfX * SCALE
    const wallZ = spec.halfZ * SCALE
    const hw = wallX - 1
    const dz = wallZ - 1
    const floor = pick(['planks', 'planks', 'stoneBrick', 'stone'])
    const lecternZ = -dz + 1.6
    const accent = `accent:${object.color}`

    const toOutside = (i: number) => Math.sign(i) * Math.floor((Math.abs(i) + 1) / SCALE)
    const rowOutside = (y: number) => Math.min(groundHeight - 1, Math.floor((y * groundHeight) / ROOM_HEIGHT))
    const wallBlock = (x: number, y: number, z: number) =>
      outside.get(`${toOutside(x)},${rowOutside(y)},${toOutside(z)}`) ?? spec.wall

    const radius = Math.max(wallX, wallZ) + 1
    const level = (x: number, z: number) => {
      if (spec.floors > 1) {
        return 0
      }
      switch (spec.roof) {
        case 'gable':
          return Math.floor((wallZ - Math.abs(z)) / SCALE)
        case 'pyramid':
          return Math.floor(Math.min(wallX - Math.abs(x), wallZ - Math.abs(z)) / SCALE)
        case 'dome':
          return Math.floor(Math.sqrt(Math.max(0, radius * radius - x * x - z * z)) / SCALE)
        default:
          return 0
      }
    }
    const ceilingBlock = (height: number) => {
      if (spec.floors > 1) {
        return 'planks'
      }
      switch (spec.roof) {
        case 'flat':
          return spec.wall
        case 'battlement':
          return 'stoneBrick'
        case 'dome':
          return height % 2 ? 'glass' : accent
        default:
          return `roof:${object.color}`
      }
    }

    this.scene.background = new THREE.Color('#9dd4f7')
    this.scene.add(new THREE.HemisphereLight('#fff1dc', '#5a4632', 1.5))
    const fill = new THREE.DirectionalLight('#fff4e0', 0.9)
    fill.position.set(2, 6, 8)
    this.scene.add(fill)

    const grid = new VoxelGrid()
    const isWall = (x: number, z: number) => Math.abs(x) === wallX || Math.abs(z) === wallZ
    for (let x = -wallX; x <= wallX; x++) {
      for (let z = -wallZ; z <= wallZ; z++) {
        grid.set(x, -1, z, floor)
        const own = level(x, z)
        const top = Math.max(
          own,
          ...[
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].map(([dx, dzz]) => (Math.abs(x + dx) <= wallX && Math.abs(z + dzz) <= wallZ ? level(x + dx, z + dzz) : own)),
        )
        for (let h = own; h <= top; h++) {
          grid.set(x, ROOM_HEIGHT + h, z, ceilingBlock(h))
        }
        if (isWall(x, z)) {
          for (let y = 0; y < ROOM_HEIGHT + own; y++) {
            grid.set(x, y, z, y < ROOM_HEIGHT ? wallBlock(x, y, z) : spec.wall)
          }
        }
      }
    }
    grid.delete(0, 0, wallZ)
    grid.delete(0, 1, wallZ)

    const stairsSide = spec.floors > 1 ? pick([-1, 1]) : 0
    if (stairsSide) {
      const x = stairsSide * hw
      for (let k = 0; k < ROOM_HEIGHT; k++) {
        const z = dz - 1 - k
        for (let y = 0; y <= k; y++) {
          grid.set(x, y, z, 'planks')
        }
        if (k >= ROOM_HEIGHT - 2) {
          grid.delete(x, ROOM_HEIGHT, z)
          grid.set(x, ROOM_HEIGHT + 1, z, 'planks')
        }
      }
    }

    const fireplace = spec.extra === 'chimney' ? Math.min(hw - 1, wallX - 2) : null
    if (fireplace !== null) {
      for (let x = fireplace - 1; x <= fireplace + 1; x++) {
        for (let y = 0; y < 3; y++) {
          grid.set(x, y, -dz, 'stoneBrick')
        }
      }
      for (let y = 3; y < ROOM_HEIGHT; y++) {
        grid.set(fireplace, y, -dz, 'stoneBrick')
      }
      grid.delete(fireplace, 0, -dz)
      const fire = new THREE.Mesh(
        this.own(new THREE.BoxGeometry(0.6, 0.45, 0.4)),
        this.own(new THREE.MeshBasicMaterial({ color: '#ff9a3c' })),
      )
      fire.position.set(fireplace, 0.25, -dz - 0.05)
      const flame = new THREE.PointLight('#ff8a3c', 6, 8, 1.6)
      flame.position.set(fireplace, 0.8, -dz + 0.8)
      this.scene.add(fire, flame)
    }

    for (const side of [-1, 1]) {
      const glassAt = (x: number, y: number, z: number) => grid.get(x, y, z) === 'glass'
      for (const z of [-1, 0, -2, 1]) {
        if (!glassAt(side * wallX, 3, z) && !(stairsSide === side && z > dz - 1 - ROOM_HEIGHT)) {
          grid.set(side * wallX, 3, z, 'lamp')
          break
        }
      }
      if (fireplace === null || Math.sign(fireplace) !== side) {
        for (let x = 2; x <= hw; x++) {
          const rows = [0, 1, 2, 3].some((y) => glassAt(side * x, y, -wallZ)) ? 2 : 3
          for (let y = 0; y < rows; y++) {
            grid.set(side * x, y, -dz, 'shelf')
          }
        }
      }
      if (stairsSide === side) {
        continue
      }
      const furnish = pick(['shelves', 'barrels', 'plants', 'crates'])
      for (const z of [-dz + 2, dz - 2]) {
        const x = side * hw
        if (furnish === 'shelves') {
          grid.set(x, 0, z, 'shelf')
          grid.set(x, 1, z, 'shelf')
        } else if (furnish === 'barrels') {
          grid.set(x, 0, z, 'log')
        } else if (furnish === 'plants') {
          grid.set(x, 0, z, 'planks')
          grid.set(x, 1, z, 'leaves')
        } else {
          grid.set(x, 0, z, 'planks')
          grid.set(x, 1, z, 'planks')
        }
      }
    }
    const lampY = ROOM_HEIGHT - 1 + level(0, -dz + 1)
    grid.set(0, lampY, -dz + 1, 'lamp')
    this.scene.add(grid.build({ shadows: false }))

    for (const [x, y, z, intensity] of [
      [0, lampY - 0.4, lecternZ + 0.4, 9],
      [-hw + 0.2, 3.5, -1, 5],
      [hw - 0.2, 3.5, -1, 5],
    ]) {
      const light = new THREE.PointLight('#ffcf8a', intensity, 14, 1.6)
      light.position.set(x, y, z)
      this.scene.add(light)
    }

    const glow = new THREE.Mesh(
      this.own(new THREE.PlaneGeometry(1, 2)),
      this.own(new THREE.MeshBasicMaterial({ color: '#fff4cf', fog: false })),
    )
    glow.position.set(0, 1, wallZ + 0.45)
    glow.rotation.y = Math.PI
    this.scene.add(glow)

    const pivot = new THREE.Group()
    pivot.position.set(-0.5, 0, wallZ - 0.57)
    pivot.rotation.y = 1.75
    const plank = this.own(new THREE.MeshLambertMaterial({ map: texture('door') }))
    for (const [y, name] of [
      [0.5, 'doorBottom'],
      [1.5, 'doorTop'],
    ] as const) {
      const side = this.own(new THREE.MeshLambertMaterial({ map: texture(name) }))
      const leaf = new THREE.Mesh(this.own(new THREE.BoxGeometry(0.98, 1, 0.12)), [plank, plank, plank, plank, side, side])
      leaf.position.set(0.5, y, 0)
      pivot.add(leaf)
    }
    this.scene.add(pivot)

    const carpetLength = wallZ - 0.5 - (lecternZ - 0.4)
    const carpetTexture = this.own(texture('accent', object.color).clone())
    carpetTexture.wrapS = THREE.RepeatWrapping
    carpetTexture.wrapT = THREE.RepeatWrapping
    carpetTexture.repeat.set(2, Math.round(carpetLength))
    carpetTexture.needsUpdate = true
    const carpet = new THREE.Mesh(
      this.own(new THREE.PlaneGeometry(2, carpetLength)),
      this.own(new THREE.MeshLambertMaterial({ map: carpetTexture })),
    )
    carpet.rotation.x = -Math.PI / 2
    carpet.position.set(0, 0.012, wallZ - 0.5 - carpetLength / 2)
    this.scene.add(carpet)

    this.book = new Book(object, aspect, element, pixelHeight)
    const boardWidth = this.book.pageWidth * 2.12 + 0.14
    const boardDepth = PAGE_HEIGHT * 1.06 + 0.14
    const wood = this.own(new THREE.MeshLambertMaterial({ map: texture('planks') }))
    const log = this.own(new THREE.MeshLambertMaterial({ map: texture('logSide') }))
    const lectern = new THREE.Group()
    lectern.position.set(0, 0, lecternZ)
    const base = new THREE.Mesh(this.own(new THREE.BoxGeometry(0.8, 0.12, 0.6)), wood)
    base.position.y = 0.06
    const post = new THREE.Mesh(this.own(new THREE.BoxGeometry(0.24, 0.86, 0.24)), log)
    post.position.y = 0.55
    const top = new THREE.Group()
    top.position.y = 1.02
    top.rotation.x = BOOK_TILT
    const board = new THREE.Mesh(this.own(new THREE.BoxGeometry(boardWidth, 0.06, boardDepth)), wood)
    board.position.y = -0.03
    const lip = new THREE.Mesh(this.own(new THREE.BoxGeometry(boardWidth, 0.06, 0.05)), wood)
    lip.position.set(0, 0.02, boardDepth / 2 - 0.025)
    top.add(board, lip, this.book.group)
    this.book.group.position.y = 0.002
    lectern.add(base, post, top)
    this.scene.add(lectern)
    this.scene.updateMatrixWorld(true)

    this.entry = new THREE.Vector3(0, 0, wallZ - 1.1)
    this.stand = new THREE.Vector3(0, 0, lecternZ + 0.95)
    this.doorway = new THREE.Vector3(0, 1.45, wallZ + 0.2)
    this.backWall = wallZ - 0.7
  }

  private own<T extends Disposable>(item: T) {
    this.owned.push(item)
    return item
  }

  dispose() {
    this.book.dispose()
    this.scene.traverse((node) => (node as THREE.Mesh).geometry?.dispose())
    this.owned.forEach((item) => item.dispose())
  }
}
