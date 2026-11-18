<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { WorldObject } from '@/types'
import { typeLabels } from '@/labels'

const props = defineProps<{ object: WorldObject; touch: boolean }>()
const emit = defineEmits<{ close: [] }>()

const heading = ref<HTMLElement | null>(null)

watch(
  () => props.object.slug,
  async () => {
    await nextTick()
    heading.value?.focus({ preventScroll: true })
  },
  { immediate: true },
)
</script>

<template>
  <aside class="dw-panel" :style="{ '--dw-accent': object.color }" aria-labelledby="dw-panel-title">
    <button type="button" class="dw-panel__close" aria-label="Закрити панель" @click="emit('close')">×</button>
    <span class="dw-panel__type">{{ typeLabels[object.type] }}</span>
    <h2 id="dw-panel-title" ref="heading" class="dw-panel__title" tabindex="-1">{{ object.title }}</h2>
    <p v-if="object.description" class="dw-panel__desc">{{ object.description }}</p>
    <div v-if="object.url" class="dw-panel__actions">
      <a class="dw-panel__cta" :href="object.url">
        Відкрити сторінку
        <span aria-hidden="true">→</span>
      </a>
      <span v-if="!touch" class="dw-panel__hint">або <kbd>Enter</kbd></span>
    </div>
  </aside>
</template>
