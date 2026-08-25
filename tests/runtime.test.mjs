import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  chatId,
  emptyState,
  handle,
  inboundId,
  platformId,
  subjectId,
  timestamp,
} from '../lib/types/gateway/index.js'
import { assistantTextFromEvent, GatewayRuntime, turnErrorFromEvent } from '../lib/types/runtime.js'

const slack = platformId('slack')
const me = subjectId('U-owner')
const dmChat = chatId('D-1')
let n = 0
const id = () => inboundId(`rt-${++n}`)
const t = () => timestamp(++n * 1000)

function seedState() {
  n = 0
  const bound = handle(emptyState(), {
    kind: 'bind',
    platform: slack,
    owner: me,
    id: id(),
    at: t(),
  }).state
  return handle(bound, {
    kind: 'catalog',
    catalog: {
      catchAllPrefix: 'dsh',
      commands: [{ name: 'help', description: 'Help', ownerOnly: false }],
    },
    id: id(),
    at: t(),
  }).state
}

function tmpRuntime(agents, defaultModel) {
  const dir = mkdtempSync(join(tmpdir(), 'mgw-rt-'))
  const runtime = new GatewayRuntime({
    path: join(dir, 'state.json'),
    agents,
    state: seedState(),
    ...(defaultModel ? { defaultModel: () => defaultModel } : {}),
  })
  return { runtime, dir }
}

test('assistantTextFromEvent reads text blocks from assistant/message', () => {
  assert.equal(assistantTextFromEvent({ type: 'tool/call', data: {} }), '')
  assert.equal(assistantTextFromEvent({
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'pong from dsh' }] } },
  }), 'pong from dsh')
})

