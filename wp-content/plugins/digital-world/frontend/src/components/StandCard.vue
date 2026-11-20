<script setup lang="ts">
import { currentUser } from '@/auth'
import { STAND_COLOR, STAND_TITLE } from '@/world/stand'

defineProps<{ touch: boolean }>()
const emit = defineEmits<{ open: [] }>()
</script>

<template>
  <aside class="dw-panel" :style="{ '--dw-accent': STAND_COLOR }" aria-live="polite">
    <span class="dw-panel__type">Стенд</span>
    <h2 class="dw-panel__title">{{ STAND_TITLE }}</h2>
    <p class="dw-panel__desc">
      {{ currentUser ? `Ви увійшли як ${currentUser.name}.` : 'Зареєструйтеся або увійдіть.' }}
    </p>
    <div class="dw-panel__actions">
      <button type="button" class="dw-panel__cta" @click="emit('open')">
        Відкрити книгу
        <span aria-hidden="true">→</span>
      </button>
      <span v-if="!touch" class="dw-panel__hint">або <kbd>Enter</kbd></span>
    </div>
  </aside>
</template>
