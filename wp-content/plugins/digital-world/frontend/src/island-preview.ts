import type { Layout, WorldObject } from '@/types'
import { applyLayout } from '@/world/layout'
import { WorldEditor } from '@/editor/WorldEditor'
import { AvatarPortrait } from '@/world/portrait'
import { resolveAvatar, type AvatarPatch } from '@/world/avatar'
import './editor/editor.css'

interface IslandPreviewBoot {
  objects: WorldObject[]
  radius: number
  layout: Layout | []
  avatar?: AvatarPatch | []
}

declare global {
  interface Window {
    DigitalWorldIsland?: IslandPreviewBoot
  }
}

const boot = window.DigitalWorldIsland
const stage = document.getElementById('digital-world-island')
if (boot && stage) {
  const layout = Array.isArray(boot.layout) ? {} : boot.layout
  const editor = new WorldEditor(stage, { onSelect: () => {}, onCommit: () => {}, onDragProblem: () => {} }, { readOnly: true })
  editor.setWorld(applyLayout(boot.objects, layout, boot.radius), boot.radius)
  const avatar = resolveAvatar(boot.avatar)
  editor.showPlayer(avatar)
  const portrait = document.getElementById('digital-world-avatar')
  if (portrait) {
    new AvatarPortrait(portrait, avatar)
  }
}
