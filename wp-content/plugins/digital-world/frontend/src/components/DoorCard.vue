<script setup lang="ts">
import type { WorldObject } from '@/types'
import { describeBuilding } from '@/labels'

defineProps<{ object: WorldObject; touch: boolean }>()
const emit = defineEmits<{ enter: [] }>()
</script>

<template>
  <aside class="dw-panel" :style="{ '--dw-accent': object.color }" aria-live="polite">
    <span class="dw-panel__type">{{ describeBuilding(object.seed) }}</span>
    <h2 class="dw-panel__title">{{ object.title }}</h2>
    <p v-if="object.description" class="dw-panel__desc">{{ object.description }}</p>
    <div v-if="object.url" class="dw-panel__actions">
      <button type="button" class="dw-panel__cta" @click="emit('enter')">
        Увійти
        <span aria-hidden="true">→</span>
      </button>
      <span v-if="!touch" class="dw-panel__hint">або <kbd>Enter</kbd></span>
    </div>
    <p v-else class="dw-panel__desc">Ця будівля поки зачинена.</p>
  </aside>
</template>
