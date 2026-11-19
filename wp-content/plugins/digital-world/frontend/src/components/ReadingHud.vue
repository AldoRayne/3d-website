<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ title: string; touch: boolean }>()
const emit = defineEmits<{ exit: []; read: []; top: []; page: [] }>()
const showHelp = ref(true)
let timer = 0

onMounted(() => {
  timer = window.setTimeout(() => (showHelp.value = false), 9000)
})
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <div class="dw-reading">
    <header class="dw-reading__bar">
      <button type="button" class="dw-reading__button" @click="emit('exit')">
        <span aria-hidden="true">←</span>
        Вийти з книги
      </button>
      <p class="dw-reading__title">{{ title }}</p>
      <div class="dw-reading__actions">
        <button type="button" class="dw-reading__button" @click="emit('read')">Читати</button>
        <button type="button" class="dw-reading__button" @click="emit('top')">На початок</button>
        <button type="button" class="dw-reading__button is-primary" @click="emit('page')">Звичайна сторінка</button>
      </div>
    </header>
    <p v-if="showHelp" class="dw-reading__help" role="status">
      <template v-if="touch">Ліва половина екрана — летіти, права — оглядатися. Торкніться посилання, щоб перейти.</template>
      <template v-else>
        WASD або стрілки — летіти, E / Space — вгору, Q — вниз, Shift — швидше, затисніть мишу — оглядатися. Esc — вийти з книги.
      </template>
    </p>
  </div>
</template>
