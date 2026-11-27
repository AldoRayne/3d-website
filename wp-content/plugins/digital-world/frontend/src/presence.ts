import { request } from '@/api'
import type { Layout } from '@/types'
import type { AvatarPatch } from '@/world/avatar'

export type PeerState = [x: number, z: number, heading: number, speed: number, inside: string]

export interface Peer {
  id: string
  uid: number
  name: string
  avatar: AvatarPatch | null
  s: PeerState | null
}

export interface PresenceHandlers {
  onReset: (peers: Peer[]) => void
  onJoin: (peer: Peer) => void
  onLeave: (id: string) => void
  onState: (id: string, state: PeerState) => void
  onAvatar: (id: string, avatar: AvatarPatch) => void
  onLayout: (layout: Layout) => void
}

type ServerMessage =
  | { t: 'welcome'; id: string; peers: Peer[] }
  | { t: 'join'; peer: Peer }
  | { t: 'leave'; id: string }
  | { t: 'state'; id: string; s: PeerState }
  | { t: 'avatar'; id: string; avatar: AvatarPatch }
  | { t: 'layout'; layout: Layout }

const RETRY_MIN = 1000
const RETRY_MAX = 30000

export class Presence {
  private socket: WebSocket | null = null
  private room = ''
  private invite = ''
  private retry = RETRY_MIN
  private retryTimer = 0
  private generation = 0
  private avatar: AvatarPatch = {}
  private lastState: PeerState | null = null

  constructor(private handlers: PresenceHandlers) {}

  join(room: string, invite = '') {
    if (room === this.room && invite === this.invite) {
      return
    }
    this.room = room
    this.invite = invite
    this.retry = RETRY_MIN
    this.reconnect()
  }

  setAvatar(avatar: AvatarPatch) {
    this.avatar = avatar
    this.send({ t: 'avatar', avatar })
  }

  sendState(state: PeerState) {
    this.lastState = state
    this.send({ t: 'state', s: state })
  }

  sendLayout(layout: Layout) {
    this.send({ t: 'layout', layout })
  }

  dispose() {
    this.room = ''
    this.close()
  }

  private send(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }

  private close() {
    this.generation++
    window.clearTimeout(this.retryTimer)
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onclose = null
      socket.close()
    }
    this.handlers.onReset([])
  }

  private reconnect() {
    this.close()
    if (this.room) {
      void this.connect(this.generation)
    }
  }

  private scheduleRetry(generation: number) {
    if (generation !== this.generation || !this.room) {
      return
    }
    window.clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => void this.connect(generation), this.retry)
    this.retry = Math.min(this.retry * 2, RETRY_MAX)
  }

  private async connect(generation: number) {
    let ticket: { url: string; token: string }
    try {
      ticket = await request('/realtime/token', {
        method: 'POST',
        body: JSON.stringify({ room: this.room, invite: this.invite }),
      })
    } catch {
      this.scheduleRetry(generation)
      return
    }
    if (generation !== this.generation) {
      return
    }
    const socket = new WebSocket(`${ticket.url}?token=${encodeURIComponent(ticket.token)}`)
    this.socket = socket
    socket.onopen = () => {
      this.retry = RETRY_MIN
      socket.send(JSON.stringify({ t: 'avatar', avatar: this.avatar }))
      if (this.lastState) {
        socket.send(JSON.stringify({ t: 'state', s: this.lastState }))
      }
    }
    socket.onmessage = (event) => this.receive(event.data)
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null
        this.handlers.onReset([])
        this.scheduleRetry(generation)
      }
    }
  }

  private receive(data: unknown) {
    let message: ServerMessage
    try {
      message = JSON.parse(String(data))
    } catch {
      return
    }
    switch (message.t) {
      case 'welcome':
        this.handlers.onReset(message.peers)
        break
      case 'join':
        this.handlers.onJoin(message.peer)
        break
      case 'leave':
        this.handlers.onLeave(message.id)
        break
      case 'state':
        this.handlers.onState(message.id, message.s)
        break
      case 'avatar':
        this.handlers.onAvatar(message.id, message.avatar)
        break
      case 'layout':
        this.handlers.onLayout(message.layout)
        break
    }
  }
}
