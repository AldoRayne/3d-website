import { AVATAR_OPTIONS, type Avatar, type AvatarKey } from '@/world/avatar'

interface OptionName {
  id: string
  title: string
  stems: string[]
}

const PART_STEMS: Record<AvatarKey, string[]> = {
  skin: ['шкір', 'обличчя колір', 'тон шкір', 'засмаг', 'смагляв', 'skin'],
  face: ['обличч', 'бород', 'усміш', 'посміх', 'усміх', 'веснян', 'face'],
  hair: ['волос', 'колір волос', 'блонд', 'біляв', 'брюнет', 'рудий', 'рудим', 'рудою', 'руда', 'руде', 'hair'],
  hairStyle: ['зачіск', 'зачісц', 'стрижк', 'стрижц', 'гульк', 'гульц', 'пучок', 'їжач', 'лисий', 'лисим', 'лисою', 'лиса', 'під нуль', 'налисо', 'hairstyle'],
  jacket: ['куртк', 'куртц', 'кофт', 'кофтц', 'светр', 'jacket'],
  pants: ['штан', 'брюк', 'джинс', 'pants'],
  pack: ['рюкзак', 'наплічник', 'backpack'],
  hat: ['шапк', 'шапц', 'кепк', 'кепц', 'убір', 'убор', 'капелюх', 'hat', 'cap'],
  glasses: ['окуляр', 'glasses'],
}

const PART_TITLES: Record<AvatarKey, string> = {
  skin: 'шкіра',
  face: 'обличчя',
  hair: 'волосся',
  hairStyle: 'зачіска',
  jacket: 'куртка',
  pants: 'штани',
  pack: 'рюкзак',
  hat: 'убір',
  glasses: 'окуляри',
}

const COLOR = {
  red: ['червон'],
  orange: ['помаранч', 'оранж'],
  yellow: ['жовт'],
  green: ['зелен'],
  blue: ['синь', 'синій', 'сині', 'синя', 'синє', 'синю', 'синім', 'блакит'],
  navy: ['темно син', 'темносин'],
  purple: ['фіолет', 'бузков', 'сливов'],
  pink: ['рожев'],
  grey: ['сір', 'сив'],
  black: ['чорн'],
  white: ['біл', 'кремов', 'світл'],
  brown: ['коричнев', 'шоколад'],
  olive: ['оливк', 'хакі'],
  dark: ['темн', 'графіт'],
}

const option = (id: string, title: string, stems: string[]): OptionName => ({ id, title, stems })

