import { nextTick } from 'vue'
import { bestMatch, fail, NUMBER, TEXT, type Availability, type CommandResult, type Failure, type LocalCommand, type Phrase } from '@/commands'
import { avatarCatalog, describeAvatarOption, parseAvatarPhrases, randomAvatar, resolveAvatarValues } from '@/avatar-voice'
import { STAND_SLUG } from '@/world/stand'
import type { Avatar } from '@/world/avatar'
import type { WorldScene } from '@/world/WorldScene'
import type { NavigatorContext, WorldObject } from '@/types'

export interface VoiceDeps {
  scene: () => WorldScene | null
  objects: () => WorldObject[]
  homeUrl: () => string
  visitReturnUrl: string | null
  registrationOpen: boolean
  animating: () => boolean
  hurry: () => void
  overview: () => void
  enter: (slug: string) => Promise<void>
  leaveScreens: () => Promise<void>
  exitReading: () => void
  openRegularPage: () => void
  openLink: (href: string) => void
  openBook: () => Promise<void>
  closeBook: () => Promise<void>
  ensureBook: () => Promise<string | null>
  switchPage: (page: 'island' | 'avatar') => Promise<void>
  islandMode: () => 'top' | 'angled'
  setIslandMode: (mode: 'top' | 'angled') => void
  resetIsland: () => Promise<void>
  resetCharacter: () => Promise<void>
  signOut: () => Promise<void>
  avatar: () => Avatar
  setAvatar: (avatar: Avatar) => void
  setChatOpen: (open: boolean) => void
  stopVoice: () => void
  setReplies: (on: boolean) => void
  hints: (context: NavigatorContext) => string[]
  go: (slug: string, action: 'navigate' | 'open') => Promise<string | Failure>
  lastReply: () => string | null
  again: (context: NavigatorContext) => Promise<CommandResult | null>
  lastAction: () => string | null
  cancel: () => void
  runById: (id: string, context: NavigatorContext) => Promise<CommandResult | null>
  readAloud: (text: string) => boolean
  changeVolume: (delta: number) => number
}

const CONFIRM_WINDOW = 20000
const SELECTED_WORDS = new Set(['будинок', 'його', 'цей', 'цей будинок', 'його будинок', 'вибраний', 'вибраний будинок', 'виділений', 'виділений будинок'])
const ISLAND_STEP = 2
const SMALL_ACTIONS = new Set(['step_forward', 'step_back', 'nudge_left', 'nudge_right', 'zoom_in', 'zoom_out', 'read_down', 'read_up', 'island_move'])
const VOLUME_STEP = 0.25
const DIRECTIONS: Record<string, string[]> = {
  up: ['вгору', 'угору', 'вище', 'нагору'],
  down: ['вниз', 'донизу', 'нижче', 'додолу'],
  left: ['ліворуч', 'вліво', 'наліво', 'лівіше'],
  right: ['праворуч', 'вправо', 'направо', 'правіше'],
}
const DIRECTION_TITLES: Record<string, string> = { up: 'вгору', down: 'вниз', left: 'ліворуч', right: 'праворуч' }
const PROBLEMS: Record<string, string> = {
  outside: 'там край острова',
  overlap: 'там інший будинок',
  'door-blocked': 'двері впруться в інший будинок',
  'blocks-door': 'так буде закрито чужі двері',
  none: 'спершу виберіть будинок',
}

function waitFor<T extends Element>(selector: string, timeout = 3000): Promise<T | null> {
  return new Promise((resolve) => {
    const started = performance.now()
    const tick = () => {
      const element = document.querySelector<T>(selector)
      if (element || performance.now() - started > timeout) {
        resolve(element)
        return
      }
      window.setTimeout(tick, 80)
    }
    tick()
  })
}

