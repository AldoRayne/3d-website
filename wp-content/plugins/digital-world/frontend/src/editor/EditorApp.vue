<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { WorldObject } from '@/types'
import { describeBuilding, generateBuilding, randomSeed } from '@/world/buildings'
import { drawBuildingPreview } from '@/world/preview'
import { DOOR_SIDES, MAX_RADIUS, sideOfQuarter, type Placement, type PlacementProblem } from '@/world/WorldModel'
import { isEditableTarget, isWebGLAvailable } from '@/world/dom'
import { WorldEditor } from './WorldEditor'
import { boot, loadWorld, saveObject, saveRadius, type ObjectPatch } from './api'

const PROBLEMS: Record<Exclude<PlacementProblem, null>, string> = {
  outside: 'Будівля виходить за межі острова.',
  overlap: 'Будівля налазить на іншу. Між будівлями потрібен зазор щонайменше в 1 блок.',
  'door-blocked': 'Перед дверима має лишатися вільне місце для входу.',
  'blocks-door': 'Будівля перекриває вхід до іншої будівлі.',
}
const SIDES = [
  { value: 'north', label: 'Північ' },
  { value: 'east', label: 'Схід' },
  { value: 'south', label: 'Південь' },
  { value: 'west', label: 'Захід' },
] as const
const PALETTE = ['#5eead4', '#60a5fa', '#a78bfa', '#f472b6', '#fbbf24', '#f87171', '#4ade80', '#94a3b8']

const stage = ref<HTMLElement | null>(null)
const preview = ref<HTMLCanvasElement | null>(null)
const editor = shallowRef<WorldEditor | null>(null)
const objects = ref<WorldObject[]>([])
const radius = ref(24)
const minRadius = ref(16)
const selectedSlug = ref<string | null>(null)
const loading = ref(true)
const loadError = ref('')
const pending = ref(0)
const saveError = ref('')
const lastSaved = ref<Date | null>(null)
const notice = ref('')
const webgl = isWebGLAvailable()
const chains = new Map<string, Promise<unknown>>()
let noticeTimer = 0
let radiusTimer = 0
let colorTimer = 0

const selected = computed(() => objects.value.find((object) => object.slug === selectedSlug.value) ?? null)
const selectedSide = computed(() => {
  if (!selected.value || !editor.value) {
    return null
  }
  const placement = editor.value.placementOf(selected.value.slug)
  return placement ? sideOfQuarter(placement.quarter) : null
})
const status = computed(() => {
  if (saveError.value) {
    return { tone: 'error', text: `Помилка збереження: ${saveError.value}` }
  }
  if (pending.value) {
    return { tone: 'saving', text: 'Зберігаємо…' }
  }
  if (lastSaved.value) {
    return { tone: 'saved', text: `Збережено о ${lastSaved.value.toLocaleTimeString('uk-UA')}` }
  }
  return { tone: 'idle', text: 'Зміни зберігаються автоматично' }
})

function flash(text: string) {
  notice.value = text
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 3200)
}

