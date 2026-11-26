<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Layout, WorldObject } from '@/types'
import { applyLayout, layoutDiff } from '@/world/layout'
import { sideOfQuarter, type Placement, type PlacementProblem } from '@/world/WorldModel'
import { isEditableTarget } from '@/world/dom'
import { WorldEditor } from '@/editor/WorldEditor'
import type { Avatar } from '@/world/avatar'

const PROBLEMS: Record<Exclude<PlacementProblem, null>, string> = {
  outside: 'Будівля виходить за межі острова.',
  overlap: 'Будівля налазить на іншу. Між будівлями потрібен зазор щонайменше в 1 блок.',
  'door-blocked': 'Перед дверима має лишатися вільне місце для входу.',
  'blocks-door': 'Будівля перекриває вхід до іншої будівлі.',
}

const props = defineProps<{
  stage: HTMLElement
  objects: WorldObject[]
  radius: number
  initial: Layout
  avatar: Avatar
  canEdit: boolean
  restUrl: string
  nonce: string
  userId: number
}>()
const emit = defineEmits<{ ready: [WorldEditor] }>()

const saved = ref<Layout>({ ...props.initial })
const current = ref<WorldObject[]>(applyLayout(props.objects, props.initial, props.radius))
const selectedSlug = ref<string | null>(null)
const notice = ref('')
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const error = ref('')
const version = ref(0)
let editor: WorldEditor | null = null
let noticeTimer = 0

const layout = computed(() => {
  void version.value
  const placements = new Map<string, Placement>()
  for (const object of props.objects) {
    const placement = editor?.placementOf(object.slug)
    if (placement) {
      placements.set(object.slug, placement)
    }
  }
  return layoutDiff(props.objects, placements)
})
const dirty = computed(() => JSON.stringify(sortedLayout(layout.value)) !== JSON.stringify(sortedLayout(saved.value)))
const savedCount = computed(() => Object.keys(saved.value).length)
const caption = computed(() => (savedCount.value ? `Змінено будинків: ${savedCount.value}` : 'Стандартне розміщення'))
const selected = computed(() => current.value.find((object) => object.slug === selectedSlug.value) ?? null)

function sortedLayout(value: Layout) {
  return Object.keys(value)
    .sort()
    .map((slug) => [slug, value[slug].x, value[slug].z, value[slug].door])
}

function flash(text: string) {
  notice.value = text
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 3500)
}

function touch() {
  version.value++
  if (status.value !== 'saving') {
    status.value = 'idle'
  }
}

function applyPlacement(slug: string, placement: Placement, redraw: boolean) {
  const object = current.value.find((item) => item.slug === slug)
  if (!object) {
    return
  }
  object.position = { x: placement.x, z: placement.z }
  object.door = sideOfQuarter(placement.quarter)
  if (redraw) {
    editor?.updateObject({ ...object })
  }
  touch()
}

function rotate() {
  const slug = selectedSlug.value
  if (!slug || !editor) {
    return
  }
  const candidate = editor.rotate(slug)
  if (!candidate) {
    flash('Двері нікуди повернути: з усіх боків бракує місця.')
    return
  }
  applyPlacement(slug, candidate, true)
}

function nudge(dx: number, dz: number) {
  const slug = selectedSlug.value
  const result = slug && editor?.nudge(slug, dx, dz)
  if (!slug || !result || !result.placement) {
    return
  }
  if (result.problem) {
    flash(PROBLEMS[result.problem])
    return
  }
  applyPlacement(slug, result.placement, true)
}

function showLayout(next: Layout) {
  current.value = applyLayout(props.objects, next, props.radius)
  const keep = selectedSlug.value
  editor?.setWorld(current.value, props.radius)
  if (keep) {
    editor?.select(keep)
  }
  version.value++
}

