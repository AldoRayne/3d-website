import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { Player } from './Player'
import { resolveAvatar, type AvatarPatch } from './avatar'
import type { Building } from './WorldModel'

export interface RemoteState {
  x: number
  z: number
  heading: number
  speed: number
  inside: string
}

interface Remote {
  player: Player
  label: HTMLDivElement
  where: HTMLSpanElement
  state: RemoteState | null
  shown: boolean
  slot: number
  inside: string
}

const LABEL_HEIGHT = 2.45
const SNAP_DISTANCE = 6
const FOLLOW_RATE = 12
const TURN_RATE = 10
const DOOR_STEP_OUT = 0.9
const DOOR_SPREAD = 0.6

function slotOf(id: string) {
  let hash = 0
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0
  }
  return (Math.abs(hash) % 5) - 2
}

export class RemotePlayers {
  readonly root = new THREE.Group()
  private peers = new Map<string, Remote>()
  private target = new THREE.Vector3()

  constructor(private buildingOf: (slug: string) => Building | undefined) {}

  upsert(id: string, name: string, avatar: AvatarPatch | null) {
    let peer = this.peers.get(id)
    if (!peer) {
      const player = new Player(resolveAvatar(avatar), { shadow: true })
      const label = document.createElement('div')
      label.className = 'dw-peer'
      const title = document.createElement('span')
      title.className = 'dw-peer__name'
      const where = document.createElement('span')
      where.className = 'dw-peer__where'
      label.append(title, where)
      const tag = new CSS2DObject(label)
      tag.position.y = LABEL_HEIGHT
      player.root.add(tag)
      player.root.visible = false
      this.root.add(player.root)
      peer = { player, label, where, state: null, shown: false, slot: slotOf(id), inside: '' }
      this.peers.set(id, peer)
    } else if (avatar) {
      peer.player.setAvatar(resolveAvatar(avatar))
    }
    ;(peer.label.firstChild as HTMLSpanElement).textContent = name
  }

  setAvatar(id: string, avatar: AvatarPatch) {
    this.peers.get(id)?.player.setAvatar(resolveAvatar(avatar))
  }

  setState(id: string, state: RemoteState) {
    const peer = this.peers.get(id)
    if (peer) {
      peer.state = state
    }
  }

  remove(id: string) {
    const peer = this.peers.get(id)
    if (!peer) {
      return
    }
    peer.label.remove()
    peer.player.dispose()
    this.peers.delete(id)
  }

  clear() {
    for (const id of [...this.peers.keys()]) {
      this.remove(id)
    }
  }

  get size() {
    return this.peers.size
  }

  private pose(peer: Remote, state: RemoteState) {
    const building = state.inside ? this.buildingOf(state.inside) : undefined
    if (!building) {
      this.target.set(state.x, 0, state.z)
      return { heading: state.heading, speed: state.speed, title: '' }
    }
    const { front, outward } = building.door
    this.target
      .copy(front)
      .addScaledVector(outward, DOOR_STEP_OUT)
      .add(new THREE.Vector3(-outward.z, 0, outward.x).multiplyScalar(peer.slot * DOOR_SPREAD))
    this.target.y = 0
    return { heading: Math.atan2(-outward.x, -outward.z), speed: 0, title: building.object.title }
  }

  update(dt: number, elapsed: number, still: boolean) {
    for (const peer of this.peers.values()) {
      const state = peer.state
      if (!state) {
        continue
      }
      const { heading, speed, title } = this.pose(peer, state)
      const { player } = peer
      if (!peer.shown || player.position.distanceTo(this.target) > SNAP_DISTANCE) {
        player.position.copy(this.target)
        player.heading = heading
        peer.shown = true
        player.root.visible = true
      } else {
        player.position.lerp(this.target, 1 - Math.exp(-dt * FOLLOW_RATE))
        const delta = Math.atan2(Math.sin(heading - player.heading), Math.cos(heading - player.heading))
        player.heading += delta * (1 - Math.exp(-dt * TURN_RATE))
      }
      player.animate(dt, speed, elapsed, still)
      if (title !== peer.inside) {
        peer.inside = title
        peer.where.textContent = title ? `у «${title}»` : ''
        peer.label.classList.toggle('is-inside', Boolean(title))
      }
    }
  }
}
