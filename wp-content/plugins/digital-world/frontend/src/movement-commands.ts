import { fail, NUMBER, type Availability, type Failure, type LocalCommand, type Phrase } from '@/commands'
import { MAX_DISTANCE, MIN_DISTANCE, type WorldScene } from '@/world/WorldScene'
import type { NavigatorContext } from '@/types'

const STEP = 1.5
const SHORT_STEP = 2
const MAX_STEPS = 40
const ZOOM_STEP = 3
const QUARTER = Math.PI / 2
const NUDGE = Math.PI / 6
const LOOK: Record<string, [yaw: number, pitch: number, reply: string]> = {
  left: [QUARTER, 0, 'Дивлюся ліворуч.'],
  right: [-QUARTER, 0, 'Дивлюся праворуч.'],
  back: [Math.PI, 0, 'Дивлюся назад.'],
  up: [0, -0.3, 'Дивлюся вгору.'],
  down: [0, 0.85, 'Дивлюся вниз.'],
  ahead: [0, 0, 'Дивлюся вперед.'],
}

const TURN_VERBS = ['', 'поверни ', 'повернись ', 'повернися ', 'розвернись ', 'розвернися ']
const LEFT_WORDS = ['ліворуч', 'наліво', 'вліво']
const RIGHT_WORDS = ['праворуч', 'направо', 'вправо']
const LOOK_VERBS = ['подивись', 'подивися', 'глянь', 'дивись', 'поглянь']
const LOOK_WORDS: Record<string, string[]> = {
  left: ['ліворуч', 'наліво', 'вліво'],
  right: ['праворуч', 'направо', 'вправо'],
  back: ['назад', 'позаду'],
  up: ['вгору', 'угору', 'вверх', 'наверх', 'нагору', 'на небо'],
  down: ['вниз', 'донизу', 'під ноги', 'додолу'],
  ahead: ['вперед', 'прямо'],
}

function turnPhrases(words: string[]): string[] {
  return TURN_VERBS.flatMap((verb) =>
    words.flatMap((word) => [`${verb}${word} на ${NUMBER}`, `${verb}${word} ${NUMBER}`, `${verb}на ${NUMBER} ${word}`, `${verb}${NUMBER} ${word}`]),
  )
}

function lookPhrases(): Phrase[] {
  return Object.entries(LOOK_WORDS).flatMap(([value, words]) => LOOK_VERBS.flatMap((verb) => words.map((word): Phrase => [`${verb} ${word}`, value])))
}

function inWorld(context: NavigatorContext): Availability {
  if (context.screen === 'book') {
    return 'Спершу закрийте книгу: скажіть «закрий книгу».'
  }
  if (context.screen === 'reading') {
    return 'Спершу вийдіть з будинку: скажіть «вийди».'
  }
  return true
}

function steps(amount: number | null) {
  return Math.min(amount ?? 1, MAX_STEPS) * STEP
}

function degrees(amount: number | null, fallback: number) {
  return amount ? (Math.min(amount, 360) * Math.PI) / 180 : fallback
}

