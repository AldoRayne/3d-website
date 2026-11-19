import { Arranger } from './page/arranger'
import { installHands } from './page/hands'
import { Layout, NARROW } from './page/layout'
import './page.css'

const HINT_KEY = 'dw-arrange-hint'

function remember(action: () => void) {
  try {
    action()
  } catch {
    return
  }
}

function showHint() {
  let seen = false
  remember(() => (seen = window.localStorage.getItem(HINT_KEY) === '1'))
  if (seen) {
    return
  }
  remember(() => window.localStorage.setItem(HINT_KEY, '1'))
  const touch = window.matchMedia('(pointer: coarse)').matches
  const hint = document.createElement('div')
  hint.className = 'dw-arrange-hint'
  hint.setAttribute('role', 'status')
  hint.textContent = touch
    ? 'Затисніть будь-який елемент сторінки, щоб підняти його й покласти на вільне місце.'
    : 'Затисніть будь-який елемент сторінки мишею, щоб підняти його й покласти на вільне місце. Alt + стрілки — посунути з клавіатури.'
  document.body.appendChild(hint)
  window.setTimeout(() => hint.classList.add('is-hidden'), 6500)
  window.setTimeout(() => hint.remove(), 7200)
}

function start() {
  const html = document.documentElement
  const layout = new Layout()
  layout.restore()
  layout.apply()
  html.classList.remove('dw-layout-pending')

  if (window.self !== window.top) {
    return
  }

  installHands(html)
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'dw-arrange-reset'
  reset.textContent = '↺ Повернути як було'
  const sync = () => reset.classList.toggle('is-visible', layout.changed())
  const arranger = new Arranger(layout, () => {
    layout.save()
    sync()
  })
  reset.addEventListener('click', () => {
    arranger.reset()
    sync()
  })
  document.body.appendChild(reset)

  let timer = 0
  const refresh = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (arranger.busy) {
        refresh()
        return
      }
      layout.apply()
      sync()
    }, 150)
  }
  window.addEventListener('resize', refresh)
  window.matchMedia(NARROW).addEventListener('change', refresh)
  void document.fonts?.ready.then(refresh)

  sync()
  if (layout.active()) {
    showHint()
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true })
} else {
  start()
}
