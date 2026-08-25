import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatId,
  emptyState,
  handle,
  hostSessionId,
  inboundId,
  list,
  platformId,
  recoverTurns,
  subjectId,
  timestamp,
} from '../lib/types/gateway/index.js'

const slack = platformId('slack')
const me = subjectId('U-owner')
const stranger = subjectId('U-stranger')
const dmChat = chatId('D-1')
let n = 0
const id = () => inboundId(`e-${++n}`)
const t = () => timestamp(++n * 1000)

function bindOwner(state) {
  return handle(state, { kind: 'bind', platform: slack, owner: me, id: id(), at: t() }).state
}

function withCatalog(state) {
  return handle(state, {
    kind: 'catalog',
    catalog: {
      catchAllPrefix: 'dsh',
      commands: [
        { name: 'goal', description: 'Goal', ownerOnly: false },
        { name: 'export', description: 'Export', ownerOnly: true },
      ],
    },
    id: id(),
    at: t(),
  }).state
}

function dm(subject) {
  return {
    actor: { platform: slack, subject },
    identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
    addressing: { kind: 'dm' },
  }
}

test('unbound DM binds that actor as owner', () => {
  n = 0
  const r = handle(withCatalog(emptyState()), {
    kind: 'message',
    ...dm(me),
    prompt: { text: 'hi', attachments: [] },
    id: id(),
    at: t(),
  })
  const access = r.state.access.byPlatform[slack]
  assert.equal(access.kind, 'bound')
  assert.equal(access.owner, me)
  assert.equal(r.hostCalls.length, 1)
  assert.equal(r.hostCalls[0].kind, 'ensurePrompt')
  const slackAccess = list(r.state).access.find(row => row.platform === 'slack')
  assert.equal(slackAccess.bound, true)
  assert.equal(slackAccess.owner, me)
})

test('unknown DM after bind issues a pairing code and does not call the Host', () => {
  n = 0
  let state = withCatalog(bindOwner(emptyState()))
  const r = handle(state, {
    kind: 'message',
    ...dm(stranger),
    prompt: { text: 'hi', attachments: [] },
    id: id(),
    at: t(),
  })
  assert.equal(r.hostCalls.length, 0)
  assert.equal(r.deliveries.length, 1)
  assert.equal(r.deliveries[0].kind, 'chat')
  assert.equal(r.deliveries[0].body.kind, 'pairingCode')
  assert.equal(list(r.state).groups[0].collapsedByDefault, true)
  assert.equal(list(r.state).groups[0].rows.length, 0)
})

test('approved pairing then a DM becomes ensurePrompt and a list row', () => {
  n = 0
  let state = withCatalog(bindOwner(emptyState()))
  const paired = handle(state, {
    kind: 'message',
    ...dm(stranger),
    prompt: { text: 'hi', attachments: [] },
    id: id(),
    at: t(),
  })
  const code = paired.deliveries[0].body.code
  const allowed = handle(paired.state, { kind: 'pairingDecision', code, op: 'approve', id: id(), at: t() })
  const turn = handle(allowed.state, {
    kind: 'message',
    ...dm(stranger),
    prompt: { text: 'fix it', attachments: [] },
    id: id(),
    at: t(),
  })
  assert.equal(turn.hostCalls.length, 1)
  assert.equal(turn.hostCalls[0].kind, 'ensurePrompt')
  assert.equal(list(turn.state).groups.length, 1)
  assert.equal(list(turn.state).groups[0].platform, 'slack')
  assert.equal(list(turn.state).groups[0].rows.length, 1)
  assert.equal(list(turn.state).groups[0].collapsedByDefault, true)
})

test('unknown slash is rejected and never becomes a prompt', () => {
  n = 0
  const state = withCatalog(bindOwner(emptyState()))
  const r = handle(state, {
    kind: 'command',
    ...dm(me),
    line: { text: 'nope-this' },
    id: id(),
    at: t(),
  })
  assert.equal(r.hostCalls.length, 0)
  assert.equal(r.deliveries[0].kind, 'chat')
  assert.equal(r.deliveries[0].body.kind, 'rejectCommand')
  assert.equal(r.deliveries[0].body.reason, 'unknown')
})

test('model slash from the owner is ensureCommand', () => {
  n = 0
  const state = handle(bindOwner(emptyState()), {
    kind: 'catalog',
    catalog: {
      catchAllPrefix: 'dsh',
      commands: [{ name: 'model', description: 'Show or switch this session model', ownerOnly: false }],
    },
    id: id(),
    at: t(),
  }).state
  const r = handle(state, {
    kind: 'command',
    ...dm(me),
    line: { text: 'model pi-openrouter/gpt-5.6' },
    id: id(),
    at: t(),
  })
  assert.equal(r.hostCalls.length, 1)
  assert.equal(r.hostCalls[0].kind, 'ensureCommand')
})

test('known command from the owner is ensureCommand', () => {
  n = 0
  const state = withCatalog(bindOwner(emptyState()))
  const r = handle(state, {
    kind: 'command',
    ...dm(me),
    line: { text: 'goal keep going' },
    id: id(),
    at: t(),
  })
  assert.equal(r.hostCalls.length, 1)
  assert.equal(r.hostCalls[0].kind, 'ensureCommand')
})

