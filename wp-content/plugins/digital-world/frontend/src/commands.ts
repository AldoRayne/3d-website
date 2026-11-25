import type { NavigatorContext } from '@/types'

export type Availability = true | false | string

export interface LocalCommand {
  id: string
  phrases: string[]
  hint?: string
  available: (context: NavigatorContext) => Availability
  run: (context: NavigatorContext) => string | Promise<string>
}

const FILLERS = /(?<=^|\s)(будь ласка|будьласка|please|ну|а|давай|можеш|можна)(?=\s|$)/gu

export function normalizePhrase(text: string) {
  return text
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(FILLERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function createCommandSet(commands: LocalCommand[]) {
  const patterns = commands.map((command) => ({
    command,
    pattern: new RegExp(`^(?:${command.phrases.map(normalizePhrase).join('|')})$`, 'u'),
  }))

  function match(text: string) {
    const phrase = normalizePhrase(text)
    return patterns.find(({ pattern }) => pattern.test(phrase))?.command ?? null
  }

  function hints(context: NavigatorContext) {
    return commands.filter((command) => command.hint && command.available(context) === true).map((command) => command.hint as string)
  }

  async function run(text: string, context: NavigatorContext): Promise<string | null> {
    const command = match(text)
    if (!command) {
      return null
    }
    const availability = command.available(context)
    if (availability === false) {
      return null
    }
    if (typeof availability === 'string') {
      return availability
    }
    return command.run(context)
  }

  return { match, hints, run }
}