async function send(method: 'PUT' | 'DELETE') {
  status.value = 'saving'
  error.value = ''
  try {
    const response = await fetch(`${props.restUrl}/members/${props.userId}/layout`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-WP-Nonce': props.nonce,
        ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'PUT' ? JSON.stringify({ layout: layout.value }) : undefined,
    })
    const data = (await response.json().catch(() => null)) as { layout?: Layout | []; message?: string } | null
    if (!response.ok) {
      throw new Error(data?.message ?? `HTTP ${response.status}`)
    }
    const next = data?.layout && !Array.isArray(data.layout) ? data.layout : {}
    showLayout(next)
    saved.value = { ...layout.value }
    status.value = 'saved'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'Не вдалося зберегти.'
    status.value = 'error'
  }
}

function revert() {
  showLayout({ ...saved.value })
  touch()
}

function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || !props.canEdit || isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
    return
  }
  if (event.key === 'Escape') {
    editor?.cancelDrag()
    editor?.select(null)
    return
  }
  if (!selectedSlug.value) {
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
  } else if (['r', 'R', 'к', 'К'].includes(event.key)) {
    event.preventDefault()
    rotate()
  }
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault()
  }
}

onMounted(() => {
  editor = new WorldEditor(
    props.stage,
    {
      onSelect: (slug) => (selectedSlug.value = slug),
      onCommit: (slug, placement) => applyPlacement(slug, placement, false),
      onDragProblem: (problem) => (notice.value = problem ? PROBLEMS[problem] : ''),
    },
    { readOnly: !props.canEdit },
  )
  editor.setWorld(current.value, props.radius)
  editor.showPlayer(props.avatar)
  version.value++
  saved.value = { ...layout.value }
  emit('ready', editor)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', beforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', beforeUnload)
  window.clearTimeout(noticeTimer)
  editor?.dispose()
})
</script>

<template>
  <div class="dw-island-admin">
    <Teleport :to="stage.parentElement ?? 'body'">
      <p v-if="notice" class="dwe-notice" role="status">{{ notice }}</p>
    </Teleport>
    <p class="dw-island-admin__caption">{{ caption }}<template v-if="dirty"> · незбережені зміни</template></p>
    <template v-if="canEdit">
      <div v-if="selected" class="dw-island-admin__selected">
        <div class="dw-island-admin__head">
          <span class="dwe-swatch" :style="{ background: selected.color }" />
          <strong>{{ selected.title }}</strong>
          <button type="button" class="button-link" @click="editor?.select(null)">Закрити</button>
        </div>
        <div class="dw-island-admin__tools">
          <button type="button" class="button" @click="rotate">Повернути двері <kbd>R</kbd></button>
          <button type="button" class="button" @click="editor?.focus(selected.slug)">Наблизити</button>
        </div>
      </div>
      <p v-else class="description">
        Перетягніть будинок мишею або клацніть по ньому, щоб повернути двері. Стрілки зсувають вибраний будинок на клітинку.
      </p>
      <div class="dw-avatar-admin__actions">
        <button type="button" class="button button-primary" :disabled="!dirty || status === 'saving'" @click="send('PUT')">
          {{ status === 'saving' ? 'Збереження…' : 'Зберегти' }}
        </button>
        <button type="button" class="button" :disabled="!dirty || status === 'saving'" @click="revert">Скасувати</button>
        <button type="button" class="button-link dw-avatar-admin__reset" :disabled="!savedCount || status === 'saving'" @click="send('DELETE')">
          Скинути до стандартного
        </button>
      </div>
      <p v-if="status === 'saved'" class="dw-avatar-admin__status is-saved" role="status">Збережено. Користувач побачить зміни після оновлення сторінки світу.</p>
      <p v-else-if="status === 'error'" class="dw-avatar-admin__status is-error" role="alert">{{ error }}</p>
    </template>
    <p v-else class="description">Лише перегляд: обертайте камеру мишею, клік по будинку підсвічує його.</p>
  </div>
</template>
