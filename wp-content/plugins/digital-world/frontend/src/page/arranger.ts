import { inBounds, overlaps, pageBox, shift, type Box, type Layout, type Offset } from './layout'

const HOLD_MS = 260
const CANCEL_DISTANCE = 8
const EDGE = 70
const LAND_MS = 320
const NUDGE = 8

interface Hold {
  pointerId: number
  el: HTMLElement
  x: number
  y: number
  timer: number
}

interface Drag {
  pointerId: number
  el: HTMLElement
  saved: Record<'position' | 'zIndex' | 'pointerEvents' | 'transformOrigin' | 'transition', string>
  start: Offset
  startPointer: Offset
  startScroll: Offset
  box: Box
  obstacles: Box[]
  imprint: HTMLElement
  pointer: Offset
  target: Offset
  pos: Offset
  tilt: { x: number; y: number; z: number }
  lift: number
  valid: boolean
  frame: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function editable(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

export class Arranger {
  private hold: Hold | null = null
  private drag: Drag | null = null
  private paper: string
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(
    private layout: Layout,
    private onChange: () => void,
  ) {
    const background = getComputedStyle(document.body).backgroundColor
    this.paper = !background || background === 'rgba(0, 0, 0, 0)' ? '#ffffff' : background
    document.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    window.addEventListener('touchmove', this.onTouchMove, { passive: false })
    window.addEventListener('dragstart', this.onBlockedEvent)
    window.addEventListener('contextmenu', this.onBlockedEvent)
    window.addEventListener('keydown', this.onKeyDown)
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.drag || this.hold || !this.layout.active() || (event.pointerType === 'mouse' && event.button !== 0) || editable(event.target)) {
      return
    }
    const el = this.layout.blockAt(event.target as Element)
    if (!el) {
      return
    }
    el.classList.add('dw-pressing')
    this.hold = {
      pointerId: event.pointerId,
      el,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => this.pickUp(), HOLD_MS),
    }
  }

  private cancelHold() {
    if (this.hold) {
      window.clearTimeout(this.hold.timer)
      this.hold.el.classList.remove('dw-pressing')
      this.hold = null
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.hold && event.pointerId === this.hold.pointerId) {
      if (Math.hypot(event.clientX - this.hold.x, event.clientY - this.hold.y) > CANCEL_DISTANCE) {
        this.cancelHold()
      }
      return
    }
    if (this.drag && event.pointerId === this.drag.pointerId) {
      event.preventDefault()
      this.drag.pointer = { x: event.clientX, y: event.clientY }
    }
  }

  private onPointerUp = (event: PointerEvent) => {
    if (this.hold && event.pointerId === this.hold.pointerId) {
      this.cancelHold()
    }
    if (this.drag && event.pointerId === this.drag.pointerId) {
      this.drop()
    }
  }

  private onTouchMove = (event: TouchEvent) => {
    if (this.drag) {
      event.preventDefault()
    }
  }

  private onBlockedEvent = (event: Event) => {
    if (this.drag || this.hold) {
      event.preventDefault()
    }
  }

  private pickUp() {
    const hold = this.hold
    if (!hold) {
      return
    }
    this.hold = null
    const { el } = hold
    el.classList.remove('dw-pressing')
    window.getSelection()?.removeAllRanges()
    navigator.vibrate?.(12)

    const start = this.layout.offset(el)
    const rect = el.getBoundingClientRect()
    const ink = this.layout.ink(el)
    const obstacles = this.layout.obstacles(el)
    const box = pageBox(rect)
    const imprint = document.createElement('div')
    imprint.className = 'dw-imprint'
    Object.assign(imprint.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    document.body.appendChild(imprint)

    const saved = {
      position: el.style.position,
      zIndex: el.style.zIndex,
      pointerEvents: el.style.pointerEvents,
      transformOrigin: el.style.transformOrigin,
      transition: el.style.transition,
    }
    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative'
    }
    Object.assign(el.style, {
      zIndex: '2147483000',
      pointerEvents: 'none',
      transition: 'none',
      transformOrigin: `${hold.x - rect.left + start.x}px ${hold.y - rect.top + start.y}px`,
    })
    el.style.setProperty('--dw-paper', this.paper)
    el.classList.add('dw-lifted')
    document.documentElement.classList.add('dw-grabbing')

    this.drag = {
      pointerId: hold.pointerId,
      el,
      saved,
      start,
      startPointer: { x: hold.x, y: hold.y },
      startScroll: { x: window.scrollX, y: window.scrollY },
      box: ink,
      obstacles,
      imprint,
      pointer: { x: hold.x, y: hold.y },
      target: { ...start },
      pos: { ...start },
      tilt: { x: 0, y: 0, z: 0 },
      lift: 0,
      valid: true,
      frame: requestAnimationFrame(this.tick),
    }
  }

