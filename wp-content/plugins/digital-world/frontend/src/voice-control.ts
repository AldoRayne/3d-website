import { computed, ref, watch } from 'vue'
import { canListen, listen, speak, speaking, stopSpeaking, type ListenError } from '@/voice'

export { canListen }

const VOICE_KEY = 'dw-navigator-voice'
const NOTES: Record<ListenError, string> = {
  denied: 'Немає доступу до мікрофона. Дозвольте його в налаштуваннях браузера.',
  silence: 'Нічого не почув.',
  network: 'Розпізнавання мовлення недоступне без інтернету.',
  failed: 'Не вдалося розпізнати мовлення.',
}

export type PhraseHandler = (text: string) => Promise<string | null>

export const voiceMode = ref(false)
export const listening = ref(false)
export const heard = ref('')
export const voiceNote = ref('')
export const voiceBusy = ref(false)
export const lastReply = ref('')
export const voiceReplies = ref(readPreference())

export const voiceStatus = computed(() => {
  if (voiceNote.value) {
    return voiceNote.value
  }
  if (speaking.value) {
    return 'Озвучую відповідь. Esc — зупинити.'
  }
  if (voiceBusy.value) {
    return 'Виконую…'
  }
  if (voiceMode.value) {
    return 'Слухаю. Натисніть мікрофон, щоб вимкнути.'
  }
  return ''
})

let handler: PhraseHandler | null = null
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

watch([voiceBusy, speaking], () => {
  if (!voiceBusy.value && !speaking.value) {
    startCapture()
  }
})

export function onPhrase(next: PhraseHandler | null) {
  handler = next
}

async function handle(text: string) {
  voiceBusy.value = true
  voiceNote.value = ''
  stopSpeaking()
  let reply: string | null = null
  try {
    reply = handler ? await handler(text) : null
  } finally {
    heard.value = ''
    voiceBusy.value = false
  }
  if (reply) {
    lastReply.value = reply
    if (voiceReplies.value) {
      speak(reply)
    }
  }
}

function startCapture() {
  window.clearTimeout(restartTimer)
  if (!voiceMode.value || session || voiceBusy.value || speaking.value) {
    return
  }
  session = listen({
    interim: (text) => {
      heard.value = text
    },
    done: (text) => {
      void handle(text)
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
