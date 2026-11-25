<script setup lang="ts">
import { computed } from 'vue'
import { heard, lastReply, listening, toggleVoice, voiceBusy, voiceMode, voiceNote, voiceStatus } from '@/voice-control'

const text = computed(() => {
  if (voiceNote.value) {
    return voiceNote.value
  }
  if (heard.value) {
    return `«${heard.value}»`
  }
  if (lastReply.value && !voiceBusy.value) {
    return lastReply.value
  }
  return voiceStatus.value
})
</script>

<template>
  <div class="dw-voice-dock" :class="{ 'is-on': voiceMode }">
    <p v-if="text" class="dw-voice-dock__status" role="status" aria-live="polite">{{ text }}</p>
    <button
      type="button"
      class="dw-voice-dock__mic"
      :class="{ 'is-on': voiceMode, 'is-listening': listening }"
      :aria-pressed="voiceMode"
      :aria-label="voiceMode ? 'Вимкнути голосове керування' : 'Увімкнути голосове керування'"
      :title="voiceMode ? 'Вимкнути голосове керування' : 'Увімкнути голосове керування'"
      @click="toggleVoice"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
        <path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>
