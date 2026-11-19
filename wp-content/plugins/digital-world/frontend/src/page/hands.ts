type Paint = 'skin' | 'cuff' | 'line'
type Part = [x: number, y: number, width: number, height: number, paint: Paint]

interface Shape {
  parts: Part[]
  hotspot: [number, number]
  fallback: string
}

const SIZE = 16
const SCALE = 2
const COLORS = {
  skin: '#efc29a',
  skinShade: '#d9a27a',
  line: '#b97f57',
  cuff: '#e07a3c',
  cuffShade: '#b85e2a',
  outline: '#3b2a1e',
}

const SHAPES: Record<'open' | 'point' | 'grab', Shape> = {
  open: {
    parts: [
      [3, 3, 2, 5, 'skin'],
      [6, 2, 2, 6, 'skin'],
      [9, 3, 2, 5, 'skin'],
      [12, 4, 2, 4, 'skin'],
      [3, 8, 11, 5, 'skin'],
      [1, 7, 2, 4, 'skin'],
      [3, 13, 11, 3, 'cuff'],
    ],
    hotspot: [7, 2],
    fallback: 'grab',
  },
  point: {
    parts: [
      [5, 1, 2, 7, 'skin'],
      [7, 6, 6, 3, 'skin'],
      [4, 8, 9, 5, 'skin'],
      [2, 8, 2, 3, 'skin'],
      [8, 6, 1, 2, 'line'],
      [10, 6, 1, 2, 'line'],
      [4, 13, 9, 3, 'cuff'],
    ],
    hotspot: [5, 1],
    fallback: 'pointer',
  },
  grab: {
    parts: [
      [3, 5, 10, 3, 'skin'],
      [3, 8, 10, 5, 'skin'],
      [1, 7, 2, 3, 'skin'],
      [5, 5, 1, 2, 'line'],
      [8, 5, 1, 2, 'line'],
      [11, 5, 1, 2, 'line'],
      [4, 8, 8, 1, 'line'],
      [3, 13, 10, 3, 'cuff'],
    ],
    hotspot: [8, 8],
    fallback: 'grabbing',
  },
}

function paint(shape: Shape) {
  const grid: Array<Paint | null> = new Array(SIZE * SIZE).fill(null)
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? null : grid[y * SIZE + x])
  for (const [x0, y0, width, height, kind] of shape.parts) {
    for (let y = y0; y < y0 + height; y++) {
      for (let x = x0; x < x0 + width; x++) {
        grid[y * SIZE + x] = kind
      }
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = SIZE * SCALE
  canvas.height = SIZE * SCALE
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const kind = at(x, y)
      let color: string | null = null
      if (kind) {
        const edge = !at(x + 1, y) || !at(x, y + 1)
        color = kind === 'line' ? COLORS.line : kind === 'cuff' ? (edge ? COLORS.cuffShade : COLORS.cuff) : edge ? COLORS.skinShade : COLORS.skin
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        color = COLORS.outline
      }
      if (color) {
        ctx.fillStyle = color
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE)
      }
    }
  }
  const [hx, hy] = shape.hotspot
  return `url("${canvas.toDataURL('image/png')}") ${hx * SCALE} ${hy * SCALE}, ${shape.fallback}`
}

export function installHands(root: HTMLElement) {
  for (const [name, shape] of Object.entries(SHAPES)) {
    root.style.setProperty(`--dw-hand-${name}`, paint(shape))
  }
  root.classList.add('dw-hands')
}
