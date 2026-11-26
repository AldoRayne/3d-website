import { createApp } from 'vue'
import type { Layout, WorldObject } from '@/types'
import type { WorldEditor } from '@/editor/WorldEditor'
import { resolveAvatar, type Avatar, type AvatarPatch } from '@/world/avatar'
import MemberIslandPanel from '@/admin/MemberIslandPanel.vue'
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

function setupTabs() {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.dw-island-tab')]
  const activate = (tab: HTMLButtonElement) => {
    for (const item of tabs) {
      const active = item === tab
      item.classList.toggle('is-active', active)
      item.setAttribute('aria-selected', String(active))
      item.tabIndex = active ? 0 : -1
      const pane = document.getElementById(item.getAttribute('aria-controls') ?? '')
      if (pane) {
        pane.hidden = !active
      }
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab))
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (step) {
        event.preventDefault()
        const next = tabs[(index + step + tabs.length) % tabs.length]
        activate(next)
        next.focus()
      }
    })
  })
}

setupTabs()

const boot = window.DigitalWorldIsland
const stage = document.getElementById('digital-world-island')
const islandPanel = document.getElementById('digital-world-island-panel')
if (boot && stage && islandPanel) {
  const avatar = resolveAvatar(boot.avatar)
  const api = { restUrl: boot.restUrl, nonce: boot.nonce, userId: boot.userId, canEdit: boot.canEdit }
  let editor: WorldEditor | null = null
  createApp(MemberIslandPanel, {
    ...api,
    stage,
    objects: boot.objects,
    radius: boot.radius,
    initial: Array.isArray(boot.layout) ? {} : boot.layout,
    avatar,
    onReady: (instance: WorldEditor) => (editor = instance),
  }).mount(islandPanel)
  const avatarPanel = document.getElementById('digital-world-avatar-panel')
  if (avatarPanel) {
    createApp(MemberAvatarPanel, {
      ...api,
      initial: avatar,
      onPreview: (next: Avatar) => editor?.showPlayer(next),
    }).mount(avatarPanel)
  }
}
