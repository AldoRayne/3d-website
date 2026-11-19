<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { boot, fetchWorld } from '@/api'
import type { CameraTransition, NavigatorCommand, WorldObject } from '@/types'
import { isEditableTarget, isWebGLAvailable, WorldScene, type ScreenRect } from '@/world/WorldScene'
import ObjectList from '@/components/ObjectList.vue'
import DoorCard from '@/components/DoorCard.vue'
import NavigatorChat from '@/components/NavigatorChat.vue'

const LAST_DOOR_KEY = 'dw-last-door'

const stage = ref<HTMLElement | null>(null)
const scene = shallowRef<WorldScene | null>(null)
const objects = ref<WorldObject[]>([])
const siteName = ref(boot.siteName)
const homeUrl = ref(boot.homeUrl)
const aiEnabled = ref(boot.ai)
const loading = ref(true)
const error = ref('')
const webgl = isWebGLAvailable()
const touch = window.matchMedia('(pointer: coarse)').matches
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const zone = ref<string | null>(null)
const entering = ref<string | null>(null)
const portalUrl = ref<string | null>(null)
const portal = ref<HTMLElement | null>(null)
const portalFrame = ref<HTMLIFrameElement | null>(null)
const hint = ref('')
let hintTimer = 0
let portalLoaded: Promise<void> = Promise.resolve()
let markPortalLoaded = () => {}

const bySlug = (slug: string | null) => objects.value.find((object) => object.slug === slug) ?? null
const zoneObject = computed(() => (entering.value ? null : bySlug(zone.value)))

function storage(action: (store: Storage) => void) {
  try {
    action(window.sessionStorage)
  } catch {
    return
  }
}

function showHint(text: string, duration = 2600) {
  hint.value = text
  window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => (hint.value = ''), duration)
}

