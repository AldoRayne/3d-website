<script setup lang="ts">
import type { WorldObject } from '@/types'
import { currentUser } from '@/auth'

defineProps<{ objects: WorldObject[]; selected: string | null }>()
const emit = defineEmits<{ select: [string] }>()
</script>

<template>
  <div class="dw-bookpage dw-island-guide">
    <h2 class="dw-auth__title">Мій острів</h2>
    <p class="dw-auth__note">
      {{ currentUser?.name }}, це ваша карта світу. Перетягуйте будинки й повертайте їх дверима куди хочете. Зміни бачите лише ви.
    </p>
    <ul class="dw-island-guide__list">
      <li v-for="object in objects" :key="object.slug">
        <button
          type="button"
          class="dw-island-guide__item"
          :class="{ 'is-selected': selected === object.slug }"
          :style="{ '--dw-accent': object.color }"
          :aria-pressed="selected === object.slug"
          @click="emit('select', object.slug)"
        >
          <span class="dw-island-guide__dot" aria-hidden="true" />
          {{ object.title }}
        </button>
      </li>
    </ul>
  </div>
</template>