function fill(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export function voiceCommands(deps: VoiceDeps): LocalCommand[] {
  let pending: { action: () => Promise<string>; until: number } | null = null

  const ask = (question: string, action: () => Promise<string>) => {
    pending = { action, until: Date.now() + CONFIRM_WINDOW }
    return `${question} Скажіть «так», щоб підтвердити, або «ні».`
  }

  const building = (query: string | null, target: string | null, threshold = 30) => {
    const objects = deps.objects()
    if (target) {
      const found = objects.find((object) => object.slug === target)
      if (found) {
        return found
      }
    }
    return query ? bestMatch(query, objects, (object) => [object.title, object.slug, object.page_title, ...object.keywords], threshold) : null
  }

  const world = (context: NavigatorContext): Availability => context.screen === 'world'
  const reading = (context: NavigatorContext) => context.screen === 'reading'
  const onIslandPage = (context: NavigatorContext) => context.screen === 'book' && context.bookPage === 'island'
  const islandProblem = (context: NavigatorContext) =>
    context.visiting ? 'У гостьовому перегляді острів не змінити.' : context.signedIn ? null : 'Щоб змінити острів, увійдіть: скажіть «увійти».'
  const islandBuilding = async ({ context, text, target, direct }: { context: NavigatorContext; text: string | null; target: string | null; direct: boolean }): Promise<WorldObject | Failure | null | undefined> => {
    const here = onIslandPage(context)
    if (text && SELECTED_WORDS.has(text)) {
      text = null
    }
    if (!text && !target) {
      return here ? undefined : direct ? fail(islandProblem(context) ?? 'Який саме будинок? Скажіть, наприклад, «посунь блог вліво».') : null
    }
    const object = target ? building(null, target) : building(text, null, here ? 30 : 100)
    if (!object) {
      return target ? fail('Не знайшов такого будинку.') : null
    }
    if (!here) {
      const problem = islandProblem(context)
      if (problem) {
        return fail(problem)
      }
      const failure = await deps.ensureBook()
      if (failure) {
        return fail(failure)
      }
      await deps.switchPage('island')
    }
    deps.scene()?.selectIsland(object.slug)
    return object
  }
  const member = (context: NavigatorContext): Availability => {
    if (context.visiting) {
      return 'У гостьовому перегляді це недоступно.'
    }
    return context.signedIn || 'Спершу увійдіть: скажіть «увійти».'
  }

  const directionPhrases = (): Phrase[] =>
    Object.entries(DIRECTIONS).flatMap(([direction, words]) =>
      words.flatMap((word): Phrase[] => [
        [`посунь ${TEXT} на ${NUMBER} ${word}`, direction],
        [`пересунь ${TEXT} на ${NUMBER} ${word}`, direction],
        [`посунь ${TEXT} ${word} ${NUMBER}`, direction],
        [`посунь на ${NUMBER} ${word}`, direction],
        [`посунь ${word} ${NUMBER}`, direction],
        [`на ${NUMBER} ${word}`, direction],
        [`${word} ${NUMBER}`, direction],
        [`${NUMBER} ${word}`, direction],
        [`посунь ${TEXT} трохи ${word}`, `${direction}:small`],
        [`посунь трохи ${TEXT} ${word}`, `${direction}:small`],
        [`пересунь ${TEXT} трохи ${word}`, `${direction}:small`],
        [`посунь трохи ${word}`, `${direction}:small`],
        [`трохи ${word}`, `${direction}:small`],
        [`посунь ${TEXT} ${word} на ${NUMBER}`, direction],
        [`пересунь ${TEXT} ${word} на ${NUMBER}`, direction],
        [`посунь ${TEXT} ${word}`, direction],
        [`пересунь ${TEXT} ${word}`, direction],
        [`перенеси ${TEXT} ${word}`, direction],
        [`посунь ${word} на ${NUMBER}`, direction],
        [`${word} на ${NUMBER}`, direction],
        [`посунь ${word}`, direction],
        [`пересунь ${word}`, direction],
        [`посунь будинок ${word}`, direction],
        [word, direction],
      ]),
    )

  const submitted = async (form: HTMLFormElement, mode: 'login' | 'register'): Promise<string | Failure> => {
    const started = performance.now()
    while (performance.now() - started < 15000) {
      await new Promise((resolve) => window.setTimeout(resolve, 150))
      if (!form.isConnected) {
        return mode === 'login' ? 'Ви увійшли.' : 'Акаунт створено, ви увійшли.'
      }
      const errors = [...form.querySelectorAll('.dw-auth__error')].map((node) => node.textContent?.trim()).filter(Boolean)
      if (errors.length && form.getAttribute('aria-busy') !== 'true') {
        return fail(errors.join(' '))
      }
    }
    return fail('Форма не відповіла. Спробуйте натиснути кнопку вручну.')
  }

  const focusAuth = async (mode: 'login' | 'register'): Promise<string | Failure> => {
    const failure = await deps.ensureBook()
    if (failure) {
      return fail(failure)
    }
    await nextTick()
    const tab = [...document.querySelectorAll<HTMLButtonElement>('.dw-bookpage__tab')].find((button) =>
      button.textContent?.trim().startsWith(mode === 'login' ? 'Вхід' : 'Реєстрація'),
    )
    tab?.click()
    const field = await waitFor<HTMLInputElement>(mode === 'login' ? '#dw-login-email' : '#dw-register-name')
    if (!field) {
      return fail(mode === 'register' && !deps.registrationOpen ? 'Реєстрацію зараз закрито.' : 'Не вдалося відкрити форму.')
    }
    const form = field.form
    const email = form?.querySelector<HTMLInputElement>(`#dw-${mode}-email`)
    const password = form?.querySelector<HTMLInputElement>(`#dw-${mode}-password`)
    if (email?.value && password?.value && (mode === 'login' || field.value)) {
      const consent = form?.querySelector<HTMLInputElement>('#dw-register-consent')
      if (consent && !consent.checked) {
        return fail('Ще потрібна згода з умовами: скажіть «погоджуюсь».')
      }
      form?.requestSubmit()
      return submitted(form as HTMLFormElement, mode)
    }
    const empty = [field, email, password].find((input) => input && !input.value) ?? field
    empty.focus({ preventScroll: true })
    return mode === 'login'
      ? 'Відкрив форму входу. Введіть email і пароль з клавіатури, а потім скажіть «увійти» ще раз.'
      : "Відкрив реєстрацію. Ім'я можна сказати: «моє ім'я …». Email і пароль введіть з клавіатури."
  }

  return [
    {
      id: 'confirm',
      describe: 'Answer "yes" to the question that is waiting for confirmation.',
      phrases: ['так', 'підтверджую', 'так підтверджую', 'так скинь', 'звісно', 'авжеж', 'ага', 'угу', 'роби', 'скидай', 'згоден', 'згодна', 'yes'],
      transition: true,
      available: () => (pending && pending.until > Date.now() ? true : false),
      run: async () => {
        const action = pending?.action
        pending = null
        return action ? action() : fail('Немає що підтверджувати.')
      },
    },
    {
      id: 'cancel',
      describe: 'Answer "no" to the question that is waiting for confirmation.',
      phrases: ['ні', 'скасуй', 'скасувати', 'відміна', 'не треба', 'ні не треба', 'не скидай', 'передумав', 'передумала', 'залиш як є', 'no'],
      transition: true,
      available: () => (pending && pending.until > Date.now() ? true : false),
      run: () => {
        pending = null
        return 'Скасовано.'
      },
    },
    {
      id: 'hurry',
      describe: 'Skip the animation that is playing right now (entering a building or opening the book).',
      phrases: ['швидше', 'скоріше', 'пропусти', 'пропусти анімацію', 'не чекати', 'skip'],
      transition: true,
      quiet: true,
      available: () => deps.animating() || 'Зараз нічого не програється.',
      run: () => {
        deps.hurry()
        return 'Пропускаю.'
      },
    },
    {
      id: 'where_am_i',
      describe: 'Tell the visitor where they are and what is right next to them.',
      phrases: ['де я', 'де я зараз', 'де я знаходжусь', 'де я перебуваю', 'що це за місце', 'де ми', 'що поруч', 'що тут поруч', 'що навколо', 'що це за будинок', 'що це за будівля', 'що переді мною', 'біля чого я', 'де я стою'],
      available: () => true,
      run: (context) => {
        const near = context.near ? building(null, context.near) : null
        if (context.screen === 'reading') {
          return `Ви читаєте сторінку «${context.reading ?? ''}». Скажіть «вийди», щоб повернутися на острів.`
        }
        if (context.screen === 'book') {
          const page = { guest: 'сторінка входу й реєстрації', island: 'розкладка вашого острова', avatar: 'редактор персонажа' }[context.bookPage ?? 'guest']
          return `Перед вами книга гостей, відкрита ${page}.`
        }
        if (context.near === STAND_SLUG) {
          return 'Ви біля книги гостей у центрі острова.'
        }
        return near ? `Ви біля дверей «${near.title}». Скажіть «зайди», щоб увійти.` : 'Ви на острові. Скажіть, куди піти, або «які є розділи».'
      },
    },
    {
      id: 'list_sections',
      describe: 'List the sections (buildings) of the island.',
      phrases: ['які є розділи', 'які розділи', 'які тут є розділи', 'які тут розділи', 'що тут є', 'список розділів', 'куди можна піти', 'що є на острові', 'які є будинки', 'які тут будинки', 'які є сторінки', 'що є на сайті', 'покажи список', 'перелік розділів'],
      available: () => true,
      run: () => {
        const titles = deps.objects().map((object) => object.title)
        return `На острові: ${titles.join(', ')}, а ще книга гостей у центрі.`
      },
    },
    {
      id: 'regular_site',
      describe: 'Leave the 3D world and open the regular website.',
      phrases: ['звичайний сайт', 'на звичайний сайт', 'перейди на звичайний сайт', 'відкрий звичайний сайт', 'вийди зі світу', 'вийти зі світу', 'вийди з 3d', 'на сайт'],
      available: () => true,
      run: () => {
        window.location.assign(deps.homeUrl())
        return 'Відкриваю звичайний сайт.'
      },
    },
    {
      id: 'exit_visit',
      describe: "Stop viewing another member's island and return.",
      phrases: ['вийти з перегляду', 'вийди з перегляду', 'заверши перегляд', 'закінчи перегляд', 'поверни мене назад', 'поверни мене', 'назад до себе', 'повернутися до себе', 'на мій острів'],
      available: (context) => context.visiting && Boolean(deps.visitReturnUrl),
      run: () => {
        window.location.assign(deps.visitReturnUrl as string)
        return 'Завершую перегляд.'
      },
    },
    {
      id: 'replies_off',
      describe: 'Stop reading replies aloud.',
      phrases: ['вимкни озвучку', 'вимкни озвучування', 'не озвучуй', 'без озвучки', 'мовчи', 'помовч', 'замовкни', 'тихо', 'вимкни звук', 'без звуку', 'не говори вголос', 'не розмовляй'],
      available: () => true,
      quiet: true,
      run: () => {
        deps.setReplies(false)
        return 'Озвучку вимкнено.'
      },
    },
    {
      id: 'replies_on',
      describe: 'Read replies aloud again.',
      phrases: ['увімкни озвучку', 'увімкни озвучування', 'озвучуй', 'говори вголос', 'читай відповіді'],
      available: () => true,
      run: () => {
        deps.setReplies(true)
        return 'Озвучку увімкнено.'
      },
    },
    {
      id: 'volume_up',
      describe: 'Read replies aloud louder.',
      phrases: ['голосніше', 'гучніше', 'говори голосніше', 'говори гучніше', 'зроби голосніше', 'додай гучності'],
      available: () => true,
      run: () => {
        deps.setReplies(true)
        const before = deps.changeVolume(0)
        const volume = deps.changeVolume(VOLUME_STEP)
        return volume === before ? 'Гучніше вже нікуди.' : `Гучність ${Math.round(volume * 100)}%.`
      },
    },
    {
      id: 'volume_down',
      describe: 'Read replies aloud more quietly.',
      phrases: ['тихіше', 'говори тихіше', 'зроби тихіше', 'зменш гучність', 'трохи тихіше'],
      available: () => true,
      run: () => {
        const before = deps.changeVolume(0)
        const volume = deps.changeVolume(-VOLUME_STEP)
        return volume === before ? 'Тихіше вже нікуди. Скажіть «вимкни озвучку», щоб я мовчав.' : `Гучність ${Math.round(volume * 100)}%.`
      },
    },
    {
      id: 'chat_hide',
      describe: 'Collapse the navigator chat panel.',
      phrases: ['сховай чат', 'згорни чат', 'закрий чат', 'прибери чат'],
      available: () => true,
      quiet: true,
      run: () => {
        deps.setChatOpen(false)
        return 'Чат згорнуто.'
      },
    },
    {
      id: 'chat_show',
      describe: 'Expand the navigator chat panel.',
      phrases: ['покажи чат', 'розгорни чат', 'відкрий чат'],
      available: () => true,
      quiet: true,
      run: () => {
        deps.setChatOpen(true)
        return 'Чат відкрито.'
      },
    },
    {
      id: 'enter',
      describe: 'Go inside the building the visitor is standing next to and read its page, or open the guest book when standing next to it.',
      phrases: [['увійди', 'door'], ['увійти', 'door'], ['вхід', 'door'], 'вхід в будинок', 'вхід у будинок', 'зайди в будинок', 'зайди у будинок', 'зайди до будинку', 'увійди в будинок', 'зайди всередину будинку', 'зайди сюди', 'заходимо всередину', 'зайди', 'зайти', 'увійди всередину', 'заходь', 'заходимо', 'заходь всередину', 'зайди всередину', 'відкрий', 'відкрий сторінку', 'відкрий двері', 'відчини двері', 'читати', 'почитати', 'enter', 'open'],
      hint: '«зайди» біля дверей',
      available: (context) => context.screen === 'world' && context.near !== null && !(context.near === STAND_SLUG && context.visiting),
      run: async (context, { value }) => {
        if (context.near === STAND_SLUG) {
          if (value === 'door' && !context.signedIn) {
            return null
          }
          const failure = await deps.ensureBook()
          return failure ? fail(failure) : 'Книгу відкрито.'
        }
        const object = building(null, context.near)
        if (!object) {
          return fail('Тут немає дверей.')
        }
        if (!object.url) {
          return fail(`«${object.title}» поки зачинена.`)
        }
        void deps.enter(object.slug)
        return `Заходжу в «${object.title}».`
      },
    },
    {
      id: 'read_here',
      describe: 'Inside a page: align the view so the text in front is easy to read.',
      phrases: ['читати', 'читай', 'почитати', 'вирівняй', 'вирівняй текст', 'читати тут', 'читай тут', 'для читання'],
      quiet: true,
      available: reading,
      run: () => {
        deps.scene()?.readHere()
        return 'Вирівнюю для читання.'
      },
    },
    {
      id: 'read_top',
      describe: 'Inside a page: go back to the top of the page.',
      phrases: ['на початок', 'на початок сторінки', 'до початку', 'вгору сторінки', 'на самий верх'],
      quiet: true,
      available: reading,
      run: () => {
        deps.scene()?.readTop()
        return 'На початок сторінки.'
      },
    },
    {
      id: 'read_bottom',
      describe: 'Inside a page: go to the end of the page.',
      phrases: ['в кінець', 'до кінця', 'в кінець сторінки', 'на самий низ', 'до низу'],
      quiet: true,
      available: reading,
      run: () => (deps.scene()?.readBottom() ? 'В кінець сторінки.' : fail('Не вдалося прокрутити.')),
    },
    {
      id: 'read_down',
      describe: 'Inside a page: scroll one screen down.',
      phrases: ['далі', 'ще далі', 'вниз', 'нижче', 'гортай', 'гортай вниз', 'гортай далі', 'гортай ще', 'прокрути', 'прокрути вниз', 'прокрути далі', 'прокрути ще', 'листай', 'листай далі', 'листай ще', 'наступний екран', 'читай далі', 'що далі'],
      hint: '«далі»',
      quiet: true,
      repeatable: true,
      available: reading,
      run: () => {
        const moved = deps.scene()?.readStep(1)
        return moved ? 'Далі.' : moved === false ? fail('Це вже кінець сторінки.') : fail('Не вдалося прокрутити.')
      },
    },
    {
      id: 'read_up',
      describe: 'Inside a page: scroll one screen up.',
      phrases: ['вгору', 'угору', 'вверх', 'вище', 'гортай вгору', 'гортай назад', 'прокрути вгору', 'прокрути назад', 'листай вгору', 'листай назад', 'назад вгору', 'попередній екран'],
      quiet: true,
      repeatable: true,
      available: reading,
      run: () => {
        const moved = deps.scene()?.readStep(-1)
        return moved ? 'Вище.' : moved === false ? fail('Це вже початок сторінки.') : fail('Не вдалося прокрутити.')
      },
    },
    {
      id: 'page_back',
      describe: 'Inside a page: go back to the previously read page.',
      phrases: ['попередня сторінка', 'на попередню сторінку', 'на попередню', 'назад на попередню сторінку', 'назад на попередню', 'повернись на попередню', 'повернись на попередню сторінку', 'поверни попередню сторінку'],
      available: reading,
      run: () => {
        window.history.back()
        return 'Повертаюся на попередню сторінку.'
      },
    },
    {
      id: 'read_aloud',
      describe: 'Inside a page: read aloud the text on the screen, or value = rest to read from here to the end of the page.',
      values: () => ['screen', 'rest'],
      phrases: [
        'прочитай',
        'прочитай це',
        'прочитай текст',
        'прочитай вголос',
        'читай вголос',
        'прочитай що тут',
        'прочитай що написано',
        'що тут написано',
        ['прочитай сторінку', 'rest'],
        ['прочитай всю сторінку', 'rest'],
        ['прочитай усе', 'rest'],
        ['прочитай все', 'rest'],
        ['прочитай до кінця', 'rest'],
        ['читай сторінку вголос', 'rest'],
        ['читай вголос далі', 'rest'],
        ['прочитай далі', 'rest'],
      ],
      quiet: true,
      available: reading,
      run: (_, { value }) => {
        const text = deps.scene()?.readingText(value === 'rest' ? 'rest' : 'screen') ?? ''
        if (!text) {
          return fail('Тут немає тексту для читання.')
        }
        return deps.readAloud(text) ? 'Читаю вголос. Esc — зупинити.' : text
      },
    },
    {
      id: 'regular_page',
      describe: 'Inside a page: open the same page on the regular website.',
      phrases: ['звичайна сторінка', 'відкрий звичайну сторінку', 'покажи як на сайті', 'відкрий на сайті', 'відкрий на звичайному сайті', 'на звичайному сайті', 'покажи на звичайному сайті', 'відкрий цю сторінку на сайті', 'звичайний вигляд сторінки'],
      available: reading,
      run: () => {
        deps.openRegularPage()
        return 'Відкриваю звичайну сторінку.'
      },
    },
    {
      id: 'go_section',
      describe: 'Inside a page: fly to a heading of the page. value = the heading text from the list.',
      values: () => (deps.scene()?.readingSections ?? []).map((section) => section.text).slice(0, 30),
      phrases: [`до розділу ${TEXT}`, `перейди до розділу ${TEXT}`, `покажи розділ ${TEXT}`, `розділ ${TEXT}`, `до заголовка ${TEXT}`],
      available: reading,
      run: (_, { value, text }) => {
        const sections = deps.scene()?.readingSections ?? []
        const query = value ?? text ?? ''
        const section = sections.find((item) => item.text === query) ?? bestMatch(query, sections, (item) => [item.text])
        if (!section) {
          if (!value) {
            return null
          }
          return fail(sections.length ? `Не знайшов такого розділу. Є: ${sections.slice(0, 6).map((item) => item.text).join(', ')}.` : 'На цій сторінці немає розділів.')
        }
        return deps.scene()?.readSection(section.y) ? `Розділ «${section.text}».` : fail('Не вдалося перейти до розділу.')
      },
    },
    {
      id: 'follow_link',
      describe: 'Inside a page: follow a link of the page. value = the link text from the list.',
      values: () => (deps.scene()?.readingLinks ?? []).map((link) => link.text).slice(0, 40),
      phrases: [`перейди за посиланням ${TEXT}`, `відкрий посилання ${TEXT}`, `посилання ${TEXT}`, `натисни ${TEXT}`, `перейди на ${TEXT}`, `відкрий ${TEXT}`],
      available: reading,
      run: (_, { value, text }) => {
        const links = deps.scene()?.readingLinks ?? []
        const query = value ?? text ?? ''
        const link = links.find((item) => item.text === query) ?? bestMatch(query, links, (item) => [item.text, item.href])
        if (!link) {
          if (!value) {
            return null
          }
          return fail(links.length ? `Не знайшов такого посилання. Є: ${links.slice(0, 6).map((item) => item.text).join(', ')}.` : 'На цій сторінці немає посилань.')
        }
        deps.openLink(link.href)
        return `Відкриваю «${link.text}».`
      },
    },
    {
      id: 'open_book',
      describe: 'Walk to the guest book in the middle of the island and open it.',
      phrases: ['відкрий книгу', 'відкрити книгу', 'відкрий книгу гостей', 'відкрити книгу гостей', 'книга гостей', 'гостьова книга', 'до книги', 'до книги гостей', 'йди до книги', 'йди до книги гостей'],
      hint: '«відкрий книгу»',
      available: (context) => {
        if (context.visiting) {
          return 'У гостьовому перегляді книга недоступна.'
        }
        return context.screen === 'book' ? 'Книга вже відкрита.' : true
      },
      run: async () => {
        const failure = await deps.ensureBook()
        return failure ? fail(failure) : 'Книгу відкрито.'
      },
    },
    {
      id: 'close_book',
      describe: 'Close the guest book.',
      phrases: ['закрий книгу', 'закрити книгу', 'сховай книгу'],
      hint: '«закрий книгу»',
      available: (context) => context.screen === 'book' || 'Книга зараз не відкрита.',
      run: async () => {
        await deps.closeBook()
        return 'Закриваю книгу.'
      },
    },
    {
      id: 'leave',
      describe: 'Leave the current page or close the book and return to the island.',
      phrases: ['вийди', 'вийти', 'вихід', 'назад', 'повернись назад', 'на вулицю', 'вийди на вулицю', 'вийди з будинку', 'вийти з будинку', 'закрий', 'закрити', 'exit', 'back'],
      hint: '«вийди»',
      available: (context) => context.screen === 'reading' || context.screen === 'book',
      run: async (context) => {
        if (context.screen === 'reading') {
          deps.exitReading()
          return 'Виходжу на вулицю.'
        }
        await deps.closeBook()
        return 'Закриваю книгу.'
      },
    },
    {
      id: 'open_building',
      phrases: [
        `відкрий ${TEXT}`,
        `відкрий сторінку ${TEXT}`,
        `відкрий розділ ${TEXT}`,
        `зайди в ${TEXT}`,
        `зайди у ${TEXT}`,
        `зайди до ${TEXT}`,
        `увійди в ${TEXT}`,
        `увійди до ${TEXT}`,
        `покажи ${TEXT}`,
        `покажи сторінку ${TEXT}`,
        `почитати ${TEXT}`,
        `хочу почитати ${TEXT}`,
      ],
      available: () => true,
      run: (_, { text }) => {
        const object = building(text, null)
        return object ? deps.go(object.slug, 'open') : null
      },
    },
    {
      id: 'go_building',
      phrases: [
        `веди до ${TEXT}`,
        `відведи до ${TEXT}`,
        `проведи до ${TEXT}`,
        `йди до ${TEXT}`,
        `іди до ${TEXT}`,
        `піди до ${TEXT}`,
        `перейди до ${TEXT}`,
        `пішли до ${TEXT}`,
        `ходімо до ${TEXT}`,
        `летимо до ${TEXT}`,
        `де ${TEXT}`,
        `де знаходиться ${TEXT}`,
        `як дійти до ${TEXT}`,
      ],
      available: () => true,
      run: (_, { text }) => {
        const object = building(text, null)
        return object ? deps.go(object.slug, 'navigate') : null
      },
    },
    {
      id: 'sign_in',
      describe: 'Open the sign in form in the guest book (walks there if needed) and submit it once filled. Email and password are typed, never dictated.',
      phrases: ['увійти', 'увійди', 'вхід', 'залогінитись', 'залогінься', 'увійти в акаунт', 'увійди в акаунт', 'хочу увійти', 'sign in', 'log in'],
      hint: '«увійти»',
      available: (context) => (context.visiting ? 'У гостьовому перегляді вхід недоступний.' : context.signedIn ? 'Ви вже увійшли.' : true),
      run: () => focusAuth('login'),
    },
    {
      id: 'register',
      describe: 'Open the registration form in the guest book (walks there if needed) and submit it once filled.',
      phrases: ['зареєструватися', 'зареєструйся', 'зареєструй мене', 'реєстрація', 'створити акаунт', 'створи акаунт', 'новий акаунт', 'sign up', 'register'],
      available: (context) => (context.visiting ? 'У гостьовому перегляді реєстрація недоступна.' : context.signedIn ? 'Ви вже увійшли.' : true),
      run: () => focusAuth('register'),
    },
    {
      id: 'my_name',
      describe: 'Type the visitor\'s name into the registration form. value = the name.',
      phrases: [`моє ім'я ${TEXT}`, `моє імя ${TEXT}`, `мене звати ${TEXT}`, `ім'я ${TEXT}`, `імя ${TEXT}`, `звати ${TEXT}`],
      available: (context) => context.screen === 'book' && context.bookPage === 'guest' && Boolean(document.querySelector('#dw-register-name')),
      run: (_, { value, text }) => {
        const input = document.querySelector<HTMLInputElement>('#dw-register-name')
        const name = (value ?? text ?? '').trim()
        if (!input || !name) {
          return fail('Не почув імені.')
        }
        const formatted = name.replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase())
        fill(input, formatted)
        input.form?.querySelector<HTMLInputElement>('#dw-register-email')?.focus({ preventScroll: true })
        return `Записав ім'я ${formatted}. Тепер введіть email і пароль з клавіатури.`
      },
    },
    {
      id: 'consent',
      describe: 'Tick or untick the consent to data processing in the registration form. value = yes or no.',
      values: () => ['yes', 'no'],
      phrases: [
        ['погоджуюсь', 'yes'],
        ['погоджуюся', 'yes'],
        ['я погоджуюсь', 'yes'],
        ['даю згоду', 'yes'],
        ['згоден', 'yes'],
        ['згодна', 'yes'],
        ['погоджуюсь з умовами', 'yes'],
        ['прийняти умови', 'yes'],
        ['не погоджуюсь', 'no'],
        ['зніми згоду', 'no'],
      ],
      available: () => Boolean(document.querySelector('#dw-register-consent')),
      run: (_, { value }) => {
        const box = document.querySelector<HTMLInputElement>('#dw-register-consent')
        if (!box) {
          return fail('Форми реєстрації зараз немає.')
        }
        const checked = value !== 'no'
        if (box.checked !== checked) {
          box.click()
        }
        return checked ? 'Згоду відмічено.' : 'Згоду знято.'
      },
    },
    {
      id: 'remember_me',
      describe: 'Tick or untick "remember me" in the sign in or registration form. value = yes or no.',
      values: () => ['yes', 'no'],
      phrases: [
        ["запам'ятай мене", 'yes'],
        ['запамятай мене', 'yes'],
        ["запам'ятати мене", 'yes'],
        ["не запам'ятовуй", 'no'],
        ['не запамятовуй', 'no'],
        ["не запам'ятовуй мене", 'no'],
      ],
      available: () => Boolean(document.querySelector('#dw-login-remember, #dw-register-remember')),
      run: (_, { value }) => {
        const boxes = [...document.querySelectorAll<HTMLInputElement>('#dw-login-remember, #dw-register-remember')]
        const checked = value !== 'no'
        boxes.filter((box) => box.checked !== checked).forEach((box) => box.click())
        return checked ? 'Запам\'ятаю вас.' : 'Не запам\'ятовуватиму.'
      },
    },
    {
      id: 'sign_out',
      describe: 'Sign out of the account.',
      phrases: ['вийти з акаунта', 'вийди з акаунта', 'вийти з акаунту', 'вийди з акаунту', 'розлогінитись', 'розлогінься', 'вийти з облікового запису', 'sign out', 'log out'],
      available: (context) => context.signedIn || 'Ви й так не увійшли.',
      run: async () => {
        await deps.signOut()
        return 'Виходжу з акаунта.'
      },
    },
    {
      id: 'book_page',
      describe: 'Open the guest book (walking there if needed) on a member page. value = island (arrange buildings) or avatar (design the character).',
      values: () => ['island', 'avatar'],
      phrases: [
        ['мій острів', 'island'],
        ['розкладка острова', 'island'],
        ['сторінка острова', 'island'],
        ['до острова', 'island'],
        ['редактор острова', 'island'],
        ['налаштуй острів', 'island'],
        ['відкрий острів', 'island'],
        ['відкрий мій острів', 'island'],
        ['покажи мій острів', 'island'],
        ['змінити острів', 'island'],
        ['зміни острів', 'island'],
        ['редагувати острів', 'island'],
        ['редагуй острів', 'island'],
        ['переставити будинки', 'island'],
        ['перестав будинки', 'island'],
        ['переставляти будинки', 'island'],
        ['персонаж', 'avatar'],
        ['мій персонаж', 'avatar'],
        ['сторінка персонажа', 'avatar'],
        ['редактор персонажа', 'avatar'],
        ['створи персонажа', 'avatar'],
        ['створити персонажа', 'avatar'],
        ['налаштуй персонажа', 'avatar'],
        ['змінити персонажа', 'avatar'],
        ['зміни персонажа', 'avatar'],
        ['змінити вигляд', 'avatar'],
        ['відкрий персонажа', 'avatar'],
        ['покажи персонажа', 'avatar'],
        ['покажи мого персонажа', 'avatar'],
        ['редагувати персонажа', 'avatar'],
        ['редагуй персонажа', 'avatar'],
        ['переверни сторінку', 'toggle'],
        ['перегорни сторінку', 'toggle'],
        ['наступна сторінка', 'toggle'],
        ['гортай сторінку', 'toggle'],
        ['перегорни', 'toggle'],
      ],
      available: member,
      run: async (context, { value }) => {
        const failure = await deps.ensureBook()
        if (failure) {
          return fail(failure)
        }
        const page = value === 'toggle' ? (context.bookPage === 'avatar' ? 'island' : 'avatar') : value === 'avatar' ? 'avatar' : 'island'
        await deps.switchPage(page)
        return page === 'avatar' ? 'Сторінка персонажа: скажіть, що змінити, наприклад «червона куртка».' : 'Сторінка вашого острова: виберіть будинок і посуньте його.'
      },
    },
    {
      id: 'island_view',
      describe: 'On the island page of the book: switch the view. value = top (from above) or angled (3D at an angle).',
      values: () => ['top', 'angled'],
      phrases: [
        ['вид згори', 'top'],
        ['вид зверху', 'top'],
        ['згори', 'top'],
        ['зверху', 'top'],
        ['план', 'top'],
        ['під кутом', 'angled'],
        ['вид під кутом', 'angled'],
        ['збоку', 'angled'],
        ['вид збоку', 'angled'],
        ["об'ємно", 'angled'],
        ['3d', 'angled'],
      ],
      quiet: true,
      available: (context) => context.screen === 'book' && context.bookPage === 'island',
      run: (_, { value }) => {
        const mode = value === 'angled' ? 'angled' : 'top'
        deps.setIslandMode(mode)
        return mode === 'top' ? 'Вид згори.' : 'Вид під кутом.'
      },
    },
    {
      id: 'island_select',
      describe: "Select a building on the visitor's own island to move or rotate; opens the book on the island page if needed. target = its slug.",
      phrases: [`вибери ${TEXT}`, `обери ${TEXT}`, `виділи ${TEXT}`, `візьми ${TEXT}`, `${TEXT} вибери`],
      quiet: true,
      available: () => true,
      run: async (context, { text, target, direct }) => {
        const object = await islandBuilding({ context, text, target, direct })
        if (!object || 'fail' in object) {
          return object ?? null
        }
        return `Вибрано «${object.title}». Скажіть, куди посунути: вгору, вниз, ліворуч чи праворуч.`
      },
    },
    {
      id: 'island_move',
      describe: "Move a building on the visitor's own island, as seen on the screen; opens the book on the island page if needed. value = up, down, left or right; amount = cells (0 means 2, \"a little\" means 1); target = slug, or empty for the selected one when the island page is open.",
      values: () => Object.keys(DIRECTIONS),
      phrases: directionPhrases(),
      quiet: true,
      repeatable: true,
      available: () => true,
      run: async (context, { value, amount, text, target, direct }) => {
        const object = await islandBuilding({ context, text, target, direct })
        if (object === null || (object && 'fail' in object)) {
          return object
        }
        const scene = deps.scene()
        if (!scene?.islandSelected) {
          return fail('Спершу виберіть будинок: скажіть «вибери …».')
        }
        const [name, size] = (value ?? '').split(':')
        const direction = name as 'up' | 'down' | 'left' | 'right'
        if (!DIRECTIONS[direction]) {
          return fail('Не зрозумів напрямок.')
        }
        const cells = Math.min(Math.max(amount || (size === 'small' ? 1 : ISLAND_STEP), 1), 20)
        const { moved, problem } = scene.moveIslandBuilding(direction, cells)
        const title = building(null, scene.islandSelected)?.title ?? 'Будинок'
        if (!moved) {
          return fail(`Не можу посунути «${title}» ${DIRECTION_TITLES[direction]}: ${PROBLEMS[problem ?? 'none'] ?? 'місця немає'}.`)
        }
        return moved < cells
          ? `Посунув «${title}» ${DIRECTION_TITLES[direction]} лише на ${moved}: далі ${PROBLEMS[problem ?? 'none'] ?? 'місця немає'}.`
          : `«${title}» ${DIRECTION_TITLES[direction]}.`
      },
    },
    {
      id: 'island_rotate',
      describe: "Rotate a building on the visitor's own island by 90 degrees; opens the book on the island page if needed. value = left or right (default right); target = slug, or empty for the selected one when the island page is open.",
      values: () => ['left', 'right'],
      phrases: [
        ['поверни будинок ліворуч', 'left'],
        ['поверни ліворуч', 'left'],
        ['поверни проти годинникової', 'left'],
        ['поверни будинок праворуч', 'right'],
        ['поверни праворуч', 'right'],
        ['поверни за годинниковою', 'right'],
        'поверни',
        'поверни будинок',
        'крутни',
        'крутни будинок',
        'розверни будинок',
        ...['ліворуч', 'наліво', 'вліво', 'проти годинникової'].flatMap((word): Phrase[] => [[`поверни ${TEXT} ${word}`, 'left'], [`розверни ${TEXT} ${word}`, 'left']]),
        ...['праворуч', 'направо', 'вправо', 'за годинниковою'].flatMap((word): Phrase[] => [[`поверни ${TEXT} ${word}`, 'right'], [`розверни ${TEXT} ${word}`, 'right']]),
        `поверни ${TEXT}`,
        `розверни ${TEXT}`,
      ],
      quiet: true,
      repeatable: true,
      available: () => true,
      run: async (context, { value, text, target, direct }) => {
        const object = await islandBuilding({ context, text, target, direct })
        if (object === null || (object && 'fail' in object)) {
          return object
        }
        const scene = deps.scene()
        if (!scene?.islandSelected) {
          return fail('Спершу виберіть будинок: скажіть «вибери …».')
        }
        const title = building(null, scene.islandSelected)?.title ?? 'Будинок'
        return scene.rotateIsland(value === 'left' ? -1 : 1) ? `Повернув «${title}».` : fail(`«${title}» нікуди повернути: заважають сусіди або край острова.`)
      },
    },
    {
      id: 'reset_page',
      describe: 'Reset the book page that is open (island layout or character) to defaults. Asks for confirmation.',
      phrases: ['скинь', 'скинути', 'скинь все', 'скинь розкладку', 'скинути розкладку', 'скинь острів', 'скинь персонажа', 'почни заново', 'як було'],
      available: (context) => (context.screen === 'book' && (context.bookPage === 'island' || context.bookPage === 'avatar') ? true : false),
      run: (context) =>
        context.bookPage === 'avatar'
          ? ask('Скинути персонажа до початкового вигляду?', async () => {
              await deps.resetCharacter()
              return 'Персонажа скинуто.'
            })
          : ask('Повернути всі будинки на початкові місця?', async () => {
              await deps.resetIsland()
              return 'Розкладку острова скинуто.'
            }),
    },
    {
      id: 'avatar_set',
      describe: `Change the character's look; works anywhere for a signed in member. value = one or more part=option joined with ";", e.g. "jacket=red;hat=cap". Parts and options: ${avatarCatalog()}.`,
      parse: (phrase, context) => {
        const found = parseAvatarPhrases(phrase, deps.avatar(), context.screen === 'book' && context.bookPage === 'avatar')
        return found.length ? { value: found.map((item) => `${item.key}=${item.value}`).join(';') } : null
      },
      available: member,
      run: (_, { value }) => {
        const changes = value ? resolveAvatarValues(value) : []
        if (!changes.length) {
          return fail('Не зрозумів, що змінити в персонажі.')
        }
        deps.setAvatar(changes.reduce((avatar, change) => ({ ...avatar, [change.key]: change.value }), deps.avatar()))
        return `Готово: ${changes.map((change) => describeAvatarOption(change.key, change.value)).join(', ')}.`
      },
    },
    {
      id: 'avatar_random',
      describe: 'Give the character a random look.',
      phrases: ['випадковий персонаж', 'випадкового персонажа', 'випадковий вигляд', 'випадковий', 'випадково', 'зроби випадково', 'здивуй мене', 'згенеруй персонажа', 'зміни все випадково', 'random'],
      available: member,
      run: () => {
        deps.setAvatar(randomAvatar())
        return 'Новий випадковий вигляд.'
      },
    },
    {
      id: 'more',
      describe: 'Do a little more of the last small action (a step, a slight turn, a zoom or a scroll); a short step forward if there was none.',
      phrases: ['ще трохи', 'ще трошки', 'ще трішки', 'ще чуть чуть'],
      quiet: true,
      available: () => true,
      run: async (context) => {
        const last = deps.lastAction()
        const result = last && SMALL_ACTIONS.has(last) ? await deps.again(context) : await deps.runById('step_forward', context)
        if (!result) {
          return fail('Немає що повторювати.')
        }
        return result.ok ? result.text : fail(result.text)
      },
    },
    {
      id: 'stop',
      describe: 'Stop any walking, turning or camera flight.',
      phrases: ['стоп', 'стій', 'стояти', 'зупинись', 'зупинися', 'зупинитись', 'зупини', 'зупиняйся', 'зупинка', 'досить', 'годі', 'хватить', 'хватит', 'стій на місці', 'не йди', 'stop'],
      hint: '«стоп»',
      quiet: true,
      transition: true,
      available: (context) => context.screen === 'world' || context.screen === 'entering' || deps.animating() || 'Зараз немає руху, який можна зупинити.',
      run: () => {
        deps.cancel()
        if (deps.animating()) {
          deps.hurry()
        }
        deps.scene()?.stop()
        return 'Зупинився.'
      },
    },
    {
      id: 'overview',
      describe: 'Show the whole island from above (closes the book or the page first).',
      phrases: ['покажи все', 'покажи весь світ', 'покажи увесь світ', 'покажи весь острів', 'огляд', 'загальний вигляд', 'вид згори', 'вигляд згори', 'згори', 'вид згори на острів', 'весь острів', 'покажи острів згори', 'overview'],
      hint: '«покажи все»',
      available: () => true,
      run: async () => {
        await deps.leaveScreens()
        deps.overview()
        return 'Ось увесь острів.'
      },
    },
    {
      id: 'voice_off',
      describe: 'Turn the microphone (voice control) off.',
      phrases: ['вимкни мікрофон', 'вимкнути мікрофон', 'вимкни голос', 'вимкни голосове керування', 'вимкнути голосове керування', 'досить слухати'],
      available: () => true,
      run: () => {
        deps.stopVoice()
        return 'Вимикаю мікрофон.'
      },
    },
    {
      id: 'repeat_reply',
      describe: 'Say the previous reply again.',
      phrases: ['повтори', 'повтори відповідь', 'повтори ще раз', 'що ти сказав', 'що ти сказала', 'не почув', 'не почула', 'не розчув', 'не розчула', 'скажи ще раз', 'ще раз скажи', 'repeat'],
      transition: true,
      available: () => true,
      run: () => deps.lastReply() ?? fail('Я ще нічого не казав.'),
    },
    {
      id: 'again',
      describe: 'Repeat the last action once more (a step, turn, scroll or building move).',
      phrases: ['ще раз', 'ще', 'ще разок', 'знову', 'зроби ще раз', 'повтори дію', 'again'],
      quiet: true,
      available: () => true,
      run: async (context) => {
        const result = await deps.again(context)
        if (!result) {
          return fail('Немає що повторювати.')
        }
        return result.ok ? result.text : fail(result.text)
      },
    },
    {
      id: 'help',
      describe: 'Tell what the visitor can say right now.',
      phrases: ['що ти вмієш', 'що вмієш', 'допомога', 'допоможи', 'команди', 'які є команди', 'що можна сказати', 'що робити', 'help'],
      transition: true,
      available: () => true,
      run: (context) => {
        const hints = deps.hints(context)
        const list = hints.length ? `Тут можна сказати: ${hints.join(', ')}. ` : ''
        return `${list}Або просто скажіть, що хочете зробити.`
      },
    },
  ]
}