async function enter(slug: string) {
  const object = bySlug(slug)
  if (!object || !scene.value || entering.value) {
    return
  }
  if (!object.url) {
    showHint(`«${object.title}» поки зачинена`)
    return
  }
  const url = object.url
  entering.value = slug
  hint.value = ''
  portalLoaded = new Promise<void>((resolve) => {
    markPortalLoaded = resolve
    window.setTimeout(resolve, 3000)
  })
  portalUrl.value = url
  storage((store) => store.setItem(LAST_DOOR_KEY, slug))
  let startCenter: { x: number; y: number } | null = null
  const entered = await scene.value.enter(slug, {
    prepare: async () => {
      await portalLoaded
      await nextTick()
    },
    frame: (rect, progress) => {
      startCenter ??= { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      drawPortal(rect, progress, startCenter)
    },
  })
  if (entered) {
    drawPortal({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, 1, null)
    window.location.assign(url)
  }
}

function drawPortal(rect: ScreenRect, progress: number, startCenter: { x: number; y: number } | null) {
  const wrapper = portal.value
  const frame = portalFrame.value
  if (!wrapper || !frame) {
    return
  }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clip = {
    left: Math.max(0, rect.x),
    top: Math.max(0, rect.y),
    right: Math.min(vw, rect.x + rect.width),
    bottom: Math.min(vh, rect.y + rect.height),
  }
  const t = progress * progress
  const from = startCenter ?? { x: vw / 2, y: vh / 2 }
  const cx = from.x + (vw / 2 - from.x) * t
  const cy = from.y + (vh / 2 - from.y) * t
  const cover = Math.max(rect.height / vh, rect.width / vw)
  const fill = Math.max(
    (2 * Math.max(cx - clip.left, clip.right - cx)) / vw,
    (2 * Math.max(cy - clip.top, clip.bottom - cy)) / vh,
  )
  const scale = progress >= 1 ? 1 : Math.max(cover + (1 - cover) * t, fill)
  wrapper.style.clipPath =
    progress >= 1 ? 'none' : `inset(${clip.top}px ${vw - clip.right}px ${vh - clip.bottom}px ${clip.left}px)`
  frame.style.transform = `translate(${cx - (vw * scale) / 2}px, ${cy - (vh * scale) / 2}px) scale(${scale})`
  wrapper.classList.add('is-visible')
}

function onObjectClick(slug: string) {
  if (zone.value === slug) {
    void enter(slug)
    return
  }
  const object = bySlug(slug)
  if (object) {
    showHint(`Підійдіть до дверей «${object.title}»`)
  }
}

function onZoneChange(slug: string | null) {
  zone.value = slug
}

function walkTo(slug: string, transition: CameraTransition = 'fly') {
  return scene.value?.walkTo(slug, transition)
}

function runCommand(command: NavigatorCommand) {
  if ((command.action === 'navigate' || command.action === 'open') && command.target) {
    void walkTo(command.target, command.camera.transition)
  } else if (command.action === 'overview') {
    scene.value?.overview()
  }
}

function restoreAtDoor(slug: string | null) {
  entering.value = null
  portalUrl.value = null
  if (slug && bySlug(slug)) {
    scene.value?.placeAtDoor(slug)
  }
}

function onPageShow(event: PageTransitionEvent) {
  if (event.persisted && entering.value) {
    restoreAtDoor(entering.value)
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.repeat || isEditableTarget(event.target)) {
    return
  }
  if ((event.target as HTMLElement | null)?.closest('button, a, [role="button"]')) {
    return
  }
  if (zone.value && !entering.value) {
    event.preventDefault()
    void enter(zone.value)
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pageshow', onPageShow)
  try {
    const world = await fetchWorld()
    objects.value = world.objects
    siteName.value = world.site.name
    homeUrl.value = world.site.home
    aiEnabled.value = world.ai
    if (webgl && stage.value) {
      scene.value = new WorldScene(stage.value, { reducedMotion, onObjectClick, onZoneChange })
      scene.value.setObjects(world.objects, world.island.radius)
      let lastDoor: string | null = null
      storage((store) => {
        lastDoor = store.getItem(LAST_DOOR_KEY)
        store.removeItem(LAST_DOOR_KEY)
      })
      const focus = new URLSearchParams(window.location.search).get('focus')
      restoreAtDoor(focus && bySlug(focus) ? focus : lastDoor)
      showHint(
        touch
          ? 'Тапніть по землі, щоб іти. Біля дверей натисніть «Увійти».'
          : '↑ ↓ — йти, ← → — повертати, затисніть мишу — озирнутися. Біля дверей натисніть Enter.',
        7000,
      )
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pageshow', onPageShow)
  window.clearTimeout(hintTimer)
  scene.value?.dispose()
})
</script>

<template>
  <div class="dw-app" :class="{ 'is-static': !webgl, 'is-entering': entering }">
    <div v-if="webgl" ref="stage" class="dw-stage" aria-hidden="true" />

    <header class="dw-topbar">
      <a class="dw-back" :href="homeUrl">
        <span aria-hidden="true">←</span>
        <span>Звичайний сайт</span>
      </a>
      <div class="dw-brand">
        <span class="dw-brand__eyebrow">Digital World</span>
        <span class="dw-brand__name">{{ siteName }}</span>
      </div>
    </header>

    <ObjectList
      v-if="objects.length"
      :objects="objects"
      :active="zone"
      :static-mode="!webgl"
      @select="(slug) => walkTo(slug)"
      @overview="scene?.overview()"
    />

    <div v-if="webgl && objects.length" class="dw-side">
      <div class="dw-hud">
        <p v-if="hint" class="dw-hint" role="status">{{ hint }}</p>
      </div>
      <DoorCard v-if="zoneObject" :object="zoneObject" :touch="touch" @enter="enter(zoneObject.slug)" />
      <NavigatorChat :ai-enabled="aiEnabled" @command="runCommand" />
    </div>

    <div v-if="portalUrl" ref="portal" class="dw-portal" aria-hidden="true">
      <iframe
        ref="portalFrame"
        :src="portalUrl"
        title=""
        tabindex="-1"
        loading="eager"
        @load="markPortalLoaded()"
      />
    </div>

    <div v-if="loading" class="dw-status" role="status">
      <span class="dw-spinner" aria-hidden="true" />
      Завантажуємо світ…
    </div>
    <div v-else-if="error" class="dw-status is-error" role="alert">
      Не вдалося завантажити світ: {{ error }}.
      <a :href="homeUrl">Перейти на сайт</a>
    </div>
    <p v-else-if="!webgl" class="dw-status is-note">
      Ваш браузер не підтримує WebGL, тому показуємо розділи списком.
    </p>
  </div>
</template>
