import type { Blueprint, Cell } from './buildings'

interface Swatch {
  top: string
  side: string
  alpha?: number
}

const BASE: Record<string, Swatch> = {
  grass: { top: '#6aaa4f', side: '#86593a' },
  path: { top: '#d6c497', side: '#86593a' },
  planks: { top: '#c99a62', side: '#c99a62' },
  log: { top: '#b8915e', side: '#5c4029' },
  stone: { top: '#8b8d91', side: '#8b8d91' },
  stoneBrick: { top: '#9a9ca0', side: '#9a9ca0' },
  brick: { top: '#b4553f', side: '#b4553f' },
  plaster: { top: '#ece7dc', side: '#ece7dc' },
  glass: { top: '#bfe3f2', side: '#bfe3f2', alpha: 0.6 },
  lamp: { top: '#ffe38a', side: '#ffd766' },
  door: { top: '#a06f3e', side: '#a06f3e' },
}

function adjust(hex: string, factor: number) {
  const value = parseInt(hex.slice(1), 16)
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)))
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`
}

function swatch(id: string): Swatch {
  const [kind, color] = id.split(':')
  if (kind === 'accent' && color) {
    return { top: color, side: color }
  }
  if (kind === 'roof' && color) {
    const dark = adjust(color, 0.82)
    return { top: dark, side: dark }
  }
  return BASE[kind] ?? { top: '#999999', side: '#999999' }
}

const C = Math.cos(Math.PI / 6)

function project(x: number, y: number, z: number): [number, number] {
  return [(x - z) * C, (x + z) * 0.5 - y]
}

export function drawBuildingPreview(canvas: HTMLCanvasElement, plan: Blueprint) {
  const cells: Cell[] = [...plan.cells]
  const occupied = new Map<string, string>()
  const add = (x: number, y: number, z: number, id: string) => {
    cells.push([x, y, z, id])
    occupied.set(`${x},${y},${z}`, id)
  }
  for (const [x, y, z, id] of plan.cells) {
    occupied.set(`${x},${y},${z}`, id)
  }
  add(0, 0, plan.halfZ, 'door')
  add(0, 1, plan.halfZ, 'door')
  for (let x = -plan.halfX - 1; x <= plan.halfX + 1; x++) {
    for (let z = -plan.halfZ - 1; z <= plan.halfZ + 3; z++) {
      add(x, -1, z, x === 0 && z > plan.halfZ ? 'path' : 'grass')
    }
  }

  const solid = (x: number, y: number, z: number) => {
    const id = occupied.get(`${x},${y},${z}`)
    return !!id && !id.startsWith('glass')
  }

  type Face = { points: Array<[number, number]>; fill: string; alpha: number }
  const faces: Face[] = []
  cells.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]) || a[1] - b[1])
  for (const [x, y, z, id] of cells) {
    const tone = swatch(id)
    const alpha = tone.alpha ?? 1
    const x0 = x - 0.5
    const x1 = x + 0.5
    const z0 = z - 0.5
    const z1 = z + 0.5
    const y0 = y
    const y1 = y + 1
    if (!solid(x, y + 1, z)) {
      faces.push({ points: [project(x0, y1, z0), project(x1, y1, z0), project(x1, y1, z1), project(x0, y1, z1)], fill: tone.top, alpha })
    }
    if (!solid(x, y, z + 1)) {
      faces.push({
        points: [project(x0, y1, z1), project(x1, y1, z1), project(x1, y0, z1), project(x0, y0, z1)],
        fill: adjust(tone.side, 0.86),
        alpha,
      })
    }
    if (!solid(x + 1, y, z)) {
      faces.push({
        points: [project(x1, y1, z1), project(x1, y1, z0), project(x1, y0, z0), project(x1, y0, z1)],
        fill: adjust(tone.side, 0.68),
        alpha,
      })
    }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const face of faces) {
    for (const [px, py] of face.points) {
      minX = Math.min(minX, px)
      maxX = Math.max(maxX, px)
      minY = Math.min(minY, py)
      maxY = Math.max(maxY, py)
    }
  }

  const ratio = window.devicePixelRatio || 1
  const width = canvas.clientWidth || canvas.width
  const height = canvas.clientHeight || canvas.height
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const padding = 12
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY))
  const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale
  const offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale

  ctx.lineJoin = 'round'
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
  for (const face of faces) {
    ctx.beginPath()
    face.points.forEach(([px, py], index) => {
      const sx = offsetX + px * scale
      const sy = offsetY + py * scale
      if (index === 0) {
        ctx.moveTo(sx, sy)
      } else {
        ctx.lineTo(sx, sy)
      }
    })
    ctx.closePath()
    ctx.globalAlpha = face.alpha
    ctx.fillStyle = face.fill
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.stroke()
  }
}
