<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { boot, fetchWorld } from '@/api'
import type { CameraTransition, Layout, NavigatorCommand, WorldObject } from '@/types'
import { isEditableTarget, isWebGLAvailable, WorldScene, type StandLayout } from '@/world/WorldScene'
import { STAND_SLUG } from '@/world/stand'
import { currentUser, logout, resetLayout, saveLayout } from '@/auth'
import { applyLayout, layoutDiff } from '@/world/layout'
import type { Placement, PlacementProblem } from '@/world/WorldModel'
import IslandToolbar from '@/components/IslandToolbar.vue'
import IslandGuide from '@/components/IslandGuide.vue'
import ObjectList from '@/components/ObjectList.vue'
import DoorCard from '@/components/DoorCard.vue'
import StandCard from '@/components/StandCard.vue'
import GuestBook from '@/components/GuestBook.vue'
import GuestBookPage from '@/components/GuestBookPage.vue'
import NavigatorChat from '@/components/NavigatorChat.vue'
import ReadingHud from '@/components/ReadingHud.vue'

const LAST_DOOR_KEY = 'dw-last-door'

const stage = ref<HTMLElement | null>(null)
const scene = shallowRef<WorldScene | null>(null)
const objects = ref<WorldObject[]>([])
const siteName = ref(boot.siteName)
const homeUrl = ref(boot.homeUrl)
const aiProvider = ref(boot.ai)
const loading = ref(true)
const error = ref('')
const webgl = isWebGLAvailable()
const touch = window.matchMedia('(pointer: coarse)').matches
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const zone = ref<string | null>(null)
const entering = ref<string | null>(null)
const hint = ref('')
const reading = ref<{ url: string; title: string; slug: string | null } | null>(null)
const atStand = ref(false)
const bookOpen = ref(false)
const standLayout = ref<StandLayout | null>(null)
const radius = ref(24)
const layout = ref<Layout>(currentUser.value?.layout ?? {})
const islandShown = ref(false)
const islandOpening = ref(false)
const islandClosing = ref(false)
const islandMode = ref<'top' | 'angled'>('top')
const islandSelected = ref<string | null>(null)
const islandProblem = ref('')
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let worldDirty = false
let saveTimer = 0
let pendingSave: Promise<void> | null = null
let hintTimer = 0

const visit = boot.visit ?? null
const visitLayout: Layout = visit && !Array.isArray(visit.layout) ? visit.layout : {}
const worldObjects = () =>
  visit
    ? applyLayout(objects.value, visitLayout, radius.value)
    : currentUser.value
      ? applyLayout(objects.value, layout.value, radius.value)
      : objects.value
const PROBLEMS: Record<Exclude<PlacementProblem, null>, string> = {
  outside: 'Тут край острова',
  overlap: 'Будинки не можуть стояти впритул',
  'door-blocked': 'Двері впираються в інший будинок',
  'blocks-door': 'Так буде закрито чужі двері',
}
const bySlug = (slug: string | null) => objects.value.find((object) => object.slug === slug) ?? null
const zoneObject = computed(() => (entering.value || reading.value || bookOpen.value ? null : bySlug(zone.value)))
const showStandCard = computed(() => atStand.value && !zoneObject.value && !entering.value && !reading.value && !bookOpen.value)
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

async function openBook() {
  if (!scene.value || bookOpen.value || entering.value || reading.value) {
    return
  }
  if (visit) {
    showHint('У гостьовому перегляді книга недоступна')
    return
  }
  hint.value = ''
  bookOpen.value = true
  const opened = await scene.value.openStand()
  if (!opened && !scene.value.standOpen) {
    bookOpen.value = false
    return
  }
  if (opened && currentUser.value) {
    await showIsland(false)
  }
}

async function showIsland(turn: boolean) {
  if (!scene.value || !bookOpen.value) {
    return
  }
  islandSelected.value = null
  islandProblem.value = ''
  saveStatus.value = 'idle'
  islandMode.value = 'top'
  islandOpening.value = true
  const shown = await scene.value.showIsland(worldObjects(), radius.value, turn)
  islandOpening.value = false
  if (shown) {
    islandShown.value = true
  }
}

let signedInTimer = 0

watch(currentUser, (user, previous) => {
  if (user?.id === previous?.id) {
    return
  }
  layout.value = user?.layout ?? {}
  worldDirty = true
  if (user && !previous && bookOpen.value) {
    window.clearTimeout(signedInTimer)
    signedInTimer = window.setTimeout(() => void showIsland(true), 1300)
  }
})

function onIslandChange(placements: Map<string, Placement>) {
  layout.value = layoutDiff(objects.value, placements)
  worldDirty = true
  saveStatus.value = 'saving'
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void flushSave(), 500)
}

function flushSave() {
  window.clearTimeout(saveTimer)
  const snapshot = layout.value
  pendingSave = saveLayout(snapshot)
    .then(() => {
      if (layout.value === snapshot) {
        saveStatus.value = 'saved'
      }
      if (currentUser.value) {
        currentUser.value = { ...currentUser.value, layout: snapshot }
      }
    })
    .catch(() => {
      saveStatus.value = 'error'
    })
    .finally(() => {
      pendingSave = null
    })
  return pendingSave
}

async function resetIsland() {
  window.clearTimeout(saveTimer)
  saveStatus.value = 'saving'
  try {
    layout.value = await resetLayout()
    if (currentUser.value) {
      currentUser.value = { ...currentUser.value, layout: layout.value }
    }
    scene.value?.updateIsland(worldObjects(), radius.value)
    islandSelected.value = null
    worldDirty = true
    saveStatus.value = 'saved'
  } catch {
    saveStatus.value = 'error'
  }
}

