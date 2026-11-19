<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { boot, fetchWorld } from '@/api'
import type { CameraTransition, NavigatorCommand, WorldObject } from '@/types'
import { isEditableTarget, isWebGLAvailable, WorldScene } from '@/world/WorldScene'
import ObjectList from '@/components/ObjectList.vue'
import DoorCard from '@/components/DoorCard.vue'
import NavigatorChat from '@/components/NavigatorChat.vue'
import ReadingHud from '@/components/ReadingHud.vue'

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
const hint = ref('')
const reading = ref<{ url: string; title: string; slug: string | null } | null>(null)
let hintTimer = 0

const bySlug = (slug: string | null) => objects.value.find((object) => object.slug === slug) ?? null
const zoneObject = computed(() => (entering.value || reading.value ? null : bySlug(zone.value)))
const samePath = (a: string, b: string) => new URL(a, window.location.href).pathname === new URL(b, window.location.href).pathname
const byUrl = (url: string) => objects.value.find((object) => object.url && samePath(object.url, url)) ?? null
const readHref = (url: string) => `${window.location.pathname}?read=${encodeURIComponent(new URL(url, window.location.href).pathname)}`

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
  storage((store) => store.setItem(LAST_DOOR_KEY, slug))
  const result = await scene.value.enter(slug, url)
  if (result === 'navigate') {
    window.location.assign(url)
    return
  }
  entering.value = null
  if (result === 'read') {
    reading.value = { url, title: scene.value.readingTitle || object.title, slug }
    window.history.pushState({ read: url }, '', readHref(url))
  }
}

async function openReading(url: string, push: boolean) {
  if (!scene.value) {
    return
  }
  const object = byUrl(url)
  const slug = object?.slug ?? reading.value?.slug ?? null
  if (push) {
    window.history.pushState({ read: url }, '', readHref(url))
  }
  const ok = await scene.value.readUrl(url, object?.color ?? '#3498db', reading.value ? null : slug)
  if (!ok) {
    window.location.assign(url)
    return
  }
  reading.value = { url, title: scene.value.readingTitle || object?.title || '', slug }
}

function exitReading(push = true) {
  if (!reading.value) {
    return
  }
  scene.value?.exitReading(reading.value.slug)
  reading.value = null
  entering.value = null
  if (push) {
    window.history.pushState({}, '', window.location.pathname)
  }
}

function onLink(href: string) {
  const target = new URL(href, window.location.href)
  const internal =
    target.origin === window.location.origin &&
    !/^\/(wp|wp-admin|wp-login\.php|wp-json)(\/|$)/.test(target.pathname) &&
    !/\.[a-z0-9]{2,5}$/i.test(target.pathname)
  if (!internal) {
    window.open(target.href, '_blank', 'noopener')
    return
  }
  if (samePath(target.href, window.location.href)) {
    exitReading()
    return
  }
  if (reading.value && samePath(target.href, reading.value.url)) {
    if (target.hash) {
      scene.value?.flyToAnchor(decodeURIComponent(target.hash.slice(1)))
    }
    return
  }
  void openReading(target.href, true)
}

function openRegularPage() {
  if (reading.value) {
    window.location.assign(reading.value.url)
  }
}

function readParam() {
  const path = new URLSearchParams(window.location.search).get('read')
  return path ? new URL(path, window.location.origin).href : null
}

function onPopState() {
  const url = readParam()
  if (url) {
    if (!reading.value || !samePath(reading.value.url, url)) {
      void openReading(url, false)
    }
  } else if (reading.value) {
    exitReading(false)
  }
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
  if (event.key === 'Escape' && reading.value && !isEditableTarget(event.target)) {
    event.preventDefault()
    exitReading()
    return
  }
  if (event.key !== 'Enter' || event.repeat || isEditableTarget(event.target)) {
    return
  }
  if ((event.target as HTMLElement | null)?.closest('button, a, [role="button"]')) {
    return
  }
  if (entering.value) {
    event.preventDefault()
    scene.value?.hurry()
    return
  }
  if (zone.value) {
    event.preventDefault()
    void enter(zone.value)
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('popstate', onPopState)
  try {
    const world = await fetchWorld()
    objects.value = world.objects
    siteName.value = world.site.name
    homeUrl.value = world.site.home
    aiEnabled.value = world.ai
    if (webgl && stage.value) {
      scene.value = new WorldScene(stage.value, { reducedMotion, onObjectClick, onZoneChange, onLink })
      scene.value.setObjects(world.objects, world.island.radius)
      let lastDoor: string | null = null
      storage((store) => {
        lastDoor = store.getItem(LAST_DOOR_KEY)
        store.removeItem(LAST_DOOR_KEY)
      })
      const focus = new URLSearchParams(window.location.search).get('focus')
      restoreAtDoor(focus && bySlug(focus) ? focus : lastDoor)
      const initial = readParam()
      if (initial) {
        void openReading(initial, false)
      }
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
  window.removeEventListener('popstate', onPopState)
  window.clearTimeout(hintTimer)
  scene.value?.dispose()
})
</script>

<template>
  <div class="dw-app" :class="{ 'is-static': !webgl, 'is-entering': entering || reading }">
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

    <ReadingHud
      v-if="reading"
      :title="reading.title"
      :touch="touch"
      @exit="exitReading()"
      @read="scene?.readHere()"
      @top="scene?.readTop()"
      @page="openRegularPage"
    />

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
