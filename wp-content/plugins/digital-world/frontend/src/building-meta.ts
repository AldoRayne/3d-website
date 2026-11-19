import { describeBuilding, generateBuilding, randomSeed } from '@/world/buildings'
import { drawBuildingPreview } from '@/world/preview'
import './building-meta.css'

const DEFAULT_COLOR = '#3498db'
const COLOR_INPUT = 'input[name="acf[field_dw_color]"]'

function currentColor() {
  const inputs = [...document.querySelectorAll<HTMLInputElement>(COLOR_INPUT)]
  const picker = inputs.find((input) => input.classList.contains('wp-color-picker')) ?? inputs[0]
  const value = picker?.value ?? ''
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_COLOR
}

function mount(box: HTMLElement) {
  const canvas = box.querySelector<HTMLCanvasElement>('canvas')
  const input = box.querySelector<HTMLInputElement>('[data-dw-building-seed]')
  const description = box.querySelector<HTMLElement>('[data-dw-building-desc]')
  const button = box.querySelector<HTMLButtonElement>('[data-dw-building-generate]')
  if (!canvas || !input || !description || !button) {
    return
  }

  let color = currentColor()
  const render = () => {
    const seed = Number(input.value)
    drawBuildingPreview(canvas, generateBuilding(seed, color))
    description.textContent = describeBuilding(seed)
  }

  if (!(Number(input.value) > 0)) {
    input.value = String(randomSeed())
  }

  button.addEventListener('click', () => {
    input.value = String(randomSeed())
    render()
  })

  const refreshColor = () => {
    const next = currentColor()
    if (next !== color) {
      color = next
      render()
    }
  }
  document.addEventListener('change', refreshColor, true)
  document.addEventListener('input', refreshColor, true)
  window.setInterval(refreshColor, 800)
  new ResizeObserver(render).observe(canvas)
  render()
}

document.querySelectorAll<HTMLElement>('[data-dw-building]').forEach(mount)
