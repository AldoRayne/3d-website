<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { askNavigator, ApiError } from '@/api'
import { canSpeak, speaking, stopSpeaking } from '@/voice'
import { canListen, cancelVoice, heard, listening, toggleVoice, voiceMode, voiceReplies, voiceStatus } from '@/voice-control'
import type { AiProvider, ChatTurn, NavigatorCommand, NavigatorContext, Reply } from '@/types'

const props = defineProps<{
  provider: AiProvider | null
  context: () => NavigatorContext
  local?: (text: string) => Promise<Reply | null>
  execute?: (command: NavigatorCommand) => Promise<{ ok: boolean; text: string; quiet?: boolean } | null>
  urgent?: (text: string) => Promise<{ id: string; ok: boolean; reply: Reply } | null>
  blocked?: () => string | null
}>()

const PROVIDER_LABELS: Record<AiProvider, string> = { claude: 'Claude', ollama: 'Ollama', openai: 'OpenAI', gemini: 'Gemini' }

interface Message extends ChatTurn {
  id: number
  source?: 'ai' | 'fallback' | 'local' | 'error' | 'aside'
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
let request: AbortController | null = null

watch(heard, (text) => {
  if (voiceMode.value && text) {
    draft.value = text
  }
})

watch(draft, () => {
  if (!voiceMode.value && speaking.value) {
    stopSpeaking()
  }
})

function onEscape(event: KeyboardEvent) {
  if (cancelVoice()) {
    event.stopPropagation()
    draft.value = ''
  }
}

async function scrollDown() {
  await nextTick()
  log.value?.scrollTo({ top: log.value.scrollHeight })
}

function history(): ChatTurn[] {
  return messages.value
    .slice(1)
    .filter((message) => message.source !== 'error' && message.source !== 'local' && message.source !== 'aside')
    .slice(-6)
    .map(({ role, content }) => ({ role, content }))
}

function answer(content: string, source: Message['source'], quiet = false): Reply {
  messages.value.push({ id: nextId++, role: 'assistant', content, source })
  return { text: content, quiet }
}

async function interject(message: string, reason: string | null): Promise<Reply> {
  messages.value.push({ id: nextId++, role: 'user', content: message, source: 'aside' })
  draft.value = ''
  void scrollDown()
  const urgent = await props.urgent?.(message)
  if (urgent?.id === 'stop' && request) {
    request.abort()
    if (!urgent.ok) {
      return answer('Зупинив.', 'aside', true)
    }
  }
  if (urgent) {
    return answer(urgent.reply.text, urgent.ok ? 'aside' : 'error', urgent.reply.quiet)
  }
  return answer(reason ?? 'Ще виконую попередню команду. Зачекайте або скажіть «стоп».', 'error')
}

async function ask(text = draft.value, spoken = false): Promise<Reply | null> {
  const message = text.trim()
  if (!message) {
    return null
  }
  const reason = busy.value ? null : (props.blocked?.() ?? null)
  if (busy.value || reason) {
    return interject(message, reason)
  }
  const previous = history()
  const asked = { id: nextId++, role: 'user' as const, content: message }
  const controller = new AbortController()
  messages.value.push(asked)
  draft.value = ''
  busy.value = true
  void scrollDown()

  try {
    const local = await props.local?.(message)
    if (local) {
      return answer(local.text, 'local', local.quiet)
    }
    request = controller
    let response
    try {
      response = await askNavigator(message, previous, props.context(), controller.signal)
    } finally {
      request = null
    }
    const outcome = await props.execute?.(response.command)
    if (!outcome) {
      return answer(response.reply, response.source)
    }
    return outcome.ok ? answer(outcome.text, response.source, outcome.quiet) : answer(outcome.text, 'error')
  } catch (error) {
    if (controller.signal.aborted) {
      messages.value = messages.value.filter((item) => item.id !== asked.id)
      return null
    }
    return answer(
      error instanceof ApiError && error.status === 429
        ? 'Забагато запитів. Спробуйте за хвилину.'
        : 'Не вдалося звʼязатися з провідником. Спробуйте ще раз.',
      'error',
    )
  } finally {
    busy.value = false
    void scrollDown()
    if (!spoken) {
      input.value?.focus()
    }
  }
}

function setOpen(value: boolean) {
  open.value = value
}

function lastAnswer() {
  const message = [...messages.value].reverse().find((item) => item.role === 'assistant' && item.source !== 'error')
  return message?.content ?? null
}

defineExpose({ ask, setOpen, lastAnswer })
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
        <button v-for="suggestion in suggestions" :key="suggestion" type="button" :disabled="busy" @click="ask(suggestion)">
          {{ suggestion }}
        </button>
      </div>

      <form class="dw-chat__form" @submit.prevent="ask()">
        <label class="dw-sr-only" for="dw-chat-input">Повідомлення провіднику</label>
        <input
          id="dw-chat-input"
          ref="input"
          v-model="draft"
          type="text"
          maxlength="500"
          autocomplete="off"
          :placeholder="voiceMode ? 'Слухаю…' : 'Куди летимо?'"
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
        <button type="submit" :disabled="voiceMode || !draft.trim()" aria-label="Надіслати">↑</button>
      </form>

      <div v-if="canListen" class="dw-chat__voice">
        <p class="dw-chat__voice-note" role="status" aria-live="polite">
          {{ voiceStatus }}
        </p>
        <label v-if="canSpeak" class="dw-chat__voice-toggle">
          <input v-model="voiceReplies" type="checkbox" />
          Озвучувати відповіді
        </label>
      </div>
    </div>
  </section>
</template>
