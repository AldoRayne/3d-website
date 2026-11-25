import { createCommandSet, type CommandArgs, type LocalCommand } from '@/commands'
import { movementCommands } from '@/movement-commands'
import { voiceCommands, type VoiceDeps } from '@/voice-commands'
import { DEFAULT_AVATAR, type Avatar } from '@/world/avatar'
import type { NavigatorContext, WorldObject } from '@/types'
import { CASES, type PhraseCase, type State } from './cases'

const globals = globalThis as Record<string, unknown>
globals.document = { querySelector: () => null, querySelectorAll: () => [] }
globals.window = { location: { assign() {} }, setTimeout, clearTimeout }

const BUILDINGS: Array<[string, string, string[]]> = [
  ['about-us', 'About Us', ['about', 'company', 'team', 'про нас', 'компанія', 'команда', 'хто ми']],
  ['services', 'Services', ['services', 'послуги', 'що ми робимо', 'розробка', 'пропозиція']],
  ['blog', 'Blog', ['blog', 'news', 'блог', 'новини', 'статті', 'бібліотека']],
  ['portfolio', 'Portfolio', ['portfolio', 'портфоліо', 'проєкти', 'кейси', 'роботи']],
  ['contact', 'Contact', ['contact', 'контакти', 'звʼязатися', 'написати', 'замовити']],
]

const objects = BUILDINGS.map(([slug, title, keywords]) => ({ slug, title, page_title: title, keywords, url: `/${slug}/` })) as unknown as WorldObject[]

const STATES: Record<State, NavigatorContext> = {
  world: { screen: 'world', bookPage: null, signedIn: true, visiting: false, near: null, reading: null, selected: null },
  guest: { screen: 'world', bookPage: null, signedIn: false, visiting: false, near: null, reading: null, selected: null },
  door: { screen: 'world', bookPage: null, signedIn: true, visiting: false, near: 'blog', reading: null, selected: null },
  visiting: { screen: 'world', bookPage: null, signedIn: false, visiting: true, near: null, reading: null, selected: null },
  reading: { screen: 'reading', bookPage: null, signedIn: true, visiting: false, near: 'blog', reading: 'Blog', selected: null },
  book: { screen: 'book', bookPage: 'guest', signedIn: false, visiting: false, near: 'stand', reading: null, selected: null },
  island: { screen: 'book', bookPage: 'island', signedIn: true, visiting: false, near: 'stand', reading: null, selected: 'blog' },
  avatar: { screen: 'book', bookPage: 'avatar', signedIn: true, visiting: false, near: 'stand', reading: null, selected: null },
}

const island = { selected: null as string | null }
const sceneTarget: Record<string, unknown> = {
  get islandSelected() {
    return island.selected
  },
  selectIsland: (slug: string | null) => (island.selected = slug),
  moveIslandBuilding: (_: string, cells: number) => ({ moved: cells, problem: 'none' }),
  readingLinks: [
    { text: 'Contact us', href: '/contact/' },
    { text: 'Read more', href: '/blog/first-post/' },
  ],
  readingSections: [{ text: 'Latest posts' }, { text: 'Archive' }],
}
const scene = new Proxy(sceneTarget, { get: (target, key: string) => (key in target ? target[key] : () => true) })

let avatar: Avatar = { ...DEFAULT_AVATAR }
const deps = new Proxy(
  {
    scene: () => scene,
    objects: () => objects,
    homeUrl: () => '/',
    visitReturnUrl: '/wp-admin/users.php',
    registrationOpen: true,
    animating: () => false,
    islandMode: () => 'top',
    avatar: () => avatar,
    setAvatar: (next: Avatar) => (avatar = next),
    hints: () => [],
    ensureBook: async () => null,
    go: async (slug: string, action: string) => (action === 'open' ? `Відкриваю «${slug}».` : `Іду до «${slug}».`),
    lastReply: () => 'Попередня відповідь.',
    again: (context: NavigatorContext) => set.again(context),
  } as Record<string, unknown>,
  { get: (target, key: string) => (key in target ? target[key] : async () => null) },
) as unknown as VoiceDeps

const executed: Array<{ id: string; args: CommandArgs }> = []
const wrap = (command: LocalCommand): LocalCommand => ({
  ...command,
  run: async (context, args) => {
    const result = await command.run(context, args)
    if (result !== null) {
      executed.push({ id: command.id, args })
    }
    return result
  },
})

const set = createCommandSet([...voiceCommands(deps), ...movementCommands(() => scene as never, () => {}, false)].map(wrap))

interface Outcome {
  id: string
  args?: CommandArgs
  text?: string
}

async function outcome(state: State, phrase: string): Promise<Outcome> {
  executed.length = 0
  const reply = await set.run(phrase, STATES[state])
  const last = executed.at(-1)
  if (last) {
    return { id: last.id, args: last.args, text: reply?.text }
  }
  return reply ? { id: 'refused', text: reply.text } : { id: 'server' }
}

function mismatch(item: PhraseCase, got: Outcome) {
  if (got.id !== item.expect) {
    return true
  }
  return (['value', 'amount', 'text', 'target'] as const).some((key) => item[key] !== undefined && got.args?.[key] !== item[key])
}

const failures: string[] = []
const byState = new Map<State, { local: number; total: number }>()
for (const item of CASES) {
  island.selected = STATES[item.state].selected
  for (const phrase of item.before ?? []) {
    await outcome(item.state, phrase)
  }
  const got = await outcome(item.state, item.phrase)
  const stats = byState.get(item.state) ?? { local: 0, total: 0 }
  stats.total++
  stats.local += got.id === 'server' ? 0 : 1
  byState.set(item.state, stats)
  if (mismatch(item, got)) {
    const args = got.args ? ` ${JSON.stringify(Object.fromEntries(Object.entries(got.args).filter(([, value]) => value !== null && value !== false)))}` : ''
    failures.push(`  ${item.state.padEnd(8)} «${item.phrase}» → очікувано ${item.expect}, отримано ${got.id}${args}${got.text ? ` («${got.text}»)` : ''}`)
  }
}

const local = [...byState.values()].reduce((sum, stats) => sum + stats.local, 0)
console.log(`Фраз: ${CASES.length}, збігається: ${CASES.length - failures.length}, локально: ${local}, на сервер: ${CASES.length - local}`)
console.log([...byState].map(([state, stats]) => `${state} ${stats.local}/${stats.total}`).join(' · '))
if (failures.length) {
  console.log(`\nРозбіжності (${failures.length}):\n${failures.join('\n')}`)
  process.exitCode = 1
}