  private tick = () => {
    const drag = this.drag
    if (!drag) {
      return
    }
    drag.frame = requestAnimationFrame(this.tick)
    const { pointer } = drag
    if (pointer.y < EDGE) {
      window.scrollBy(0, -Math.ceil((EDGE - pointer.y) / 5))
    } else if (pointer.y > window.innerHeight - EDGE) {
      window.scrollBy(0, Math.ceil((pointer.y - window.innerHeight + EDGE) / 5))
    }

    drag.target = {
      x: drag.start.x + pointer.x - drag.startPointer.x + window.scrollX - drag.startScroll.x,
      y: drag.start.y + pointer.y - drag.startPointer.y + window.scrollY - drag.startScroll.y,
    }
    const follow = this.reducedMotion ? 1 : 0.35
    const vx = (drag.target.x - drag.pos.x) * follow
    const vy = (drag.target.y - drag.pos.y) * follow
    drag.pos.x += vx
    drag.pos.y += vy
    drag.lift = Math.min(1, drag.lift + 0.12)
    if (!this.reducedMotion) {
      drag.tilt.x += (clamp(-vy * 0.5, -14, 14) + 8 * drag.lift - drag.tilt.x) * 0.18
      drag.tilt.y += (clamp(vx * 0.5, -14, 14) - drag.tilt.y) * 0.18
      drag.tilt.z += (clamp(vx * 0.25, -7, 7) - drag.tilt.z) * 0.12
    }
    const scale = 1 + 0.04 * drag.lift
    drag.el.style.transform = `translate(${drag.pos.x}px, ${drag.pos.y}px) perspective(900px) rotateX(${drag.tilt.x}deg) rotateY(${drag.tilt.y}deg) rotateZ(${drag.tilt.z}deg) scale(${scale})`

    const candidate = shift(drag.box, drag.target.x - drag.start.x, drag.target.y - drag.start.y)
    drag.valid = inBounds(candidate) && !overlaps(candidate, drag.obstacles)
    drag.el.classList.toggle('dw-blocked', !drag.valid)
    document.documentElement.classList.toggle('dw-blocked-drop', !drag.valid)
  }

  private drop() {
    const drag = this.drag
    if (!drag) {
      return
    }
    this.drag = null
    cancelAnimationFrame(drag.frame)
    const { el } = drag
    const final = drag.valid ? drag.target : drag.start
    el.classList.remove('dw-blocked')
    el.classList.add('dw-landing')
    document.documentElement.classList.remove('dw-grabbing', 'dw-blocked-drop')
    el.style.transition = this.reducedMotion
      ? 'none'
      : drag.valid
        ? `transform ${LAND_MS}ms cubic-bezier(0.3, 1.45, 0.5, 1), box-shadow ${LAND_MS}ms ease`
        : `transform ${LAND_MS}ms ease-in-out, box-shadow ${LAND_MS}ms ease`
    this.layout.place(el, final)
    if (drag.valid) {
      this.layout.commit(el, shift(drag.box, final.x - drag.start.x, final.y - drag.start.y))
    }
    drag.imprint.classList.add('is-fading')

    window.setTimeout(
      () => {
        Object.assign(el.style, drag.saved)
        el.classList.remove('dw-lifted', 'dw-landing')
        drag.imprint.remove()
        if (drag.valid) {
          this.onChange()
        }
      },
      this.reducedMotion ? 0 : LAND_MS,
    )
    window.addEventListener('click', this.swallowClick, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', this.swallowClick, { capture: true }), 400)
  }

  private swallowClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key]
    if (!event.altKey || !direction || this.drag || !this.layout.active() || editable(event.target)) {
      return
    }
    const anchor = window.getSelection()?.anchorNode
    const start = document.activeElement && document.activeElement !== document.body ? document.activeElement : anchor instanceof Element ? anchor : anchor?.parentElement
    const el = this.layout.blockAt(start ?? null)
    if (!el) {
      return
    }
    event.preventDefault()
    const step = event.shiftKey ? NUDGE * 4 : NUDGE
    const offset = this.layout.offset(el)
    const box = shift(this.layout.ink(el), direction[0] * step, direction[1] * step)
    if (!inBounds(box) || overlaps(box, this.layout.obstacles(el))) {
      el.classList.add('dw-bump')
      window.setTimeout(() => el.classList.remove('dw-bump'), 300)
      return
    }
    this.layout.place(el, { x: offset.x + direction[0] * step, y: offset.y + direction[1] * step })
    this.layout.commit(el, box)
    this.onChange()
  }

  get busy() {
    return !!this.drag
  }

  reset() {
    const moved = this.layout.placed()
    for (const el of moved) {
      el.style.transition = this.reducedMotion ? 'none' : `transform ${LAND_MS}ms ease-in-out`
    }
    this.layout.reset()
    window.setTimeout(() => moved.forEach((el) => (el.style.transition = '')), LAND_MS)
  }
}
