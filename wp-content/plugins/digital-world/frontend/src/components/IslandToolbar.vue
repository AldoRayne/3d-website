<script setup lang="ts">
defineProps<{
  page: 'island' | 'avatar'
  busy: boolean
  mode: 'top' | 'angled'
  selected: string | null
  status: 'idle' | 'saving' | 'saved' | 'error'
  problem: string
  touch: boolean
  sharing?: boolean
}>()
const emit = defineEmits<{ page: ['island' | 'avatar']; mode: ['top' | 'angled']; rotate: []; reset: []; signOut: []; invite: [renew: boolean] }>()

const PAGES = [
  { id: 'island', title: 'Мій острів' },
  { id: 'avatar', title: 'Персонаж' },
] as const
</script>

<template>
  <div class="dw-island-bar" role="toolbar" :aria-label="page === 'avatar' ? 'Мій персонаж' : 'Мій острів'">
    <slot />
    <div class="dw-island-bar__group dw-island-bar__group--pages" role="tablist" aria-label="Сторінка книги">
      <button
        v-for="option in PAGES"
        :key="option.id"
        type="button"
        role="tab"
        class="dw-island-bar__mode"
        :class="{ 'is-active': page === option.id }"
        :aria-selected="page === option.id"
        :disabled="busy"
        @click="emit('page', option.id)"
      >
        {{ option.title }}
      </button>
    </div>
    <template v-if="page === 'island'">
      <div class="dw-island-bar__group" role="radiogroup" aria-label="Вигляд">
        <button
          v-for="option in (['top', 'angled'] as const)"
          :key="option"
          type="button"
          role="radio"
          class="dw-island-bar__mode"
          :class="{ 'is-active': mode === option }"
          :aria-checked="mode === option"
          :disabled="busy"
          @click="emit('mode', option)"
        >
          {{ option === 'top' ? 'Згори' : 'Під кутом' }}
        </button>
      </div>
      <button type="button" class="dw-island-bar__button" :disabled="busy || !selected" @click="emit('rotate')">
        ↻ Повернути<kbd v-if="!touch">R</kbd>
      </button>
      <button type="button" class="dw-island-bar__button" :disabled="busy || sharing" @click="emit('invite', false)">Запросити</button>
      <button
        type="button"
        class="dw-island-bar__button dw-island-bar__button--quiet"
        :disabled="busy || sharing"
        title="Старе посилання перестане діяти"
        @click="emit('invite', true)"
      >
        Нове посилання
      </button>
    </template>
    <button type="button" class="dw-island-bar__button dw-island-bar__button--quiet" :disabled="busy" @click="emit('reset')">Скинути</button>
    <button type="button" class="dw-island-bar__button dw-island-bar__button--quiet" :disabled="busy" @click="emit('signOut')">Вийти</button>
    <p class="dw-island-bar__status" role="status" aria-live="polite">
      <span v-if="problem" class="is-problem">{{ problem }}</span>
      <template v-else-if="status === 'saving'">Зберігаємо…</template>
      <template v-else-if="status === 'saved'">Збережено</template>
      <span v-else-if="status === 'error'" class="is-problem">Не вдалося зберегти</span>
      <template v-else-if="busy">Гортаємо сторінку…</template>
      <template v-else-if="page === 'avatar'">{{ touch ? 'Проведіть пальцем, щоб повернути персонажа' : 'Потягніть мишею, щоб повернути персонажа' }}</template>
      <template v-else>{{ touch ? 'Перетягніть будинок пальцем' : 'Перетягніть будинок мишею' }}</template>
    </p>
  </div>
</template>
