import type { CommandArgs } from '@/commands'
import { CASES, type PhraseCase, type State } from './cases'
import { executed, island, set, STATES } from './fixture'

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
  if (item.reply !== undefined && got.text !== item.reply) {
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
