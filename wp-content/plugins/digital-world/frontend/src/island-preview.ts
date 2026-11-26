import { createApp } from 'vue'
import type { Layout, WorldObject } from '@/types'
import { applyLayout } from '@/world/layout'
import { WorldEditor } from '@/editor/WorldEditor'
import { resolveAvatar, type Avatar, type AvatarPatch } from '@/world/avatar'
import MemberAvatarPanel from '@/admin/MemberAvatarPanel.vue'
import './editor/editor.css'
import './admin/avatar-panel.css'

interface IslandPreviewBoot {
  objects: WorldObject[]
  radius: number
  layout: Layout | []
  avatar?: AvatarPatch | []
  restUrl: string
  nonce: string
  userId: number
  canEdit: boolean
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
  const panel = document.getElementById('digital-world-avatar-panel')
  if (panel) {
    createApp(MemberAvatarPanel, {
      initial: avatar,
      canEdit: boot.canEdit,
      restUrl: boot.restUrl,
      nonce: boot.nonce,
      userId: boot.userId,
      onPreview: (next: Avatar) => editor.showPlayer(next),
    }).mount(panel)
  }
}