export function movementCommands(scene: () => WorldScene | null, overview: () => void, reducedMotion: boolean): LocalCommand[] {
  const moving = (direction: 1 | -1, distance: number | null, reply: string): string | Failure =>
    scene()?.step(direction, distance) ? reply : fail('Зараз не можу рухатися.')
  const turning = (angle: number, reply: string): string | Failure => (scene()?.turnBy(angle) ? reply : fail('Зараз не можу повернути.'))
  const zooming = (distance: number | null | undefined, edge: number, edgeReply: string, reply: string): string | Failure => {
    if (distance === null || distance === undefined) {
      return fail('Зараз не можу змінити відстань камери.')
    }
    return distance === edge ? edgeReply : reply
  }
  const command = (definition: Omit<LocalCommand, 'available' | 'quiet'> & { quiet?: boolean }): LocalCommand => ({
    quiet: true,
    repeatable: true,
    available: inWorld,
    ...definition,
  })

  return [
    command({
      id: 'walk_forward',
      describe: 'Walk forward. amount = number of steps; 0 keeps walking until the visitor says stop or hits an obstacle.',
      phrases: [
        `вперед на ${NUMBER}`,
        `${NUMBER} вперед`,
        `на ${NUMBER} вперед`,
        `йди вперед на ${NUMBER}`,
        `іди вперед на ${NUMBER}`,
        `пройди ${NUMBER}`,
        `пройди вперед на ${NUMBER}`,
        `вперед ${NUMBER}`,
        `йди вперед ${NUMBER}`,
        `іди вперед ${NUMBER}`,
        `пройди вперед ${NUMBER}`,
        `пройди ${NUMBER} вперед`,
        `йди ${NUMBER}`,
        `іди ${NUMBER}`,
        `йди на ${NUMBER}`,
        `іди на ${NUMBER}`,
        `зроби ${NUMBER}`,
        `зроби ${NUMBER} вперед`,
        'вперед',
        'йди вперед',
        'іди вперед',
        'рухайся вперед',
        'йди прямо',
        'іди прямо',
        'прямо',
        'йди далі',
        'іди далі',
        'йди',
        'іди',
        'рушай',
        'поїхали',
        'пройди вперед',
        'пройдись',
        'пройдися',
        'пройдись вперед',
        'біжи',
        'біжи вперед',
        'бігом',
        'forward',
        'go',
      ],
      hint: '«вперед»',
      run: (_, { amount }) =>
        amount ? moving(1, steps(amount), 'Іду вперед.') : moving(1, null, 'Іду вперед. Скажіть «стоп», щоб зупинитися.'),
    }),
    command({
      id: 'step_forward',
      describe: 'Take one short step forward.',
      phrases: ['крок вперед', 'крок', 'ще 1', 'зроби 1', 'трохи вперед', 'ще трохи вперед', 'ще крок', 'пройди трохи вперед', 'пройди трохи', 'трішки вперед', 'трошки вперед', 'зроби крок', 'зроби крок вперед'],
      run: () => moving(1, SHORT_STEP, 'Крок вперед.'),
    }),
    command({
      id: 'walk_back',
      describe: 'Walk backward. amount = number of steps; 0 keeps walking back until stop.',
      phrases: [
        `назад на ${NUMBER}`,
        `назад ${NUMBER}`,
        `${NUMBER} назад`,
        `на ${NUMBER} назад`,
        `йди назад ${NUMBER}`,
        `іди назад ${NUMBER}`,
        `йди назад на ${NUMBER}`,
        `іди назад на ${NUMBER}`,
        `відійди ${NUMBER}`,
        `відійди на ${NUMBER}`,
        `відійди назад ${NUMBER}`,
        `відійди назад на ${NUMBER}`,
        `зроби ${NUMBER} назад`, 'йди назад', 'іди назад', 'рухайся назад', 'задній хід'],
      run: (_, { amount }) =>
        amount ? moving(-1, steps(amount), 'Відходжу назад.') : moving(-1, null, 'Іду назад. Скажіть «стоп», щоб зупинитися.'),
    }),
    command({
      id: 'step_back',
      describe: 'Take one short step backward.',
      phrases: ['назад', 'крок назад', 'трохи назад', 'відійди', 'відійди назад', 'відступи', 'відступи назад', 'відійди трохи', 'трохи відійди', 'ще трохи назад', 'back'],
      run: () => moving(-1, SHORT_STEP, 'Крок назад.'),
    }),
    command({
      id: 'turn_left',
      describe: 'Turn the character left. amount = degrees, 0 means 90.',
      phrases: [
        ...turnPhrases(LEFT_WORDS),
        'ліворуч',
        'наліво',
        'вліво',
        'поверни ліворуч',
        'повернись ліворуч',
        'поверни наліво',
        'повернись наліво',
        'поверни вліво',
        'left',
        'turn left',
      ],
      hint: '«ліворуч»',
      run: (_, { amount }) => turning(degrees(amount, QUARTER), 'Повертаю ліворуч.'),
    }),
    command({
      id: 'nudge_left',
      describe: 'Turn slightly left (30 degrees).',
      phrases: ['трохи ліворуч', 'трохи наліво', 'трохи вліво', 'лівіше', 'трохи лівіше', 'ще лівіше', 'ще трохи ліворуч', 'ще трохи наліво', 'ще трохи вліво'],
      run: () => turning(NUDGE, 'Трохи ліворуч.'),
    }),
    command({
      id: 'turn_right',
      describe: 'Turn the character right. amount = degrees, 0 means 90. Use it also when no direction is given.',
      phrases: [
        `поверни на ${NUMBER}`,
        `повернись на ${NUMBER}`,
        `повернися на ${NUMBER}`,
        `розвернись на ${NUMBER}`,
        `розвернися на ${NUMBER}`,
        ...turnPhrases(RIGHT_WORDS),
        'праворуч',
        'направо',
        'вправо',
        'поверни праворуч',
        'повернись праворуч',
        'поверни направо',
        'повернись направо',
        'поверни вправо',
        'right',
        'turn right',
      ],
      hint: '«праворуч»',
      run: (_, { amount }) => turning(-degrees(amount, QUARTER), 'Повертаю праворуч.'),
    }),
    command({
      id: 'nudge_right',
      describe: 'Turn slightly right (30 degrees).',
      phrases: ['трохи праворуч', 'трохи направо', 'трохи вправо', 'правіше', 'трохи правіше', 'ще правіше', 'ще трохи праворуч', 'ще трохи направо', 'ще трохи вправо'],
      run: () => turning(-NUDGE, 'Трохи праворуч.'),
    }),
    command({
      id: 'turn_around',
      describe: 'Turn the character around by 180 degrees.',
      phrases: ['розвернись', 'розвернися', 'кругом', 'обернись', 'обернися', 'повернись', 'повернися', 'повернись кругом', 'повернись назад', 'розвернись на місці', 'розвернися на місці', 'розвернись назад', 'розвернися назад', 'обернись назад', 'обернися назад', 'поверни назад', 'півоберта', 'на півоберта', 'turn around'],
      run: () => turning(Math.PI, 'Розвертаюся.'),
    }),
    command({
      id: 'zoom_in',
      describe: 'Move the camera closer to the character.',
      phrases: ['ближче', 'ще ближче', 'трохи ближче', 'наблизь', 'наблизь ще', 'ще наблизь', 'наблизити', 'приблизь', 'приблизити', 'наблизь камеру', 'приблизь камеру', 'камеру ближче', 'збільш', 'zoom in'],
      hint: '«ближче»',
      run: () => zooming(scene()?.zoom(-ZOOM_STEP), MIN_DISTANCE, 'Ближче вже нікуди.', 'Наближаю.'),
    }),
    command({
      id: 'zoom_out',
      describe: 'Move the camera farther from the character.',
      phrases: ['віддали', 'віддали ще', 'ще віддали', 'ще далі', 'далі камеру', 'віддалити', 'віддали камеру', 'відсунь камеру', 'камеру далі', 'зменш', 'zoom out'],
      hint: '«віддали»',
      run: () => zooming(scene()?.zoom(ZOOM_STEP), MAX_DISTANCE, 'Далі вже нікуди.', 'Віддаляю.'),
    }),
    command({
      id: 'zoom_closest',
      describe: 'Move the camera as close as possible.',
      phrases: ['максимально близько', 'найближче', 'впритул'],
      run: () => zooming(scene()?.setZoom(MIN_DISTANCE), -1, '', 'Наближаю впритул.'),
    }),
    command({
      id: 'zoom_farthest',
      describe: 'Move the camera as far as possible.',
      phrases: ['максимально далеко', 'найдалі', 'якомога далі'],
      run: () => zooming(scene()?.setZoom(MAX_DISTANCE), -1, '', 'Віддаляю до краю.'),
    }),
    command({
      id: 'look',
      describe: 'Point the camera without moving the character. value = left, right, back, up, down or ahead.',
      values: () => Object.keys(LOOK),
      phrases: [
        ...lookPhrases(),
        ['що позаду', 'back'],
      ],
      run: (_, { value }) => {
        const look = LOOK[value ?? '']
        if (!look) {
          return fail('Не зрозумів, куди дивитися.')
        }
        return scene()?.lookToward(look[0], look[1]) ? look[2] : fail('Зараз не можу повернути камеру.')
      },
    }),
    command({
      id: 'look_around',
      describe: 'Swing the camera once around the character.',
      phrases: ['озирнись', 'озирнися', 'роззирнись', 'роззирнися', 'подивись навколо', 'подивись довкола', 'роздивись', 'роздивися', 'оглянься', 'покажи навколо'],
      hint: '«озирнись»',
      quiet: false,
      run: () => {
        if (scene()?.lookAround()) {
          return 'Роздивляюся навколо.'
        }
        return fail(reducedMotion ? 'Анімацію вимкнено в системі, тож озирнутися не вийде.' : 'Зараз не можу повернути камеру.')
      },
    }),
    command({
      id: 'orbit',
      describe: 'Fly the camera once around the whole island.',
      phrases: ['облети', 'облети острів', 'облети навколо', 'облети острів навколо', 'облети світ', 'облет', 'зроби коло', 'облети по колу', 'облети все'],
      hint: '«облети острів»',
      quiet: false,
      run: () => {
        if (scene()?.orbitIsland()) {
          return 'Облітаю острів. Скажіть «стоп», щоб зупинити.'
        }
        if (reducedMotion) {
          overview()
          return 'Анімацію вимкнено в системі, тому показую острів згори.'
        }
        return fail('Зараз не можу облетіти острів.')
      },
    }),
    command({
      id: 'follow',
      describe: 'Put the camera back behind the character with the default distance.',
      phrases: ['до персонажа', 'повернись до персонажа', 'камеру до мене', 'камера до мене', 'до мене', 'за мною', 'поверни камеру', 'скинь камеру', 'звичайний вигляд', 'звичайна камера'],
      hint: '«до персонажа»',
      run: () => (scene()?.chase() ? 'Камера знову за персонажем.' : fail('Зараз не можу повернути камеру.')),
    }),
  ]
}
