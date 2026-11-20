<script setup lang="ts">
defineProps<{
  mode: 'top' | 'angled'
  selected: string | null
  status: 'idle' | 'saving' | 'saved' | 'error'
  problem: string
  touch: boolean
}>()
const emit = defineEmits<{ mode: ['top' | 'angled']; rotate: []; reset: []; signOut: [] }>()
</script>

<template>
  <div class="dw-island-bar" role="toolbar" aria-label="Мій острів">
    <div class="dw-island-bar__group" role="radiogroup" aria-label="Вигляд">
      <button
        v-for="option in (['top', 'angled'] as const)"
        :key="option"
        type="button"
        role="radio"
        class="dw-island-bar__mode"
        :class="{ 'is-active': mode === option }"
        :aria-checked="mode === option"
        @click="emit('mode', option)"
      >
        {{ option === 'top' ? 'Згори' : 'Під кутом' }}
      </button>
    </div>
    <button type="button" class="dw-island-bar__button" :disabled="!selected" @click="emit('rotate')">
      ↻ Повернути<kbd v-if="!touch">R</kbd>
    </button>
    <button type="button" class="dw-island-bar__button dw-island-bar__button--quiet" @click="emit('reset')">Скинути</button>
    <button type="button" class="dw-island-bar__button dw-island-bar__button--quiet" @click="emit('signOut')">Вийти</button>
    <p class="dw-island-bar__status" role="status" aria-live="polite">
      <span v-if="problem" class="is-problem">{{ problem }}</span>
      <template v-else-if="status === 'saving'">Зберігаємо…</template>
      <template v-else-if="status === 'saved'">Збережено</template>
      <span v-else-if="status === 'error'" class="is-problem">Не вдалося зберегти</span>
      <template v-else>{{ touch ? 'Перетягніть будинок пальцем' : 'Перетягніть будинок мишею' }}</template>
    </p>
  </div>
</template>
