import { createServer } from 'node:http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.DW_REALTIME_PORT || 8787)
const HOST = process.env.DW_REALTIME_HOST || '127.0.0.1'
const SECRET = process.env.DW_REALTIME_SECRET || ''
const ORIGINS = (process.env.DW_REALTIME_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const ROOM_LIMIT = 30
const MAX_MESSAGE = 4096
const RATE_PER_SECOND = 30
const PING_EVERY = 15_000
const COORD_LIMIT = 200
const SPEED_LIMIT = 20
const ROOM_PATTERN = /^(public|island:[1-9]\d{0,9})$/
const SLUG_PATTERN = /^[a-z0-9_@-]{0,64}$/
const AVATAR_KEYS = 12
const AVATAR_VALUE = 32

if (SECRET.length < 32) {
  console.error('DW_REALTIME_SECRET must be at least 32 characters.')
  process.exit(1)
}

const rooms = new Map()

function sign(payload) {
  return createHmac('sha256', SECRET).update(payload).digest('base64url')
}

function verify(token) {
  const [payload, signature] = String(token || '').split('.')
  if (!payload || !signature) {
    return null
  }
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null
  }
  let data
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || !ROOM_PATTERN.test(data.room) || !Number.isInteger(data.uid) || data.uid < 0) {
    return null
  }
  if (!Number.isFinite(data.exp) || data.exp * 1000 < Date.now()) {
    return null
  }
  return { room: data.room, uid: data.uid, name: typeof data.name === 'string' ? data.name.slice(0, 60) : '' }
}

function roomOwner(room) {
  return room.startsWith('island:') ? Number(room.slice(7)) : 0
}

function guestName(room) {
  const taken = new Set([...room.values()].map((peer) => peer.guestNumber).filter(Boolean))
  let number = 1
  while (taken.has(number)) {
    number++
  }
  return number
}

function cleanState(value) {
  if (!Array.isArray(value) || value.length !== 5) {
    return null
  }
  const [x, z, heading, speed, inside] = value
  if (![x, z, heading, speed].every(Number.isFinite) || typeof inside !== 'string') {
    return null
  }
  if (Math.abs(x) > COORD_LIMIT || Math.abs(z) > COORD_LIMIT || !SLUG_PATTERN.test(inside)) {
    return null
  }
  const round = (n) => Math.round(n * 100) / 100
  return [round(x), round(z), round(heading), round(Math.min(Math.abs(speed), SPEED_LIMIT)), inside]
}

function cleanAvatar(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const entries = Object.entries(value)
  if (entries.length > AVATAR_KEYS) {
    return null
  }
  const clean = {}
  for (const [key, item] of entries) {
    if (typeof item !== 'string' || key.length > 16 || item.length > AVATAR_VALUE) {
      return null
    }
    clean[key] = item
  }
  return clean
}

function cleanLayout(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return JSON.stringify(value).length <= MAX_MESSAGE - 64 ? value : null
}

function publicPeer(peer) {
  return { id: peer.id, uid: peer.uid, name: peer.name, avatar: peer.avatar, s: peer.state }
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

function broadcast(room, message, except) {
  const data = JSON.stringify(message)
  for (const peer of room.values()) {
    if (peer !== except && peer.socket.readyState === peer.socket.OPEN) {
      peer.socket.send(data)
    }
  }
}

function allowedOrigin(origin) {
  return !ORIGINS.length || ORIGINS.includes(origin)
}

const server = createServer((request, response) => {
  if (request.url === '/health') {
    const peers = [...rooms.values()].reduce((sum, room) => sum + room.size, 0)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: true, rooms: rooms.size, peers }))
    return
  }
  response.writeHead(404)
  response.end()
})

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE })

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '/', 'http://localhost')
  const ticket = verify(url.searchParams.get('token'))
  if (!ticket || !allowedOrigin(request.headers.origin || '')) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const room = rooms.get(ticket.room)
  if (room && room.size >= ROOM_LIMIT) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(request, socket, head, (ws) => join(ws, ticket))
})

function join(socket, ticket) {
  if (!rooms.has(ticket.room)) {
    rooms.set(ticket.room, new Map())
  }
  const room = rooms.get(ticket.room)
  const peer = {
    id: randomUUID().slice(0, 8),
    uid: ticket.uid,
    name: ticket.name,
    guestNumber: 0,
    avatar: null,
    state: null,
    socket,
    alive: true,
    budget: RATE_PER_SECOND,
    refill: Date.now(),
  }
  if (!peer.name) {
    peer.guestNumber = guestName(room)
    peer.name = `Гість ${peer.guestNumber}`
  }
  send(socket, { t: 'welcome', id: peer.id, peers: [...room.values()].map(publicPeer) })
  room.set(peer.id, peer)
  broadcast(room, { t: 'join', peer: publicPeer(peer) }, peer)

  socket.on('pong', () => (peer.alive = true))
  socket.on('message', (raw) => receive(room, ticket.room, peer, raw))
  socket.on('close', () => {
    room.delete(peer.id)
    broadcast(room, { t: 'leave', id: peer.id })
    if (!room.size) {
      rooms.delete(ticket.room)
    }
  })
}

function receive(room, roomId, peer, raw) {
  const now = Date.now()
  peer.budget = Math.min(RATE_PER_SECOND, peer.budget + ((now - peer.refill) / 1000) * RATE_PER_SECOND)
  peer.refill = now
  if (peer.budget < 1) {
    return
  }
  peer.budget--
  let message
  try {
    message = JSON.parse(String(raw))
  } catch {
    return
  }
  if (!message || typeof message !== 'object') {
    return
  }
  if (message.t === 'state') {
    const state = cleanState(message.s)
    if (state) {
      peer.state = state
      broadcast(room, { t: 'state', id: peer.id, s: state }, peer)
    }
  } else if (message.t === 'avatar') {
    const avatar = cleanAvatar(message.avatar)
    if (avatar) {
      peer.avatar = avatar
      broadcast(room, { t: 'avatar', id: peer.id, avatar }, peer)
    }
  } else if (message.t === 'layout' && peer.uid && peer.uid === roomOwner(roomId)) {
    const layout = cleanLayout(message.layout)
    if (layout) {
      broadcast(room, { t: 'layout', layout }, peer)
    }
  }
}

const heartbeat = setInterval(() => {
  for (const room of rooms.values()) {
    for (const peer of room.values()) {
      if (!peer.alive) {
        peer.socket.terminate()
        continue
      }
      peer.alive = false
      peer.socket.ping()
    }
  }
}, PING_EVERY)

function shutdown() {
  clearInterval(heartbeat)
  for (const client of wss.clients) {
    client.close(1001, 'Server restart')
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.listen(PORT, HOST, () => {
  console.log(`Digital World realtime on ${HOST}:${PORT}`)
})
