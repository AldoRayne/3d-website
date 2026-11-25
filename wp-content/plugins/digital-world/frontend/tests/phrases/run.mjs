import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'rolldown'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '../..')
const out = mkdtempSync(join(tmpdir(), 'dw-phrases-'))
const file = join(out, 'harness.mjs')

try {
  await build({
    input: join(here, 'harness.ts'),
    platform: 'node',
    cwd: root,
    logLevel: 'silent',
    resolve: { alias: { '@/world/WorldScene': join(here, 'scene.ts'), '@': join(root, 'src') } },
    output: { file, format: 'esm' },
  })
  await import(pathToFileURL(file).href)
} finally {
  rmSync(out, { recursive: true, force: true })
}