test('channel mention stays off the Computer list', () => {
  n = 0
  const state = withCatalog(bindOwner(emptyState()))
  const r = handle(state, {
    kind: 'message',
    actor: { platform: slack, subject: me },
    identity: { platform: slack, kind: 'group', chatId: chatId('C-1'), threadId: null },
    addressing: { kind: 'group', mentioned: true, botInvited: false },
    prompt: { text: '@dsh ping', attachments: [] },
    id: id(),
    at: t(),
  })
  assert.equal(r.hostCalls.length, 1)
  assert.equal(Object.values(r.state.sessions)[0].identity.kind, 'group')
  assert.equal(list(r.state).groups[0].rows.length, 0)
})

test('Computer list keeps the Slack DM and hides the channel', () => {
  n = 0
  let state = withCatalog(bindOwner(emptyState()))
  const dmTurn = handle(state, {
    kind: 'message',
    ...dm(me),
    prompt: { text: 'hi', attachments: [] },
    id: id(),
    at: t(),
  })
  const both = handle(dmTurn.state, {
    kind: 'message',
    actor: { platform: slack, subject: me },
    identity: { platform: slack, kind: 'group', chatId: chatId('C-1'), threadId: null },
    addressing: { kind: 'group', mentioned: true, botInvited: false },
    prompt: { text: '@dsh ping', attachments: [] },
    id: id(),
    at: t(),
  })
  const rows = list(both.state).groups[0].rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].identity.kind, 'dm')
  assert.equal(Object.keys(both.state.sessions).length, 2)
})

test('slash new rotates the host session instead of prompting', () => {
  n = 0
  const state = handle(bindOwner(emptyState()), {
    kind: 'catalog',
    catalog: {
      catchAllPrefix: 'dsh',
      commands: [{ name: 'new', description: 'Start a fresh session in this chat', ownerOnly: false }],
    },
    id: id(),
    at: t(),
  }).state
  const first = handle(state, {
    kind: 'message',
    ...dm(me),
    prompt: { text: 'hi', attachments: [] },
    id: id(),
    at: t(),
  })
  const bound = handle(first.state, {
    kind: 'hostReport',
    sessionKey: first.hostCalls[0].sessionKey,
    report: { kind: 'bound', hostSessionId: hostSessionId('host-1') },
    id: id(),
    at: t(),
  })
  const rotated = handle(bound.state, {
    kind: 'command',
    ...dm(me),
    line: { text: 'new' },
    id: id(),
    at: t(),
  })
  assert.equal(rotated.hostCalls.length, 1)
  assert.equal(rotated.hostCalls[0].kind, 'rotateSession')
  assert.equal(rotated.hostCalls[0].host.kind, 'bound')
  assert.equal(rotated.hostCalls[0].host.hostSessionId, 'host-1')
  assert.equal(rotated.deliveries.length, 0)
})

test('group message without mention is silent', () => {
  n = 0
  const state = withCatalog(bindOwner(emptyState()))
  const r = handle(state, {
    kind: 'message',
    actor: { platform: slack, subject: me },
    identity: { platform: slack, kind: 'group', chatId: chatId('C-1'), threadId: null },
    addressing: { kind: 'group', mentioned: false, botInvited: false },
    prompt: { text: 'noise', attachments: [] },
    id: id(),
    at: t(),
  })
  assert.equal(r.hostCalls.length, 0)
  assert.equal(r.deliveries.length, 0)
})

test('replay of the same inbound id is a no-op', () => {
  n = 0
  const state = bindOwner(emptyState())
  const event = { kind: 'bind', platform: slack, owner: me, id: inboundId('same'), at: t() }
  const first = handle(emptyState(), event)
  const second = handle(first.state, event)
  assert.equal(second.hostCalls.length, 0)
  assert.equal(second.deliveries.length, 0)
  assert.deepEqual(second.state.access, first.state.access)
})

test('recoverTurns idles a stuck in-flight session after host restart', () => {
  n = 0
  const first = handle(withCatalog(bindOwner(emptyState())), {
    kind: 'message',
    ...dm(me),
    prompt: { text: 'ping', attachments: [] },
    id: id(),
    at: t(),
  })
  const bound = handle(first.state, {
    kind: 'hostReport',
    sessionKey: first.hostCalls[0].sessionKey,
    report: { kind: 'bound', hostSessionId: hostSessionId('host-1') },
    id: id(),
    at: t(),
  })
  assert.equal(Object.values(bound.state.sessions)[0].turn.kind, 'inFlight')
  const recovered = recoverTurns(bound.state)
  const after = Object.values(recovered.state.sessions)[0]
  assert.equal(after.turn.kind, 'idle')
  assert.equal(after.host.kind, 'bound')
  assert.equal(recovered.hostCalls.length, 0)
})

test('recoverTurns dispatches work queued behind a stuck turn', () => {
  n = 0
  const first = handle(withCatalog(bindOwner(emptyState())), {
    kind: 'message',
    ...dm(me),
    prompt: { text: 'one', attachments: [] },
    id: id(),
    at: t(),
  })
  const bound = handle(first.state, {
    kind: 'hostReport',
    sessionKey: first.hostCalls[0].sessionKey,
    report: { kind: 'bound', hostSessionId: hostSessionId('host-1') },
    id: id(),
    at: t(),
  })
  const second = handle(bound.state, {
    kind: 'message',
    ...dm(me),
    prompt: { text: 'two', attachments: [] },
    id: id(),
    at: t(),
  })
  assert.equal(second.hostCalls.length, 0)
  const recovered = recoverTurns(second.state)
  assert.equal(recovered.hostCalls.length, 1)
  assert.equal(recovered.hostCalls[0].kind, 'ensurePrompt')
  assert.equal(recovered.hostCalls[0].prompt.text, 'two')
})
