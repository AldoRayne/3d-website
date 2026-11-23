<script setup lang="ts">
import { computed } from 'vue'
import type { ScreenPoint, ScreenRect, StandLayout } from '@/world/WorldScene'

const props = defineProps<{ layout: StandLayout; passthrough?: boolean; printLeft?: boolean }>()

const PRINT_WIDTH = 480

function homography([p0, p1, p2, p3]: ScreenPoint[], width: number, height: number) {
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const sx = p0.x - p1.x + p2.x - p3.x
  const sy = p0.y - p1.y + p2.y - p3.y
  const det = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / det
  const h = (dx1 * sy - sx * dy1) / det
  const a = p1.x - p0.x + g * p1.x
  const b = p3.x - p0.x + h * p3.x
  const d = p1.y - p0.y + g * p1.y
  const e = p3.y - p0.y + h * p3.y
  return [a / width, d / width, 0, g / width, b / height, e / height, 0, h / height, 0, 0, 1, 0, p0.x, p0.y, 0, 1]
}

const leftStyle = computed(() => {
  const { left, leftQuad, pageAspect } = props.layout
  if (props.printLeft && leftQuad) {
    const height = PRINT_WIDTH * pageAspect
    return {
      left: '0px',
      top: '0px',
      width: `${PRINT_WIDTH}px`,
      height: `${height}px`,
      transformOrigin: '0 0',
      transform: `matrix3d(${homography(leftQuad, PRINT_WIDTH, height).join(',')})`,
      animation: 'none',
    }
  }
  return left ? box(left) : {}
})
const emit = defineEmits<{ close: [] }>()

const box = (rect: ScreenRect) => ({
  left: `${rect.x}px`,
  top: `${rect.y}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
})

const EDGE = 52
const CLOSE_GAP = 28

type Point = ScreenPoint

const add = (a: Point, b: Point, scale = 1) => ({ x: a.x + b.x * scale, y: a.y + b.y * scale })
const lerp = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const away = (from: Point, to: Point) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

function closePoint([topLeft, corner, bottomRight]: ScreenPoint[]): ScreenPoint {
  const maxX = window.innerWidth - EDGE
  const maxY = window.innerHeight - EDGE
  const inside = (point: Point) => point.x >= EDGE && point.x <= maxX && point.y >= EDGE && point.y <= maxY
  const outward = away(topLeft, corner)
  const upward = away(bottomRight, corner)
  const atCorner = add(add(corner, outward, CLOSE_GAP), upward, CLOSE_GAP)
  if (inside(atCorner)) {
    return atCorner
  }
  const slide = (end: Point, normal: Point) => {
    const at = (t: number) => add(lerp(corner, end, t), normal, CLOSE_GAP)
    if (!inside(at(1))) {
      return null
    }
    let low = 0
    let high = 1
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2
      if (inside(at(mid))) {
        high = mid
      } else {
        low = mid
      }
    }
    return at(high)
  }
  const along = slide(topLeft, upward) ?? slide(bottomRight, outward)
  if (along) {
    return along
  }
  const clamp = (value: number, max: number) => Math.min(Math.max(value, EDGE), max)
  return { x: clamp(atCorner.x, maxX), y: clamp(atCorner.y, maxY) }
}

const closeStyle = computed(() => {
  const point = closePoint(props.layout.rightQuad)
  return { left: `${point.x}px`, top: `${point.y}px` }
})
</script>

<template>
  <div class="dw-guestbook" role="dialog" aria-modal="true" aria-label="Книга гостей">
    <section v-if="layout.left" class="dw-guestbook__page" :class="{ 'is-passthrough': passthrough }" :style="leftStyle">
      <slot name="left" />
    </section>
    <section class="dw-guestbook__page" :class="{ 'is-passthrough': passthrough }" :style="box(layout.right)">
      <slot name="right" />
    </section>
    <button type="button" class="dw-guestbook__close" :style="closeStyle" aria-label="Закрити книгу" @click="emit('close')">
      ✕
    </button>
  </div>
</template>
