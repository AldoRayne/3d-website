import { createCommandSet, type CommandArgs, type LocalCommand } from '@/commands'
import { movementCommands } from '@/movement-commands'
import { voiceCommands, type VoiceDeps } from '@/voice-commands'
import { DEFAULT_AVATAR, type Avatar } from '@/world/avatar'
import type { NavigatorContext, WorldObject } from '@/types'
import type { State } from './cases'

const globals = globalThis as Record<string, unknown>
globals.document = { querySelector: () => null, querySelectorAll: () => [] }
globals.window = { location: { assign() {} }, history: { back() {} }, setTimeout, clearTimeout }

const BUILDINGS: Array<[string, string, string[]]> = [
  ['about-us', 'About Us', ['about', 'company', 'team', 'про нас', 'компанія', 'команда', 'хто ми']],
  ['services', 'Services', ['services', 'послуги', 'що ми робимо', 'розробка', 'пропозиція']],
  ['blog', 'Blog', ['blog', 'news', 'блог', 'новини', 'статті', 'бібліотека']],
  ['portfolio', 'Portfolio', ['portfolio', 'портфоліо', 'проєкти', 'кейси', 'роботи']],
  ['contact', 'Contact', ['contact', 'контакти', 'звʼязатися', 'написати', 'замовити']],
]

export const objects = BUILDINGS.map(([slug, title, keywords]) => ({ slug, title, page_title: title, keywords, url: `/${slug}/` })) as unknown as WorldObject[]

export const STATES: Record<State, NavigatorContext> = {
  world: { screen: 'world', bookPage: null, signedIn: true, visiting: false, near: null, reading: null, selected: null },
  guest: { screen: 'world', bookPage: null, signedIn: false, visiting: false, near: null, reading: null, selected: null },
  door: { screen: 'world', bookPage: null, signedIn: true, visiting: false, near: 'blog', reading: null, selected: null },
  guestDoor: { screen: 'world', bookPage: null, signedIn: false, visiting: false, near: 'blog', reading: null, selected: null },
  stand: { screen: 'world', bookPage: null, signedIn: true, visiting: false, near: '@stand', reading: null, selected: null },
  guestStand: { screen: 'world', bookPage: null, signedIn: false, visiting: false, near: '@stand', reading: null, selected: null },
  visiting: { screen: 'world', bookPage: null, signedIn: false, visiting: true, near: null, reading: null, selected: null },
  reading: { screen: 'reading', bookPage: null, signedIn: true, visiting: false, near: 'blog', reading: 'Blog', selected: null },
  book: { screen: 'book', bookPage: 'guest', signedIn: false, visiting: false, near: '@stand', reading: null, selected: null },
  island: { screen: 'book', bookPage: 'island', signedIn: true, visiting: false, near: '@stand', reading: null, selected: 'blog' },
  avatar: { screen: 'book', bookPage: 'avatar', signedIn: true, visiting: false, near: '@stand', reading: null, selected: null },
}

export const island = { selected: null as string | null }
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
  readingText: () => 'Текст сторінки.',
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
    lastAction: () => set.lastId(),
    runById: (id: string, context: NavigatorContext) => set.runById(id, context, {}),
    readAloud: () => true,
    changeVolume: () => 1,
  } as Record<string, unknown>,
  { get: (target, key: string) => (key in target ? target[key] : async () => null) },
) as unknown as VoiceDeps

export const executed: Array<{ id: string; args: CommandArgs }> = []
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

export const set = createCommandSet([...voiceCommands(deps), ...movementCommands(() => scene as never, () => {}, false)].map(wrap))
