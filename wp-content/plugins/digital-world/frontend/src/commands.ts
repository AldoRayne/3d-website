import type { NavigatorActionInfo, NavigatorContext, Reply } from '@/types'

export type Availability = true | false | string

export interface CommandArgs {
  amount: number | null
  value: string | null
  text: string | null
  target: string | null
  direct: boolean
}

export interface Failure {
  fail: string
}

export type Phrase = string | [phrase: string, value: string]

export interface LocalCommand {
  id: string
  phrases?: Phrase[]
  parse?: (phrase: string, context: NavigatorContext) => Partial<CommandArgs> | null
  hint?: string
  quiet?: boolean
  transition?: boolean
  repeatable?: boolean
  describe?: string
  values?: (context: NavigatorContext) => string[]
  available: (context: NavigatorContext) => Availability
  run: (context: NavigatorContext, args: CommandArgs) => string | Failure | null | Promise<string | Failure | null>
}

export interface CommandResult {
  ok: boolean
  text: string
  quiet?: boolean
}

export const NUMBER = 'xnumx'
export const TEXT = 'xtextx'

export function fail(text: string): Failure {
  return { fail: text }
}

const FILLERS = /(?<=^|\s)(будь ласка|будьласка|please|ну|а|давай|можеш|можна|будь)(?=\s|$)/gu
const PRONOUNS = /(?<=^|\s)(?<!до\s)(мене|мені)(?=\s|$)/gu
const REPEATS = /(?<=^|\s)(\S+)(?:\s\1)+(?=\s|$)/gu
const UNIT_WORDS: Record<string, number> = {
  один: 1,
  одна: 1,
  одне: 1,
  одного: 1,
  одну: 1,
  два: 2,
  дві: 2,
  двох: 2,
  пару: 2,
  три: 3,
  трьох: 3,
  чотири: 4,
  чотирьох: 4,
  "п'ять": 5,
  "п'яти": 5,
  шість: 6,
  шести: 6,
  сім: 7,
  семи: 7,
  вісім: 8,
  восьми: 8,
  "дев'ять": 9,
  "дев'яти": 9,
}
const TEEN_WORDS: Record<string, number> = {
  десять: 10,
  десяти: 10,
  одинадцять: 11,
  дванадцять: 12,
  тринадцять: 13,
  чотирнадцять: 14,
  "п'ятнадцять": 15,
  шістнадцять: 16,
  сімнадцять: 17,
  вісімнадцять: 18,
  "дев'ятнадцять": 19,
}
const TEN_WORDS: Record<string, number> = {
  двадцять: 20,
  тридцять: 30,
  сорок: 40,
  "п'ятдесят": 50,
  шістдесят: 60,
  сімдесят: 70,
  вісімдесят: 80,
  "дев'яносто": 90,
}
const HUNDRED_WORDS: Record<string, number> = {
  сто: 100,
  двісті: 200,
  триста: 300,
  чотириста: 400,
  "п'ятсот": 500,
  шістсот: 600,
  сімсот: 700,
  вісімсот: 800,
  "дев'ятсот": 900,
}
const NUMBER_RANKS = [HUNDRED_WORDS, TEN_WORDS, TEEN_WORDS, UNIT_WORDS]

function wordsToNumbers(text: string) {
  const out: string[] = []
  let total = 0
  let rank = -1
  const flush = () => {
    if (rank >= 0) {
      out.push(String(total))
    }
    total = 0
    rank = -1
  }
  for (const word of text.split(' ')) {
    const next = NUMBER_RANKS.findIndex((words) => word in words)
    if (next < 0) {
      flush()
      out.push(word)
      continue
    }
    if (next <= rank || (rank === 1 && next === 2) || rank === 2) {
      flush()
    }
    total += NUMBER_RANKS[next][word]
    rank = next
  }
  flush()
  return out.join(' ')
}
const UNITS = /(\d+) (кроків|кроки|крок|метрів|метри|метр|м|градусів|градуси|градус|клітинок|клітинки|клітинку|клітинка)(?=\s|$)/gu

export function normalizePhrase(text: string) {
  return text
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(FILLERS, ' ')
    .replace(PRONOUNS, ' ')
    .replace(/\s+/g, ' ')
    .replace(REPEATS, '$1')
    .trim()
    .replace(/.+/, wordsToNumbers)
    .replace(UNITS, '$1')
}

const LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', "'": '',
}

function latin(text: string) {
  return [...text].map((char) => LATIN[char] ?? char).join('')
}

