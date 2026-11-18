<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { boot, fetchWorld } from '@/api'
import type { CameraTransition, NavigatorCommand, WorldObject } from '@/types'
import { isEditableTarget, isWebGLAvailable, WorldScene } from '@/world/WorldScene'
import ObjectList from '@/components/ObjectList.vue'
import InfoPanel from '@/components/InfoPanel.vue'
import NavigatorChat from '@/components/NavigatorChat.vue'

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
const panel = ref<string | null>(null)
const hint = ref('')
let hintTimer = 0

const bySlug = (slug: string | null) => objects.value.find((object) => object.slug === slug) ?? null
const zoneObject = computed(() => bySlug(zone.value))
const panelObject = computed(() => bySlug(panel.value))
const promptLabel = computed(() => {
  if (!zoneObject.value || panel.value === zone.value) {
    return ''
  }
  return touch ? `Відкрити «${zoneObject.value.title}»` : `відкрити «${zoneObject.value.title}»`
})

function showHint(text: string, duration = 2600) {
  hint.value = text
  window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => (hint.value = ''), duration)
}

function activate() {
  const object = zoneObject.value
  if (!object) {
    return
  }
  if (panel.value !== object.slug) {
    panel.value = object.slug
  } else if (object.url) {
    window.location.href = object.url
  }
}

function onObjectClick(slug: string) {
  if (zone.value === slug) {
    activate()
    return
  }
  const object = bySlug(slug)
  if (object) {
    showHint(`Підійдіть ближче до «${object.title}»`)
  }
}

function onZoneChange(slug: string | null) {
  zone.value = slug
  if (panel.value && panel.value !== slug) {
    panel.value = null
  }
}

async function walkTo(slug: string, { open = false, transition = 'fly' as CameraTransition } = {}) {
  const arrived = await scene.value?.walkTo(slug, transition)
  if (arrived && open && zone.value === slug) {
    panel.value = slug
  }
}

function showOverview(transition: CameraTransition = 'fly') {
  scene.value?.overview(transition)
}

function closePanel() {
  panel.value = null
}

function runCommand(command: NavigatorCommand) {
  const transition = command.camera.transition
  if ((command.action === 'navigate' || command.action === 'open') && command.target) {
    void walkTo(command.target, { open: command.action === 'open', transition })
  } else if (command.action === 'overview') {
    showOverview(transition)
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && panel.value) {
    closePanel()
    return
  }
  if (event.key !== 'Enter' || event.repeat || isEditableTarget(event.target)) {
    return
  }
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, [role="button"]')) {
    return
  }
  if (zone.value) {
    event.preventDefault()
    activate()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    const world = await fetchWorld()
    objects.value = world.objects
    siteName.value = world.site.name
    homeUrl.value = world.site.home
    aiEnabled.value = world.ai
    if (webgl && stage.value) {
      scene.value = new WorldScene(stage.value, { reducedMotion, onObjectClick, onZoneChange })
      scene.value.setObjects(world.objects)
      const focus = new URLSearchParams(window.location.search).get('focus')
      if (focus && bySlug(focus)) {
        void walkTo(focus, { transition: 'instant' })
      }
      showHint(
        touch
          ? 'Тапніть по землі, щоб іти. Зайдіть у зону будівлі, щоб відкрити її.'
          : 'Стрілки / WASD або клік по землі — йти. У зоні будівлі натисніть Enter.',
        6000,
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
  window.clearTimeout(hintTimer)
  scene.value?.dispose()
})
</script>

<template>
  <div class="dw-app" :class="{ 'is-static': !webgl }">
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
      @overview="showOverview()"
    />

    <div v-if="webgl && objects.length" class="dw-side">
      <div class="dw-hud">
        <p v-if="hint" class="dw-hint" role="status">{{ hint }}</p>
        <button
          v-if="zoneObject && promptLabel"
          type="button"
          class="dw-prompt"
          :style="{ '--dw-accent': zoneObject.color }"
          @click="activate"
        >
          <kbd v-if="!touch">Enter</kbd>
          <span>{{ promptLabel }}</span>
        </button>
      </div>
      <InfoPanel v-if="panelObject" :object="panelObject" :touch="touch" @close="closePanel" />
      <NavigatorChat :ai-enabled="aiEnabled" @command="runCommand" />
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