const NAMES: Record<AvatarKey, Record<string, OptionName>> = {
  skin: {
    '#f7d8bd': option('lightest', 'найсвітліша', ['найсвітліш', 'бліда', 'бліди']),
    '#efc29a': option('light', 'світла', ['світл']),
    '#dca67c': option('medium', 'середня', ['середн']),
    '#b97d55': option('tan', 'засмагла', ['засмаг']),
    '#8d5a3b': option('brown', 'смаглява', ['смаглян', 'смагляв', 'коричнев']),
    '#5e3a26': option('dark', 'темна', ['найтемніш', 'темн']),
  },
  face: {
    calm: option('calm', 'спокійне', ['спокій', 'звичайн']),
    smile: option('smile', 'усмішка', ['усміш', 'посміш', 'посміх', 'усміх', 'весел']),
    freckles: option('freckles', 'веснянки', ['веснян', 'ластовин']),
    beard: option('beard', 'борода', ['бород']),
  },
  hair: {
    '#3a2618': option('dark-brown', 'темно-каштанове', ['каштан', 'темно корич']),
    '#1c1816': option('black', 'чорне', [...COLOR.black, 'брюнет']),
    '#7a4a26': option('brown', 'коричневе', COLOR.brown),
    '#c58a45': option('light-brown', 'русяве', ['рус', 'світло корич']),
    '#e6c87e': option('blond', 'біляве', ['біляв', 'блонд', 'світл', 'жовт']),
    '#a8462b': option('red', 'руде', ['руд', 'червон']),
    '#b9b4ad': option('grey', 'сиве', COLOR.grey),
    '#5b6fa8': option('blue', 'синє', COLOR.blue),
  },
  hairStyle: {
    short: option('short', 'коротка', ['коротк']),
    long: option('long', 'довга', ['довг']),
    bun: option('bun', 'гулька', ['гульк', 'гульц', 'пучок', 'пучк']),
    buzz: option('buzz', 'їжачок', ['їжач', 'під нуль', 'лисий', 'лисим', 'лисою', 'лиса', 'налисо']),
  },
  jacket: {
    '#e07a3c': option('orange', 'помаранчева', COLOR.orange),
    '#d24a46': option('red', 'червона', COLOR.red),
    '#e8b93a': option('yellow', 'жовта', COLOR.yellow),
    '#4f9a5a': option('green', 'зелена', COLOR.green),
    '#3c8fd6': option('blue', 'синя', COLOR.blue),
    '#5b4fc4': option('purple', 'фіолетова', COLOR.purple),
    '#c25a9b': option('pink', 'рожева', COLOR.pink),
    '#2f3a4a': option('dark', 'графітова', [...COLOR.dark, ...COLOR.black]),
    '#ece6d8': option('white', 'біла', COLOR.white),
    '#8a5a3c': option('brown', 'коричнева', COLOR.brown),
  },
  pants: {
    '#6d6a3e': option('olive', 'оливкові', [...COLOR.olive, ...COLOR.green]),
    '#2f3f5e': option('navy', 'темно-сині', COLOR.navy),
    '#3b3a3a': option('black', 'чорні', [...COLOR.black, ...COLOR.dark]),
    '#7a5634': option('brown', 'коричневі', COLOR.brown),
    '#a9a39a': option('grey', 'сірі', [...COLOR.grey, ...COLOR.white]),
    '#4a6a8a': option('blue', 'сині', [...COLOR.blue, 'джинс']),
    '#5a3d5c': option('purple', 'фіолетові', COLOR.purple),
    '#2e5a43': option('green', 'темно-зелені', ['темно зелен', ...COLOR.green]),
  },
  pack: {
    '#4f6b4a': option('green', 'зелений', COLOR.green),
    '#8a5a3c': option('brown', 'коричневий', COLOR.brown),
    '#3c6fa8': option('blue', 'синій', COLOR.blue),
    '#c24a3a': option('red', 'червоний', COLOR.red),
    '#e1b23a': option('yellow', 'жовтий', COLOR.yellow),
    '#3b3a3a': option('black', 'чорний', [...COLOR.black, ...COLOR.dark]),
    none: option('none', 'без рюкзака', ['без', 'зніми', 'прибер', 'не треба']),
  },
  hat: {
    none: option('none', 'без убору', ['без', 'зніми', 'прибер', 'не треба']),
    cap: option('cap', 'кепка', ['кепк', 'кепц', 'бейсболк', 'бейсболц']),
    beanie: option('beanie', 'шапка', ['шапк', 'шапц']),
  },
  glasses: {
    none: option('none', 'без окулярів', ['без', 'зніми', 'прибер', 'не треба']),
    round: option('round', 'круглі', ['кругл', 'звичайн']),
    shades: option('shades', 'темні', ['темн', 'сонцезахис', 'чорн']),
  },
}

const KEYS = Object.keys(AVATAR_OPTIONS) as AvatarKey[]
const SKIN_ORDER = Object.keys(NAMES.skin)
const WEARABLES: AvatarKey[] = ['hat', 'glasses', 'pack']
const CHANGE = /(?<=^|\s)(зміни|змінити|змінь|поміняй|поміняти|інш\S*|наступн\S*|інакш\S*)(?=\s|$)/u
const PUT_ON = /(?<=^|\s)(одягни|надінь|додай|хочу|дай)(?=\s|$)/u
const SHADE = /^(зроби )?(світліш\S*|темніш\S*)$/u

export function avatarCatalog() {
  return KEYS.map((key) => `${key}: ${(AVATAR_OPTIONS[key] as string[]).map((value) => NAMES[key][value]?.id ?? value).join('/')}`).join('; ')
}