function loose(text: string) {
  return latin(normalizePhrase(text)).replace(/kh/g, 'h').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function stem(word: string) {
  return word.slice(0, Math.max(4, Math.ceil(word.length * 0.7)))
}

export function similarity(query: string, candidate: string) {
  const a = loose(query)
  const b = loose(candidate)
  if (!a || !b) {
    return 0
  }
  if (a === b) {
    return 100
  }
  if (b.includes(a) || a.includes(b)) {
    return 60 + Math.min(a.length, b.length)
  }
  const words = a.split(' ').filter((word) => word.length >= 3)
  const targets = b.split(' ').filter((word) => word.length >= 3)
  const hits = words.filter((word) => targets.some((target) => target.startsWith(stem(word)) || word.startsWith(stem(target)))).length
  return hits ? 20 + hits * 10 : 0
}

export function bestMatch<T>(query: string, items: T[], terms: (item: T) => Array<string | null | undefined>, threshold = 30) {
  let best: T | null = null
  let score = threshold - 1
  for (const item of items) {
    for (const term of terms(item)) {
      const value = term ? similarity(query, term) : 0
      if (value > score) {
        best = item
        score = value
      }
    }
  }
  return best
}

interface Pattern {
  command: LocalCommand
  regex: RegExp
  groups: Array<'amount' | 'text'>
  value: string | null
}

function compile(command: LocalCommand, phrase: Phrase): Pattern {
  const [text, value] = typeof phrase === 'string' ? [phrase, null] : phrase
  const groups: Array<'amount' | 'text'> = []
  const source = normalizePhrase(text).replace(/xnumx|xtextx/g, (token) => {
    groups.push(token === NUMBER ? 'amount' : 'text')
    return token === NUMBER ? '(\\d+)' : '(.+?)'
  })
  return { command, regex: new RegExp(`^${source}$`, 'u'), groups, value }
}

const EMPTY: CommandArgs = { amount: null, value: null, text: null, target: null, direct: false }

export function createCommandSet(commands: LocalCommand[]) {
  const patterns = commands.flatMap((command) => (command.phrases ?? []).map((phrase) => compile(command, phrase)))
  const byId = new Map(commands.map((command) => [command.id, command]))
  let last: { command: LocalCommand; args: CommandArgs } | null = null

  function matches(text: string, context: NavigatorContext) {
    const phrase = normalizePhrase(text)
    const found: Array<{ command: LocalCommand; args: CommandArgs }> = []
    for (const command of commands) {
      for (const pattern of patterns) {
        if (pattern.command !== command) {
          continue
        }
        const hit = pattern.regex.exec(phrase)
        if (!hit) {
          continue
        }
        const args = { ...EMPTY, value: pattern.value }
        pattern.groups.forEach((group, index) => {
          const raw = hit[index + 1]
          if (group === 'amount') {
            args.amount = Number(raw)
          } else {
            args.text = raw
          }
        })
        found.push({ command, args })
        break
      }
      if (command.parse && !found.some((item) => item.command === command)) {
        const parsed = command.parse(phrase, context)
        if (parsed) {
          found.push({ command, args: { ...EMPTY, ...parsed } })
        }
      }
    }
    return found
  }

  function match(text: string, context: NavigatorContext) {
    return matches(text, context)[0]?.command ?? null
  }

  function hints(context: NavigatorContext) {
    return commands.filter((command) => command.hint && command.available(context) === true).map((command) => command.hint as string)
  }

  function actions(context: NavigatorContext): NavigatorActionInfo[] {
    return commands
      .filter((command) => command.describe && command.available(context) === true)
      .map((command) => ({ id: command.id, description: command.describe as string, values: command.values?.(context) ?? [] }))
  }

  async function execute(command: LocalCommand, context: NavigatorContext, args: CommandArgs): Promise<CommandResult | null> {
    if (context.screen === 'entering' && !command.transition) {
      return { ok: false, text: 'Зачекайте, ще йде перехід.' }
    }
    const availability = command.available(context)
    if (availability !== true) {
      return { ok: false, text: typeof availability === 'string' ? availability : 'Зараз це недоступно.' }
    }
    const result = await command.run(context, args)
    if (result === null) {
      return null
    }
    if (command.repeatable && typeof result === 'string') {
      last = { command, args }
    }
    return typeof result === 'string' ? { ok: true, text: result, quiet: command.quiet } : { ok: false, text: result.fail }
  }

  async function run(text: string, context: NavigatorContext): Promise<Reply | null> {
    let reason: string | null = null
    for (const { command, args } of matches(text, context)) {
      if (context.screen === 'entering' && !command.transition) {
        reason ??= 'Зачекайте, ще йде перехід.'
        continue
      }
      const availability = command.available(context)
      if (availability === false) {
        continue
      }
      if (typeof availability === 'string') {
        reason ??= availability
        continue
      }
      const result = await execute(command, context, args)
      if (result) {
        return { text: result.text, quiet: result.ok ? result.quiet : false }
      }
    }
    return reason ? { text: reason } : null
  }

  async function runById(id: string, context: NavigatorContext, args: Partial<CommandArgs>): Promise<CommandResult | null> {
    const command = byId.get(id)
    if (!command) {
      return null
    }
    return (await execute(command, context, { ...EMPTY, ...args, direct: true })) ?? { ok: false, text: 'Не вдалося це виконати.' }
  }

  async function again(context: NavigatorContext): Promise<CommandResult | null> {
    return last ? execute(last.command, context, last.args) : null
  }

  async function urgent(text: string, context: NavigatorContext): Promise<{ id: string; ok: boolean; reply: Reply } | null> {
    for (const { command, args } of matches(text, context)) {
      if (!command.transition || command.available(context) === false) {
        continue
      }
      const result = await execute(command, context, args)
      if (result) {
        return { id: command.id, ok: result.ok, reply: { text: result.text, quiet: result.ok ? result.quiet : false } }
      }
    }
    return null
  }

  function lastId() {
    return last?.command.id ?? null
  }

  function isTransition(id: string) {
    return Boolean(byId.get(id)?.transition)
  }

  return { match, hints, actions, run, runById, urgent, again, lastId, isTransition }
}
