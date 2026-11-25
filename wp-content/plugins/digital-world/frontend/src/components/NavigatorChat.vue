<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { askNavigator, ApiError } from '@/api'
import { canListen, canSpeak, listen, speak, speaking, stopSpeaking, type ListenError } from '@/voice'
import type { AiProvider, ChatTurn, NavigatorCommand } from '@/types'

defineProps<{ provider: AiProvider | null }>()

const PROVIDER_LABELS: Record<AiProvider, string> = { claude: 'Claude', ollama: 'Ollama', openai: 'OpenAI', gemini: 'Gemini' }
const emit = defineEmits<{ command: [command: NavigatorCommand] }>()

interface Message extends ChatTurn {
  id: number
  source?: 'ai' | 'fallback' | 'error'
}

const suggestions = [
  'Покажи, чим займається компанія',
  "Знайди проєкти, пов'язані з фінансами",
  'Покажи останні новини',
  'Переведи мене до розділу послуг',
]

const open = ref(window.innerWidth > 900)
const draft = ref('')
const busy = ref(false)
const messages = ref<Message[]>([
  {
    id: 0,
    role: 'assistant',
    content: 'Привіт! Я провідник цим світом. Скажіть, що шукаєте, і я перенесу вас туди.',
  },
])
const log = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
let nextId = 1

const VOICE_KEY = 'dw-navigator-voice'
const VOICE_NOTES: Record<ListenError, string> = {
  denied: 'Немає доступу до мікрофона. Дозвольте його в налаштуваннях браузера.',
  silence: 'Нічого не почув.',
  network: 'Розпізнавання мовлення недоступне без інтернету.',
  failed: 'Не вдалося розпізнати мовлення.',
}

const voiceMode = ref(false)
const listening = ref(false)
const voiceNote = ref('')
const voiceReplies = ref(readVoicePreference())
let session: ReturnType<typeof listen> = null
let restartTimer = 0

function readVoicePreference() {
  try {
    return localStorage.getItem(VOICE_KEY) !== 'off'
  } catch {
    return true
  }
}

watch(voiceReplies, (value) => {
  try {
    localStorage.setItem(VOICE_KEY, value ? 'on' : 'off')
  } catch {}
  if (!value) {
    stopSpeaking()
  }
})

watch(draft, () => {
  if (!voiceMode.value && speaking.value) {
    stopSpeaking()
  }
})

watch([busy, speaking], () => {
  if (!busy.value && !speaking.value) {
    startCapture()
  }
})

function stopVoice(error?: ListenError) {
  voiceMode.value = false
  window.clearTimeout(restartTimer)
  if (error) {
    voiceNote.value = VOICE_NOTES[error]
  }
}

function startCapture() {
  window.clearTimeout(restartTimer)
  if (!voiceMode.value || session || busy.value || speaking.value) {
    return
  }
  session = listen({
    interim: (text) => {
      draft.value = text
    },
    done: (text) => {
      void send(text, true)
    },
    error: (error) => {
      if (error !== 'silence') {
        stopVoice(error)
      }
    },
    end: () => {
      listening.value = false
      session = null
      restartTimer = window.setTimeout(startCapture, 300)
    },
  })
  listening.value = Boolean(session)
  if (!session) {
    stopVoice('failed')
  }
}

function toggleVoice() {
  if (voiceMode.value) {
    stopVoice()
    session?.stop()
    return
  }
  stopSpeaking()
  voiceNote.value = ''
  draft.value = ''
  voiceMode.value = true
  startCapture()
}

function onEscape(event: KeyboardEvent) {
  if (speaking.value) {
    event.stopPropagation()
    stopSpeaking()
  } else if (voiceMode.value) {
    event.stopPropagation()
    stopVoice()
    session?.cancel()
    draft.value = ''
  }
}

onBeforeUnmount(() => {
  stopVoice()
  session?.cancel()
  stopSpeaking()
})

async function scrollDown() {
  await nextTick()
  log.value?.scrollTo({ top: log.value.scrollHeight })
}

function history(): ChatTurn[] {
  return messages.value
    .slice(1)
    .filter((message) => message.source !== 'error')
    .slice(-6)
    .map(({ role, content }) => ({ role, content }))
}