export function describeAvatarOption(key: AvatarKey, value: string) {
  return `${PART_TITLES[key]}: ${NAMES[key][value]?.title ?? value}`
}

export function resolveAvatarValues(raw: string) {
  return raw
    .split(/[;,]/)
    .map((part) => resolveAvatarValue(part.trim()))
    .filter((item): item is { key: AvatarKey; value: string } => item !== null)
}

export function resolveAvatarValue(raw: string): { key: AvatarKey; value: string } | null {
  const [key, id] = raw.split('=').map((part) => part.trim()) as [AvatarKey, string]
  if (!KEYS.includes(key) || !id) {
    return null
  }
  const value = (AVATAR_OPTIONS[key] as string[]).find((option) => (NAMES[key][option]?.id ?? option) === id || option === id)
  return value ? { key, value } : null
}

function has(phrase: string, stems: string[]) {
  const padded = ` ${phrase}`
  return stems.some((stem) => padded.includes(` ${stem}`))
}

function partOf(phrase: string): AvatarKey | null {
  if (has(phrase, PART_STEMS.hairStyle)) {
    return 'hairStyle'
  }
  if (has(phrase, PART_STEMS.hair) && Object.values(NAMES.hairStyle).some((name) => has(phrase, name.stems))) {
    return 'hairStyle'
  }
  if (has(phrase, PART_STEMS.glasses)) {
    return 'glasses'
  }
  for (const key of KEYS) {
    if (key !== 'face' && has(phrase, PART_STEMS[key])) {
      return key
    }
  }
  if (has(phrase, PART_STEMS.face)) {
    return 'face'
  }
  return null
}

export function parseAvatarPhrases(phrase: string, current: Avatar, avatarPage = false) {
  if (avatarPage && SHADE.test(phrase)) {
    phrase = `шкіра ${phrase}`
  }
  const found = phrase
    .split(/(?<=^|\s)(?:і|та|й|ще|а також|також)(?=\s|$)/u)
    .map((part) => parseAvatarPhrase(part.trim(), current))
    .filter((item): item is { key: AvatarKey; value: string } => item !== null)
  return found.filter((item, index) => found.findIndex((other) => other.key === item.key) === index)
}

export function parseAvatarPhrase(phrase: string, current: Avatar): { key: AvatarKey; value: string } | null {
  const key = partOf(phrase)
  if (!key) {
    return null
  }
  if (key === 'skin' && /світліш|темніш/.test(phrase)) {
    const index = SKIN_ORDER.indexOf(current.skin)
    const next = SKIN_ORDER[clamp(index + (phrase.includes('темніш') ? 1 : -1), 0, SKIN_ORDER.length - 1)]
    return { key, value: next }
  }
  const names = NAMES[key]
  const options = (AVATAR_OPTIONS[key] as string[]).filter((value) => names[value])
  const ordered = [...options].sort((a, b) => Math.max(...names[b].stems.map((s) => s.length)) - Math.max(...names[a].stems.map((s) => s.length)))
  const found = ordered.find((value) => has(phrase, names[value].stems))
  if (found) {
    return { key, value: found }
  }
  const worn = options.filter((value) => value !== 'none')
  const changing = CHANGE.test(phrase)
  if (WEARABLES.includes(key) && !changing && (PUT_ON.test(phrase) || phrase.split(' ').length <= 2)) {
    return { key, value: current[key] !== 'none' && worn.includes(current[key] as string) ? (current[key] as string) : worn[0] }
  }
  if (!changing && !/(?<=^|\s)(колір|кольор\S*|тон)(?=\s|$)/u.test(phrase)) {
    return null
  }
  const order = key === 'skin' ? SKIN_ORDER : worn
  const index = order.indexOf(current[key] as string)
  return { key, value: order[(index + 1) % order.length] }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function randomAvatar(): Avatar {
  return Object.fromEntries(
    KEYS.map((key) => {
      const options = AVATAR_OPTIONS[key] as string[]
      return [key, options[Math.floor(Math.random() * options.length)]]
    }),
  ) as unknown as Avatar
}
