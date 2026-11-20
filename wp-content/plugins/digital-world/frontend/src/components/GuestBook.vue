<script setup lang="ts">
import { computed } from 'vue'
import type { ScreenRect, StandLayout } from '@/world/WorldScene'

const props = defineProps<{ layout: StandLayout }>()
const emit = defineEmits<{ close: [] }>()

const box = (rect: ScreenRect) => ({
  left: `${rect.x}px`,
  top: `${rect.y}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
})

const closeStyle = computed(() => {
  const { right } = props.layout
  return { left: `${right.x + right.width}px`, top: `${right.y}px` }
})
</script>

<template>
  <div class="dw-guestbook" role="dialog" aria-modal="true" aria-label="Книга гостей">
    <section v-if="layout.left" class="dw-guestbook__page" :style="box(layout.left)">
      <slot name="left" />
    </section>
    <section class="dw-guestbook__page" :style="box(layout.right)">
      <slot name="right" />
    </section>
    <button type="button" class="dw-guestbook__close" :style="closeStyle" aria-label="Закрити книгу" @click="emit('close')">
      ✕
    </button>
  </div>
</template>