test('ensurePrompt followup alone does not post assistant text', async () => {
  const followups = []
  const { runtime, dir } = tmpRuntime({
    get: () => undefined,
    create: async () => ({
      agent: {
        followup: message => { followups.push(message) },
        cancel: () => {},
      },
      dispose: () => {},
    }),
    resume: async () => { throw new Error('resume should not run') },
  })
  const posted = []
  runtime.onDeliveries = deliveries => { posted.push(...deliveries) }
  try {
    const result = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'ping', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of result.hostCalls) await runtime.perform(call)
    assert.equal(followups.length, 1)
    assert.equal(posted.some(d => d.kind === 'chat' && d.body.kind === 'stream' && d.body.snapshot?.text), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('turn/end error is posted to the chat', async () => {
  const { runtime, dir } = tmpRuntime({
    get: () => undefined,
    create: async () => ({
      agent: { followup: () => {}, cancel: () => {} },
      dispose: () => {},
    }),
    resume: async () => { throw new Error('resume should not run') },
  })
  const posted = []
  runtime.onDeliveries = deliveries => { posted.push(...deliveries) }
  try {
    const result = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'ping', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of result.hostCalls) await runtime.perform(call)
    const hostId = Object.values(runtime.state.sessions)[0].host.hostSessionId
    runtime.noteAgentStatus(hostId, 'running')
    runtime.noteSessionEvent(hostId, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { message: 'prompt variable "{{model}}" has no value' } } },
    })
    const notices = posted.filter(d => d.kind === 'chat' && d.body.kind === 'notice')
    assert.equal(notices.length, 1)
    assert.match(notices[0].body.text, /{{model}}/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ensurePrompt creates with the default model', async () => {
  const created = []
  const { runtime, dir } = tmpRuntime({
    get: () => undefined,
    create: async opts => {
      created.push(opts)
      return { agent: { followup: () => {}, cancel: () => {} }, dispose: () => {} }
    },
    resume: async () => { throw new Error('resume should not run') },
  }, { provider: 'pi-openrouter', model: 'gpt-5.6' })
  try {
    const result = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'ping', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of result.hostCalls) await runtime.perform(call)
    assert.equal(created.length, 1)
    assert.equal(created[0].agentOptions.provider, 'pi-openrouter')
    assert.equal(created[0].agentOptions.model, 'gpt-5.6')
    assert.equal(typeof created[0].setup, 'function')
    assert.match(String(created[0].sessionId), /^session-[0-9a-f-]{36}$/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('session/title fallback re-pins the Slack display title onto the Computer session', async () => {
  const pins = []
  const dir = mkdtempSync(join(tmpdir(), 'mgw-rt-'))
  const runtime = new GatewayRuntime({
    path: join(dir, 'state.json'),
    agents: {
      get: () => undefined,
      create: async () => ({
        agent: { followup: () => {}, cancel: () => {} },
        dispose: () => {},
      }),
      resume: async () => { throw new Error('resume should not run') },
    },
    state: seedState(),
    onHostSession: info => { pins.push(info.title) },
  })
  try {
    const result = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'Reply with exactly: pong-socket-0958. No tools.', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of result.hostCalls) await runtime.perform(call)
    const hostId = Object.values(runtime.state.sessions)[0].host.hostSessionId
    pins.length = 0
    runtime.noteSessionEvent(hostId, {
      type: 'session/title',
      data: {
        title: 'Reply with exactly: pong-socket-0958. No',
        source: { kind: 'fallback' },
      },
    })
    assert.equal(pins.length, 1)
    assert.equal(pins[0], 'Slack DM · U-owner')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ensurePrompt resumes a bound session with the default model', async () => {
  const resumed = []
  const { runtime, dir } = tmpRuntime({
    get: () => undefined,
    create: async () => ({
      agent: { followup: () => {}, cancel: () => {} },
      dispose: () => {},
    }),
    resume: async opts => {
      resumed.push(opts)
      return { agent: { followup: () => {}, cancel: () => {} }, dispose: () => {} }
    },
  }, { provider: 'pi-openrouter', model: 'gpt-5.6' })
  try {
    const first = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'ping', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of first.hostCalls) await runtime.perform(call)
    const key = Object.keys(runtime.state.sessions)[0]
    const hostId = Object.values(runtime.state.sessions)[0].host.hostSessionId
    runtime.apply({
      kind: 'hostReport',
      sessionKey: key,
      report: { kind: 'turnEnded' },
      id: id(),
      at: t(),
    })
    const second = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'again', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of second.hostCalls) await runtime.perform(call)
    assert.equal(resumed.length, 1)
    assert.equal(String(resumed[0].resumeSessionId), String(hostId))
    assert.equal(resumed[0].agentOptions.provider, 'pi-openrouter')
    assert.equal(resumed[0].agentOptions.model, 'gpt-5.6')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ensurePrompt creates in the supplied cwd', async () => {
  const created = []
  const dir = mkdtempSync(join(tmpdir(), 'mgw-rt-'))
  const runtime = new GatewayRuntime({
    path: join(dir, 'state.json'),
    agents: {
      get: () => undefined,
      create: async opts => {
        created.push(opts)
        return { agent: { followup: () => {}, cancel: () => {} }, dispose: () => {} }
      },
      resume: async () => { throw new Error('resume should not run') },
    },
    state: seedState(),
    cwd: () => '/tmp/current-workspace',
  })
  try {
    const result = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'ping', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of result.hostCalls) await runtime.perform(call)
    assert.equal(created[0].meta.cwd, '/tmp/current-workspace')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('turnErrorFromEvent reads assembly failures', () => {
  assert.equal(turnErrorFromEvent({ type: 'assistant/message' }), undefined)
  assert.match(turnErrorFromEvent({
    type: 'turn/end',
    data: { reason: { kind: 'error', error: { message: 'prompt variable "{{model}}" has no value' } } },
  }), /model/)
})

test('agent running then assistant/message then idle posts the reply', async () => {
  const { runtime, dir } = tmpRuntime({
    get: () => undefined,
    create: async () => ({
      agent: {
        followup: () => {},
        cancel: () => {},
      },
      dispose: () => {},
    }),
    resume: async () => { throw new Error('resume should not run') },
  })
  const posted = []
  runtime.onDeliveries = deliveries => { posted.push(...deliveries) }
  try {
    const result = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'ping', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of result.hostCalls) await runtime.perform(call)
    const hostId = Object.values(runtime.state.sessions)[0].host.hostSessionId
    runtime.noteAgentStatus(hostId, 'running')
    runtime.noteSessionEvent(hostId, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'pong from dsh' }] } },
    })
    runtime.noteAgentStatus(hostId, 'idle')
    const bodies = posted.filter(d => d.kind === 'chat').map(d => d.body)
    assert.equal(bodies.some(b => b.kind === 'busy' && b.on === true), true)
    assert.equal(bodies.some(b => b.kind === 'stream' && b.snapshot?.text === 'pong from dsh'), true)
    assert.equal(Object.values(runtime.state.sessions)[0].turn.kind, 'idle')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('slash new archives the old host session and mints another', async () => {
  const created = []
  const archived = []
  const cancelled = []
  const dir = mkdtempSync(join(tmpdir(), 'mgw-rt-'))
  const runtime = new GatewayRuntime({
    path: join(dir, 'state.json'),
    agents: {
      get: id => ({
        followup: () => {},
        cancel: () => { cancelled.push(String(id)) },
      }),
      create: async opts => {
        created.push(opts)
        return { agent: { followup: () => {}, cancel: () => {} }, dispose: () => {} }
      },
      resume: async () => { throw new Error('resume should not run') },
    },
    state: seedState(),
    onArchiveSession: hostId => { archived.push(hostId) },
  })
  runtime.replaceCatalog([])
  try {
    const first = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'ping', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of first.hostCalls) await runtime.perform(call)
    const oldId = String(Object.values(runtime.state.sessions)[0].host.hostSessionId)
    const rotated = runtime.apply({
      kind: 'command',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      line: { text: 'new' },
      id: id(),
      at: t(),
    })
    assert.equal(rotated.hostCalls[0].kind, 'rotateSession')
    for (const call of rotated.hostCalls) await runtime.perform(call)
    const nextId = String(Object.values(runtime.state.sessions)[0].host.hostSessionId)
    assert.equal(created.length, 2)
    assert.notEqual(nextId, oldId)
    assert.deepEqual(archived, [oldId])
    assert.equal(cancelled.includes(oldId), true)
    assert.match(String(created[1].sessionId), /^session-[0-9a-f-]{36}$/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('skill slash becomes a prompt with a leading slash', async () => {
  const followups = []
  const { runtime, dir } = tmpRuntime({
    get: () => undefined,
    create: async () => ({
      agent: {
        followup: message => { followups.push(message) },
        cancel: () => {},
      },
      dispose: () => {},
    }),
    resume: async () => { throw new Error('resume should not run') },
  })
  try {
    runtime.setSkills([{ name: 'my-skill', description: 'Does a thing' }])
    const result = runtime.apply({
      kind: 'command',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      line: { text: 'my-skill now' },
      id: id(),
      at: t(),
    })
    assert.equal(result.hostCalls[0].kind, 'ensureCommand')
    for (const call of result.hostCalls) await runtime.perform(call)
    const text = followups[0].content.find(block => block.type === 'text').text
    assert.equal(text, '/my-skill now')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flush performs work queued behind turnEnded', async () => {
  const followups = []
  const { runtime, dir } = tmpRuntime({
    get: () => undefined,
    create: async () => ({
      agent: {
        followup: message => { followups.push(message) },
        cancel: () => {},
      },
      dispose: () => {},
    }),
    resume: async () => ({
      agent: {
        followup: message => { followups.push(message) },
        cancel: () => {},
      },
      dispose: () => {},
    }),
  })
  try {
    const first = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'one', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of first.hostCalls) await runtime.perform(call)
    const second = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: me },
      identity: { platform: slack, kind: 'dm', chatId: dmChat, threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'two', attachments: [] },
      id: id(),
      at: t(),
    })
    assert.equal(second.hostCalls.length, 0)
    const hostId = Object.values(runtime.state.sessions)[0].host.hostSessionId
    runtime.noteAgentStatus(hostId, 'running')
    runtime.noteSessionEvent(hostId, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'ok' }] } },
    })
    runtime.noteAgentStatus(hostId, 'idle')
    await runtime.flush()
    assert.equal(followups.length, 2)
    assert.equal(followups[1].content.find(block => block.type === 'text').text, 'two')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

