<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { askNavigator, ApiError } from '@/api'
import type { ChatTurn, NavigatorCommand } from '@/types'

defineProps<{ aiEnabled: boolean }>()
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

async function send(text = draft.value) {
  const message = text.trim()
  if (!message || busy.value) {
    return
  }
  const previous = history()
  messages.value.push({ id: nextId++, role: 'user', content: message })
  draft.value = ''
  busy.value = true
  void scrollDown()

  try {
    const response = await askNavigator(message, previous)
    messages.value.push({ id: nextId++, role: 'assistant', content: response.reply, source: response.source })
    emit('command', response.command)
  } catch (error) {
    const text =
      error instanceof ApiError && error.status === 429
        ? 'Забагато запитів. Спробуйте за хвилину.'
        : 'Не вдалося звʼязатися з провідником. Спробуйте ще раз.'
    messages.value.push({ id: nextId++, role: 'assistant', content: text, source: 'error' })
  } finally {
    busy.value = false
    void scrollDown()
    input.value?.focus()
  }
}
</script>

<template>
  <section class="dw-chat" :class="{ 'is-open': open }" aria-label="AI Navigator">
    <button type="button" class="dw-chat__toggle" :aria-expanded="open" aria-controls="dw-chat-body" @click="open = !open">
      <span class="dw-chat__orb" aria-hidden="true" />
      <span>AI Navigator</span>
      <span class="dw-chat__mode">{{ aiEnabled ? 'Claude' : 'Offline' }}</span>
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
          placeholder="Куди летимо?"
          :disabled="busy"
        />
        <button type="submit" :disabled="busy || !draft.trim()" aria-label="Надіслати">↑</button>
      </form>
    </div>
  </section>
</template>
