<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { boot, fetchWorld } from '@/api'
import type { CameraTransition, NavigatorCommand, WorldObject } from '@/types'
import { isWebGLAvailable, WorldScene } from '@/world/WorldScene'
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
const focused = ref<string | null>(null)
const selected = ref<string | null>(null)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const selectedObject = computed(() => objects.value.find((object) => object.slug === selected.value) ?? null)

async function goTo(slug: string, { open = true, transition = 'fly' as CameraTransition } = {}) {
  focused.value = slug
  selected.value = open ? slug : null
  await scene.value?.flyTo(slug, transition)
}

function showOverview(transition: CameraTransition = 'fly') {
  focused.value = null
  selected.value = null
  void scene.value?.overview(transition)
}

function closePanel() {
  selected.value = null
}

function runCommand(command: NavigatorCommand) {
  const transition = command.camera.transition
  if ((command.action === 'navigate' || command.action === 'open') && command.target) {
    void goTo(command.target, { open: command.action === 'open', transition })
  } else if (command.action === 'overview') {
    showOverview(transition)
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && selected.value) {
    closePanel()
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
      scene.value = new WorldScene(stage.value, {
        reducedMotion,
        onSelect: (slug) => (slug ? void goTo(slug) : closePanel()),
      })
      scene.value.setObjects(world.objects)
      const focus = new URLSearchParams(window.location.search).get('focus')
      if (focus && world.objects.some((object) => object.slug === focus)) {
        void goTo(focus, { transition: 'instant' })
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
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
      :active="focused"
      :static-mode="!webgl"
      @select="(slug) => goTo(slug)"
      @overview="showOverview()"
    />

    <div v-if="webgl && objects.length" class="dw-side">
      <InfoPanel v-if="selectedObject" :object="selectedObject" @close="closePanel" />
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
