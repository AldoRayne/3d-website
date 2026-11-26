import { computed, ref, watch } from 'vue'
import { canListen, canSpeak, listen, speak, speaking, stopSpeaking, type ListenError } from '@/voice'
import type { Reply } from '@/types'

export { canListen }

const VOICE_KEY = 'dw-navigator-voice'
const ECHO_DELAY = 700
const ECHO_WINDOW = 3000
const NOTES: Record<ListenError, string> = {
  denied: 'Немає доступу до мікрофона. Дозвольте його в налаштуваннях браузера.',
  silence: 'Нічого не почув.',
  network: 'Розпізнавання мовлення недоступне без інтернету.',
  failed: 'Не вдалося розпізнати мовлення.',
}

export type PhraseHandler = (text: string) => Promise<Reply | null>

export const voiceMode = ref(false)
export const listening = ref(false)
export const heard = ref('')
export const voiceNote = ref('')
export const voiceBusy = ref(false)
export const voiceHold = ref(false)
export const lastReply = ref('')
export const voiceReplies = ref(readPreference())

export const voiceStatus = computed(() => {
  if (voiceNote.value) {
    return voiceNote.value
  }
  if (speaking.value) {
    return 'Озвучую відповідь. Esc — зупинити.'
  }
  if (voiceBusy.value || voiceHold.value) {
    return listening.value ? 'Виконую… Можна сказати «стоп».' : 'Виконую…'
  }
  if (voiceMode.value) {
    return 'Слухаю. Натисніть мікрофон, щоб вимкнути.'
  }
  return ''
})

let handler: PhraseHandler | null = null
let current: Promise<void> | null = null
let spokenText = ''
let spokenEndedAt = 0
let session: ReturnType<typeof listen> = null
let restartTimer = 0

function readPreference() {
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

watch([voiceBusy, speaking], ([, nowSpeaking], [, wasSpeaking]) => {
  if (wasSpeaking && !nowSpeaking) {
    spokenEndedAt = performance.now()
  }
  if (speaking.value) {
    return
  }
  window.clearTimeout(restartTimer)
  if (wasSpeaking) {
    restartTimer = window.setTimeout(startCapture, ECHO_DELAY)
  } else {
    startCapture()
  }
})

function words(text: string) {
  return text
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isEcho(text: string) {
  if (!spokenText || performance.now() - spokenEndedAt > ECHO_WINDOW + ECHO_DELAY) {
    return false
  }
  const heardWords = words(text)
  return heardWords.length > 0 && words(spokenText).includes(heardWords)
}

function say(text: string) {
  spokenText = text
  speak(text)
}

export function onPhrase(next: PhraseHandler | null) {
  handler = next
}

async function dispatch(text: string) {
  if (current || voiceHold.value) {
    await aside(text)
    return
  }
  const job = handle(text)
  current = job
  await job
  current = null
}

async function aside(text: string) {
  const reply = handler ? await handler(text) : null
  heard.value = ''
  if (reply && voiceReplies.value && !reply.quiet) {
    say(reply.text)
  }
}

async function handle(text: string) {
  voiceBusy.value = true
  voiceNote.value = ''
  stopSpeaking()
  let reply: Reply | null = null
  try {
    reply = handler ? await handler(text) : null
  } finally {
    heard.value = ''
    voiceBusy.value = false
  }
  if (reply) {
    lastReply.value = reply.text
    if (voiceReplies.value && !reply.quiet) {
      say(reply.text)
    }
  }
}

export function readAloud(text: string) {
  if (!canSpeak.value) {
    return false
  }
  session?.cancel()
  say(text)
  return true
}

export function announce(text: string) {
  if (!voiceMode.value) {
    return
  }
  lastReply.value = text
  if (voiceReplies.value && !voiceBusy.value) {
    session?.cancel()
    say(text)
  }
}

function startCapture() {
  window.clearTimeout(restartTimer)
  if (!voiceMode.value || session || speaking.value) {
    return
  }
  session = listen({
    interim: (text) => {
      heard.value = text
    },
    done: (text) => {
      void dispatch(text)
    },
    error: (error) => {
      heard.value = ''
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

export function stopVoice(error?: ListenError) {
  voiceMode.value = false
  window.clearTimeout(restartTimer)
  if (error) {
    voiceNote.value = NOTES[error]
  }
}

export function toggleVoice() {
  if (voiceMode.value) {
    stopVoice()
    session?.stop()
    return
  }
  stopSpeaking()
  voiceNote.value = ''
  lastReply.value = ''
  heard.value = ''
  voiceMode.value = true
  startCapture()
}

export function cancelVoice() {
  if (speaking.value) {
    stopSpeaking()
    return true
  }
  if (voiceMode.value) {
    stopVoice()
    session?.cancel()
    heard.value = ''
    return true
  }
  return false
}

export function disposeVoice() {
  stopVoice()
  session?.cancel()
  stopSpeaking()
}