async function send(text = draft.value, spoken = false) {
  const message = text.trim()
  if (!message || busy.value) {
    return
  }
  const previous = history()
  messages.value.push({ id: nextId++, role: 'user', content: message })
  draft.value = ''
  busy.value = true
  voiceNote.value = ''
  stopSpeaking()
  void scrollDown()
  let reply = ''

  try {
    const response = await askNavigator(message, previous)
    reply = response.reply
    messages.value.push({ id: nextId++, role: 'assistant', content: response.reply, source: response.source })
    emit('command', response.command)
  } catch (error) {
    const text =
      error instanceof ApiError && error.status === 429
        ? 'Забагато запитів. Спробуйте за хвилину.'
        : 'Не вдалося звʼязатися з провідником. Спробуйте ще раз.'
    reply = text
    messages.value.push({ id: nextId++, role: 'assistant', content: text, source: 'error' })
  } finally {
    busy.value = false
    void scrollDown()
    if (!spoken) {
      input.value?.focus()
    }
  }
  if (spoken && voiceReplies.value) {
    speak(reply)
  }
}
</script>

<template>
  <section class="dw-chat" :class="{ 'is-open': open }" aria-label="AI Navigator" @keydown.esc="onEscape">
    <button type="button" class="dw-chat__toggle" :aria-expanded="open" aria-controls="dw-chat-body" @click="open = !open">
      <span class="dw-chat__orb" aria-hidden="true" />
      <span>AI Navigator</span>
      <span class="dw-chat__mode">{{ provider ? PROVIDER_LABELS[provider] : 'Offline' }}</span>
    </button>

    <div v-show="open" id="dw-chat-body" class="dw-chat__body">
      <ol ref="log" class="dw-chat__log" aria-live="polite">
        <li v-for="message in messages" :key="message.id" class="dw-chat__msg" :class="[`is-${message.role}`, message.source && `is-${message.source}`]">
          {{ message.content }}
        </li>
        <li v-if="busy" class="dw-chat__msg is-assistant is-typing" aria-label="Провідник думає">
          <span /><span /><span />
        </li>
      </ol>

      <div v-if="messages.length < 3" class="dw-chat__suggestions">
        <button v-for="suggestion in suggestions" :key="suggestion" type="button" :disabled="busy" @click="send(suggestion)">
          {{ suggestion }}
        </button>
      </div>

      <form class="dw-chat__form" @submit.prevent="send()">
        <label class="dw-sr-only" for="dw-chat-input">Повідомлення провіднику</label>
        <input
          id="dw-chat-input"
          ref="input"
          v-model="draft"
          type="text"
          maxlength="500"
          autocomplete="off"
          :placeholder="voiceMode ? 'Слухаю…' : 'Куди летимо?'"
          :disabled="busy"
          :readonly="voiceMode"
        />
        <button
          v-if="canListen"
          type="button"
          class="dw-chat__mic"
          :class="{ 'is-on': voiceMode, 'is-listening': listening }"
          :disabled="busy && !voiceMode"
          :aria-pressed="voiceMode"
          :aria-label="voiceMode ? 'Вимкнути голосове керування' : 'Увімкнути голосове керування'"
          :title="voiceMode ? 'Вимкнути голосове керування' : 'Увімкнути голосове керування'"
          @click="toggleVoice"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
        <button type="submit" :disabled="busy || voiceMode || !draft.trim()" aria-label="Надіслати">↑</button>
      </form>

      <div v-if="canListen" class="dw-chat__voice">
        <p class="dw-chat__voice-note" role="status" aria-live="polite">
          <template v-if="voiceNote">{{ voiceNote }}</template>
          <template v-else-if="speaking">Озвучую відповідь. Esc — зупинити.</template>
          <template v-else-if="voiceMode">Голосове керування увімкнено: кожну фразу надсилаю одразу. Натисніть мікрофон, щоб вимкнути.</template>
        </p>
        <label v-if="canSpeak" class="dw-chat__voice-toggle">
          <input v-model="voiceReplies" type="checkbox" />
          Озвучувати відповіді
        </label>
      </div>
    </div>
  </section>
</template>
