import { ref } from 'vue'

const LANG = 'uk-UA'

interface RecognitionAlternative {
  transcript: string
}

interface RecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: RecognitionAlternative
}

interface RecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: { readonly length: number; [index: number]: RecognitionResult }
}

interface RecognitionErrorEvent extends Event {
  readonly error: string
}

interface Recognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionConstructor = new () => Recognition

const Recognizer: RecognitionConstructor | undefined =
  (window as unknown as { SpeechRecognition?: RecognitionConstructor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition

export const canListen = Boolean(Recognizer)

export type ListenError = 'denied' | 'silence' | 'network' | 'failed'

const ERRORS: Record<string, ListenError> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'audio-capture': 'denied',
  'no-speech': 'silence',
  network: 'network',
}

export interface ListenHandlers {
  interim: (text: string) => void
  done: (text: string) => void
  error: (error: ListenError) => void
  end: () => void
}

export function listen(handlers: ListenHandlers) {
  if (!Recognizer) {
    return null
  }
  const recognition = new Recognizer()
  recognition.lang = LANG
  recognition.continuous = false
  recognition.interimResults = true
  recognition.maxAlternatives = 1
  let heard = ''
  let cancelled = false
  let failed = false

  recognition.onresult = (event) => {
    let text = ''
    for (let index = 0; index < event.results.length; index++) {
      text += event.results[index][0].transcript
    }
    heard = text.trim()
    handlers.interim(heard)
  }
  recognition.onerror = (event) => {
    if (event.error === 'aborted') {
      return
    }
    failed = true
    handlers.error(ERRORS[event.error] ?? 'failed')
  }
  recognition.onend = () => {
    if (!cancelled && !failed && heard) {
      handlers.done(heard)
    } else if (!cancelled && !failed) {
      handlers.error('silence')
    }
    handlers.end()
  }

  try {
    recognition.start()
  } catch {
    return null
  }

  return {
    stop: () => recognition.stop(),
    cancel: () => {
      cancelled = true
      recognition.abort()
    },
  }
}

const synth = 'speechSynthesis' in window ? window.speechSynthesis : null
let voice: SpeechSynthesisVoice | null = null
let utterance: SpeechSynthesisUtterance | null = null

export const canSpeak = ref(false)
export const speaking = ref(false)

function pickVoice() {
  const voices = synth?.getVoices() ?? []
  voice = voices.find((item) => item.lang.replace('_', '-').toLowerCase().startsWith('uk')) ?? null
  canSpeak.value = Boolean(voice)
}

if (synth) {
  pickVoice()
  synth.addEventListener('voiceschanged', pickVoice)
}

export function speak(text: string) {
  if (!synth || !voice) {
    return
  }
  stopSpeaking()
  utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = voice
  utterance.lang = voice.lang
  const current = utterance
  current.onend = current.onerror = () => {
    if (utterance === current) {
      utterance = null
      speaking.value = false
    }
  }
  speaking.value = true
  synth.speak(current)
}

export function stopSpeaking() {
  utterance = null
  speaking.value = false
  synth?.cancel()
}