function persist(key: string, task: () => Promise<unknown>) {
  pending.value++
  saveError.value = ''
  const chain = (chains.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(task)
    .then(() => {
      lastSaved.value = new Date()
    })
    .catch((error: unknown) => {
      saveError.value = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      pending.value--
    })
  chains.set(key, chain)
}

function saveSelected(object: WorldObject, patch: ObjectPatch) {
  persist(`object-${object.id}`, () => saveObject(object.id, patch))
}

function applyPlacement(object: WorldObject, placement: Placement) {
  object.position = { x: placement.x, z: placement.z }
  object.door = sideOfQuarter(placement.quarter)
  object.seed = placement.seed
}

function onCommit(slug: string, placement: Placement) {
  const object = objects.value.find((item) => item.slug === slug)
  if (!object) {
    return
  }
  applyPlacement(object, placement)
  minRadius.value = editor.value?.minimumRadius() ?? minRadius.value
  saveSelected(object, { x: placement.x, z: placement.z, door: object.door })
}

function onDragProblem(problem: PlacementProblem) {
  notice.value = problem ? PROBLEMS[problem] : ''
}

function setSide(side: (typeof SIDES)[number]['value']) {
  const object = selected.value
  const scene = editor.value
  const placement = object && scene?.placementOf(object.slug)
  if (!object || !scene || !placement) {
    return
  }
  const candidate = { ...placement, quarter: DOOR_SIDES.indexOf(side) }
  const problem = scene.check(object.slug, candidate)
  if (problem) {
    flash(PROBLEMS[problem])
    return
  }
  commitLocal(object, candidate, { door: side })
}

function rotate() {
  const object = selected.value
  const candidate = object && editor.value?.rotate(object.slug)
  if (!object) {
    return
  }
  if (!candidate) {
    flash('Двері нікуди повернути: з усіх боків бракує місця.')
    return
  }
  commitLocal(object, candidate, { door: sideOfQuarter(candidate.quarter) })
}

function regenerate() {
  const object = selected.value
  const placement = object && editor.value?.placementOf(object.slug)
  if (!object || !placement) {
    return
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = { ...placement, seed: randomSeed() }
    if (!editor.value?.check(object.slug, candidate)) {
      commitLocal(object, candidate, { seed: candidate.seed, door: sideOfQuarter(candidate.quarter) })
      return
    }
  }
  flash('Тут замало місця: жодна згенерована будівля не помістилася. Пересуньте сусідів або цю будівлю.')
}

function drawPreview() {
  const object = selected.value
  if (object && preview.value) {
    drawBuildingPreview(preview.value, generateBuilding(object.seed, object.color))
  }
}

watch(
  () => [selected.value?.slug, selected.value?.seed, selected.value?.color],
  () => nextTick(drawPreview),
)

function setColor(color: string) {
  const object = selected.value
  if (!object || object.color === color) {
    return
  }
  object.color = color
  editor.value?.updateObject({ ...object })
  window.clearTimeout(colorTimer)
  colorTimer = window.setTimeout(() => saveSelected(object, { color }), 350)
}

function nudge(dx: number, dz: number) {
  const object = selected.value
  const result = object && editor.value?.nudge(object.slug, dx, dz)
  if (!object || !result?.placement) {
    return
  }
  if (result.problem) {
    flash(PROBLEMS[result.problem])
    return
  }
  commitLocal(object, result.placement, {
    x: result.placement.x,
    z: result.placement.z,
    door: sideOfQuarter(result.placement.quarter),
  })
}

function commitLocal(object: WorldObject, placement: Placement, patch: ObjectPatch) {
  applyPlacement(object, placement)
  editor.value?.updateObject({ ...object })
  minRadius.value = editor.value?.minimumRadius() ?? minRadius.value
  saveSelected(object, patch)
}

function setRadius(value: number) {
  const next = Math.min(MAX_RADIUS, Math.max(minRadius.value, Math.round(value) || minRadius.value))
  radius.value = next
  editor.value?.setRadius(next)
  window.clearTimeout(radiusTimer)
  radiusTimer = window.setTimeout(() => persist('settings', () => saveRadius(next)), 400)
}

function onKeydown(event: KeyboardEvent) {
  if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
    return
  }
  if (event.key === 'Escape') {
    editor.value?.cancelDrag()
    editor.value?.select(null)
    return
  }
  if (!selected.value) {
    return
  }
  const moves: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  }
  if (event.key in moves) {
    event.preventDefault()
    nudge(...moves[event.key])
  } else if (event.key === 'r' || event.key === 'R' || event.key === 'к' || event.key === 'К') {
    event.preventDefault()
    rotate()
  }
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (pending.value) {
    event.preventDefault()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
  try {
    const world = await loadWorld()
    objects.value = world.objects
    radius.value = world.island.radius
    if (webgl && stage.value) {
      editor.value = new WorldEditor(stage.value, {
        onSelect: (slug) => (selectedSlug.value = slug),
        onCommit,
        onDragProblem,
      })
      editor.value.setWorld(world.objects, world.island.radius)
      minRadius.value = editor.value.minimumRadius()
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  editor.value?.dispose()
})
</script>

<template>
  <div class="dwe">
    <div class="dwe-stage-wrap">
      <div ref="stage" class="dwe-stage" />
      <p v-if="notice" class="dwe-notice" role="status">{{ notice }}</p>
      <p v-if="loading" class="dwe-overlay">Завантажуємо світ…</p>
      <p v-else-if="loadError" class="dwe-overlay is-error">Не вдалося завантажити світ: {{ loadError }}</p>
      <p v-else-if="!webgl" class="dwe-overlay is-error">Цей браузер не підтримує WebGL, редактор недоступний.</p>
    </div>

    <aside class="dwe-side">
      <p class="dwe-status" :class="`is-${status.tone}`" role="status">{{ status.text }}</p>

      <section v-if="selected" class="dwe-card">
        <div class="dwe-card__head">
          <span class="dwe-swatch" :style="{ background: selected.color }" />
          <h2>{{ selected.title }}</h2>
          <button type="button" class="button-link" @click="editor?.select(null)">Закрити</button>
        </div>
        <p class="dwe-muted">
          Позиція: X {{ selected.position.x }}, Z {{ selected.position.z }}
          <template v-if="selected.page_title"> · сторінка «{{ selected.page_title }}»</template>
        </p>

        <div class="dwe-field">
          <span class="dwe-label">Будівля</span>
          <canvas ref="preview" class="dwe-preview" width="288" height="200" />
          <p class="dwe-muted">{{ describeBuilding(selected.seed) }}</p>
          <button type="button" class="button dwe-wide" @click="regenerate">Згенерувати іншу</button>
        </div>

        <div class="dwe-field">
          <span class="dwe-label">Колір</span>
          <div class="dwe-palette">
            <button
              v-for="color in PALETTE"
              :key="color"
              type="button"
              class="dwe-color"
              :class="{ 'is-active': selected.color.toLowerCase() === color }"
              :style="{ background: color }"
              :aria-label="`Колір ${color}`"
              @click="setColor(color)"
            />
            <input
              type="color"
              :value="selected.color"
              aria-label="Свій колір"
              @input="setColor(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>

        <div class="dwe-field">
          <span class="dwe-label">Двері дивляться на</span>
          <div class="dwe-sides">
            <button
              v-for="side in SIDES"
              :key="side.value"
              type="button"
              class="button"
              :class="{ 'button-primary': selectedSide === side.value }"
              @click="setSide(side.value)"
            >
              {{ side.label }}
            </button>
          </div>
          <button type="button" class="button dwe-rotate" @click="rotate">Повернути двері <kbd>R</kbd></button>
        </div>

        <p class="dwe-actions">
          <a class="button" :href="`${boot.editUrl}${selected.id}`">Редагувати запис</a>
          <button type="button" class="button" @click="editor?.focus(selected.slug)">Наблизити</button>
        </p>
      </section>

      <section v-else class="dwe-card">
        <h2>Острів</h2>
        <div class="dwe-field">
          <label class="dwe-label" for="dwe-radius">Радіус острова, блоків</label>
          <div class="dwe-radius">
            <input
              id="dwe-radius"
              type="range"
              :min="minRadius"
              :max="MAX_RADIUS"
              :value="radius"
              @input="setRadius(+($event.target as HTMLInputElement).value)"
            />
            <input
              type="number"
              class="small-text"
              :min="minRadius"
              :max="MAX_RADIUS"
              :value="radius"
              @change="setRadius(+($event.target as HTMLInputElement).value)"
            />
          </div>
          <p class="dwe-muted">Менше за {{ minRadius }} не можна: тоді будівлі опиняться за краєм.</p>
        </div>

        <h2>Будівлі</h2>
        <ul class="dwe-list">
          <li v-for="object in objects" :key="object.slug">
            <button type="button" @click="editor?.select(object.slug)">
              <span class="dwe-swatch" :style="{ background: object.color }" />
              {{ object.title }}
              
            </button>
          </li>
        </ul>
        <p class="dwe-help">
          Перетягуйте будівлі мишею, вони прилипають до сітки блоків. Ліва кнопка на порожньому місці обертає вигляд,
          права зсуває, колесо змінює масштаб. Для вибраної будівлі: стрілки зсувають на 1 блок, <kbd>R</kbd> повертає
          двері, <kbd>Esc</kbd> знімає вибір.
        </p>
      </section>
    </aside>
  </div>
</template>