function setIslandMode(mode: 'top' | 'angled') {
  islandMode.value = mode
  scene.value?.setIslandMode(mode)
}

function rotateIsland() {
  scene.value?.rotateIsland()
}

async function signOutFromIsland() {
  if (saveStatus.value === 'saving') {
    await flushSave()
  }
  islandClosing.value = true
  islandShown.value = false
  await scene.value?.hideIsland()
  try {
    await logout()
  } catch {
    showHint('Не вдалося вийти. Спробуйте ще раз.')
  } finally {
    islandClosing.value = false
  }
}

async function closeBook() {
  window.clearTimeout(signedInTimer)
  if (!scene.value || !bookOpen.value) {
    return
  }
  if (saveStatus.value === 'saving') {
    void flushSave()
  }
  standLayout.value = null
  islandShown.value = false
  islandOpening.value = false
  islandSelected.value = null
  islandProblem.value = ''
  await scene.value.closeStand()
  if (!scene.value.standOpen) {
    bookOpen.value = false
    if (worldDirty) {
      worldDirty = false
      scene.value.setObjects(worldObjects(), radius.value)
    }
  }
}

function onObjectClick(slug: string) {
  if (slug === STAND_SLUG) {
    if (atStand.value) {
      void openBook()
    } else {
      showHint('Підійдіть ближче до книги гостей')
    }
    return
  }
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

async function runCommand(command: NavigatorCommand) {
  if ((command.action === 'navigate' || command.action === 'open') && command.target) {
    const arrived = await walkTo(command.target, command.camera.transition)
    if (arrived && command.action === 'open' && command.target === STAND_SLUG && atStand.value) {
      void openBook()
    }
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
  if ((event.key === 'r' || event.key === 'R' || event.key === 'к' || event.key === 'К') && islandShown.value && !isEditableTarget(event.target)) {
    event.preventDefault()
    rotateIsland()
    return
  }
  if (event.key === 'Escape' && bookOpen.value) {
    event.preventDefault()
    void closeBook()
    return
  }
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
  if (entering.value || (bookOpen.value && !standLayout.value)) {
    event.preventDefault()
    scene.value?.hurry()
    return
  }
  if (bookOpen.value) {
    return
  }
  if (atStand.value && !zone.value) {
    event.preventDefault()
    void openBook()
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
    radius.value = world.island.radius
    siteName.value = world.site.name
    homeUrl.value = world.site.home
    aiProvider.value = world.ai
    if (webgl && stage.value) {
      scene.value = new WorldScene(stage.value, {
        reducedMotion,
        onObjectClick,
        onZoneChange,
        onLink,
        onStandZone: (active) => (atStand.value = active),
        onStandLayout: (next) => (standLayout.value = next),
        onIslandSelect: (slug) => (islandSelected.value = slug),
        onIslandProblem: (problem) => (islandProblem.value = problem ? PROBLEMS[problem] : ''),
        onIslandChange,
      })
      scene.value.setObjects(worldObjects(), world.island.radius)
      worldDirty = false
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
  <div class="dw-app" :class="{ 'is-static': !webgl, 'is-entering': entering || reading || bookOpen }">
    <div v-if="webgl" ref="stage" class="dw-stage" aria-hidden="true" />

    <div v-if="visit" class="dw-visit" role="status">
      <span class="dw-visit__label">Гостьовий перегляд</span>
      <span>Острів користувача <strong>{{ visit.name }}</strong></span>
      <a class="dw-visit__exit" :href="visit.returnUrl">Вийти з перегляду</a>
    </div>

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
      :active="zone ?? (atStand ? STAND_SLUG : null)"
      :visiting="!!visit"
      :static-mode="!webgl"
      @select="(slug) => walkTo(slug)"
      @overview="scene?.overview()"
    />

    <div v-if="webgl && objects.length" class="dw-side">
      <div class="dw-hud">
        <p v-if="hint" class="dw-hint" role="status">{{ hint }}</p>
      </div>
      <DoorCard v-if="zoneObject" :object="zoneObject" :touch="touch" @enter="enter(zoneObject.slug)" />
      <StandCard v-else-if="showStandCard" :touch="touch" :visiting="!!visit" @open="openBook" />
      <NavigatorChat :provider="aiProvider" @command="runCommand" />
    </div>

    <GuestBook v-if="standLayout" :layout="standLayout" :passthrough="islandShown" :print-left="islandShown" @close="closeBook">
      <template v-if="standLayout.left" #left>
        <Transition name="dw-bookpage-fade">
          <IslandGuide
            v-if="islandShown"
            :objects="objects"
            :selected="islandSelected"
            @select="(slug) => scene?.selectIsland(slug)"
          />
          <GuestBookPage v-else-if="!islandOpening && !islandClosing" side="left" :autofocus="!touch" />
        </Transition>
      </template>
      <template #right>
        <Transition name="dw-bookpage-fade">
          <GuestBookPage
            v-if="!islandShown && !islandOpening && !islandClosing"
            :side="standLayout.left ? 'right' : 'single'"
            :autofocus="!touch && !standLayout.left"
          />
        </Transition>
      </template>
    </GuestBook>
    <IslandToolbar
      v-if="islandShown && standLayout"
      :mode="islandMode"
      :selected="islandSelected"
      :status="saveStatus"
      :problem="islandProblem"
      :touch="touch"
      @mode="setIslandMode"
      @rotate="rotateIsland"
      @reset="resetIsland"
      @sign-out="signOutFromIsland"
    />

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
