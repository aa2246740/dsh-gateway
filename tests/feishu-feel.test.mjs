import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  approvalId,
  chatId,
  emptyState,
  handle,
  hostSessionId,
  inboundId,
  platformId,
  sessionKey,
  subjectId,
  timestamp,
} from '../lib/types/gateway/index.js'
import {
  FEISHU_SPEAKING_CONTRACT,
  FEISHU_SPEAKING_CONTRACT_SECTION,
  installFeishuSpeakingContract,
  outcomeFromAnswer,
} from '../lib/types/feishu-voice.js'
import {
  feishuApprovalCard,
  handledFeishuCard,
  inboundFromFeishuCardAction,
} from '../lib/types/feishu-card.js'
import { feishuOutboundFromDelivery, inboundFromFeishu, presentFeishuDelivery } from '../lib/types/feishu.js'
import { presentSlackDelivery } from '../lib/types/slack.js'
import { GatewayRuntime } from '../lib/types/runtime.js'
import { textFromDelivery } from '../lib/types/present.js'

const feishu = platformId('feishu')
const slack = platformId('slack')
const owner = subjectId('ou_owner')
const guest = subjectId('ou_other')
const dmChat = chatId('oc_dm')
const groupChat = chatId('oc_group')
let n = 0
const id = () => inboundId(`feel-${++n}`)
const t = () => timestamp(++n * 1000)

function bind(platform, who = owner) {
  return handle(emptyState(), { kind: 'bind', platform, owner: who, id: id(), at: t() }).state
}

function catalog(state) {
  return handle(state, {
    kind: 'catalog',
    catalog: {
      catchAllPrefix: 'dsh',
      commands: [{ name: 'help', description: 'Help', ownerOnly: false }],
    },
    id: id(),
    at: t(),
  }).state
}

function recordingCtx(sections, listeners) {
  return {
    agent: { id: 'session-test' },
    systemPrompt: {
      section: section => { sections.push(section) },
      getSectionOrder: name => name === 'DEPLOYMENT_PERSONA' ? 0 : 50,
    },
    get: name => name === 'systemPrompt' ? undefined : undefined,
    on: (event, fn) => { listeners.push({ event, fn }); return () => {} },
    effect: fn => fn(),
  }
}

function tmpRuntime(agents, state) {
  const dir = mkdtempSync(join(tmpdir(), 'mgw-feel-'))
  const runtime = new GatewayRuntime({
    path: join(dir, 'state.json'),
    agents,
    state,
  })
  return { runtime, dir }
}

function fakeAgents(created, sections, listeners) {
  return {
    get: () => undefined,
    create: async opts => {
      created.push(opts)
      const ctx = recordingCtx(sections, listeners)
      ctx.agent = { id: opts.sessionId }
      opts.setup?.(ctx)
      return { agent: { followup: () => {}, cancel: () => {}, ctx }, dispose: () => {} }
    },
    resume: async () => { throw new Error('resume should not run') },
  }
}

test('speaking contract is product language without Grok handbook text or prompt variables', () => {
  assert.match(FEISHU_SPEAKING_CONTRACT, /friend/)
  assert.match(FEISHU_SPEAKING_CONTRACT, /human sentences/)
  assert.match(FEISHU_SPEAKING_CONTRACT, /tool names/)
  assert.equal(FEISHU_SPEAKING_CONTRACT.includes('{{'), false)
  assert.equal(/grok bot|xAI|x\.ai/i.test(FEISHU_SPEAKING_CONTRACT), false)
  assert.equal(outcomeFromAnswer('allow-once'), 'allowed-once')
  assert.equal(outcomeFromAnswer('deny'), 'rejected')
})

test('installFeishuSpeakingContract registers the agent-scoped section', () => {
  const sections = []
  installFeishuSpeakingContract(recordingCtx(sections, []))
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, FEISHU_SPEAKING_CONTRACT_SECTION)
  assert.equal(sections[0].text, FEISHU_SPEAKING_CONTRACT)
  assert.equal(sections[0].complete, undefined)
})

test('Feishu DM inbound binds its own host session, not a desktop or Slack session', async () => {
  n = 0
  let state = catalog(bind(feishu))
  const desktop = handle(state, {
    kind: 'message',
    actor: { platform: slack, subject: subjectId('U-desk') },
    identity: { platform: slack, kind: 'dm', chatId: chatId('D-desk'), threadId: null },
    addressing: { kind: 'dm' },
    prompt: { text: 'desktop ping', attachments: [] },
    id: id(),
    at: t(),
  })
  state = handle(desktop.state, {
    kind: 'hostReport',
    sessionKey: desktop.hostCalls[0].sessionKey,
    report: { kind: 'bound', hostSessionId: hostSessionId('session-desktop') },
    id: id(),
    at: t(),
  }).state
  const created = []
  const sections = []
  const { runtime, dir } = tmpRuntime(fakeAgents(created, sections, []), state)
  try {
    const inbound = inboundFromFeishu({
      user: String(owner),
      chatId: String(dmChat),
      chatType: 'p2p',
      text: '你好',
      id: 'om_feel_1',
      commands: ['help'],
    })
    const result = runtime.apply(inbound)
    assert.equal(result.hostCalls[0].kind, 'ensurePrompt')
    assert.notEqual(result.hostCalls[0].sessionKey, desktop.hostCalls[0].sessionKey)
    for (const call of result.hostCalls) await runtime.perform(call)
    assert.equal(created.length, 1)
    assert.notEqual(String(created[0].sessionId), 'session-desktop')
    assert.match(String(created[0].sessionId), /^session-[0-9a-f-]{36}$/i)
    const feishuSession = Object.values(runtime.state.sessions).find(s => s.identity.platform === 'feishu')
    assert.equal(feishuSession.host.hostSessionId, String(created[0].sessionId))
    const slackSession = Object.values(runtime.state.sessions).find(s => s.identity.platform === 'slack')
    assert.equal(slackSession.host.hostSessionId, 'session-desktop')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Feishu and Slack gateway setup both get the speaking contract; desktop setupForAgent does not', async () => {
  n = 0
  const feishuSections = []
  const slackSections = []
  const desktopSections = []
  const feishuCreated = []
  const slackCreated = []
  const feishuListeners = []
  const slackListeners = []
  const { runtime: feishuRt, dir: feishuDir } = tmpRuntime(
    fakeAgents(feishuCreated, feishuSections, feishuListeners),
    catalog(bind(feishu)),
  )
  const { runtime: slackRt, dir: slackDir } = tmpRuntime(
    fakeAgents(slackCreated, slackSections, slackListeners),
    catalog(bind(slack, subjectId('U-owner'))),
  )
  try {
    const feishuTurn = feishuRt.apply(inboundFromFeishu({
      user: String(owner),
      chatId: String(dmChat),
      chatType: 'p2p',
      text: 'hi',
      id: 'om_voice_1',
      commands: ['help'],
    }))
    for (const call of feishuTurn.hostCalls) await feishuRt.perform(call)
    const slackTurn = slackRt.apply({
      kind: 'message',
      actor: { platform: slack, subject: subjectId('U-owner') },
      identity: { platform: slack, kind: 'dm', chatId: chatId('D-1'), threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'hi', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of slackTurn.hostCalls) await slackRt.perform(call)
    assert.equal(feishuSections.some(s => s.name === FEISHU_SPEAKING_CONTRACT_SECTION), true)
    assert.equal(slackSections.some(s => s.name === FEISHU_SPEAKING_CONTRACT_SECTION), true)
    assert.equal(feishuListeners.some(row => row.event === 'approval/request'), true)
    assert.equal(slackListeners.some(row => row.event === 'approval/request'), false)
    const desktopSetup = slackRt.setupForAgent()
    desktopSetup?.(recordingCtx(desktopSections, []))
    assert.equal(desktopSections.some(s => s.name === FEISHU_SPEAKING_CONTRACT_SECTION), false)
  } finally {
    rmSync(feishuDir, { recursive: true, force: true })
    rmSync(slackDir, { recursive: true, force: true })
  }
})

test('Feishu delivers Working… then each committed sentence before idle, without splitting periods', async () => {
  n = 0
  const created = []
  const { runtime, dir } = tmpRuntime(fakeAgents(created, [], []), catalog(bind(feishu)))
  const posted = []
  runtime.onDeliveries = deliveries => { posted.push(...deliveries) }
  try {
    const result = runtime.apply(inboundFromFeishu({
      user: String(owner),
      chatId: String(dmChat),
      chatType: 'p2p',
      text: 'ping',
      id: 'om_stream_1',
      commands: ['help'],
    }))
    for (const call of result.hostCalls) await runtime.perform(call)
    const hostId = Object.values(runtime.state.sessions)[0].host.hostSessionId
    runtime.noteAgentStatus(hostId, 'running')
    runtime.noteSessionEvent(hostId, { type: 'tool/call', data: { name: 'bash', arguments: '{}' } })
    runtime.noteSessionEvent(hostId, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'Done. Files are in /tmp/out.' }] } },
    })
    const beforeIdle = posted.filter(d => d.kind === 'chat').map(d => d.body)
    assert.equal(beforeIdle.some(b => b.kind === 'busy' && b.on === true), true)
    const streamsBeforeIdle = beforeIdle.filter(b => b.kind === 'stream' && b.snapshot?.text)
    assert.equal(streamsBeforeIdle.length, 1)
    assert.equal(streamsBeforeIdle[0].snapshot.text, 'Done. Files are in /tmp/out.')
    assert.equal(streamsBeforeIdle[0].snapshot.tools.length, 0)
    runtime.noteSessionEvent(hostId, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'Need anything else?' }] } },
    })
    runtime.noteAgentStatus(hostId, 'idle')
    const chat = posted.filter(d => d.kind === 'chat')
    const sentences = chat.filter(d => d.body.kind === 'stream' && d.body.snapshot?.text).map(d => d.body.snapshot.text)
    assert.deepEqual(sentences, ['Done. Files are in /tmp/out.', 'Need anything else?'])
    const cards = new Map()
    const outbound = []
    for (const delivery of chat) {
      const row = feishuOutboundFromDelivery(delivery, cards)
      if (row) outbound.push(row)
    }
    const texts = outbound.filter(row => row.msgType === 'text').map(row => JSON.parse(row.content).text)
    assert.equal(texts[0], 'Working…')
    assert.deepEqual(texts.slice(1), ['Done. Files are in /tmp/out.', 'Need anything else?'])
    assert.equal(texts.some(text => text.includes('bash')), false)
    assert.equal(texts.filter(text => text === 'Working…').length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Slack delivers Working… then each committed sentence before idle; still no Feishu card format', async () => {
  n = 0
  const created = []
  const { runtime, dir } = tmpRuntime(fakeAgents(created, [], []), catalog(bind(slack, subjectId('U-owner'))))
  const posted = []
  runtime.onDeliveries = deliveries => { posted.push(...deliveries) }
  try {
    const result = runtime.apply({
      kind: 'message',
      actor: { platform: slack, subject: subjectId('U-owner') },
      identity: { platform: slack, kind: 'dm', chatId: chatId('D-1'), threadId: null },
      addressing: { kind: 'dm' },
      prompt: { text: 'explain everything', attachments: [] },
      id: id(),
      at: t(),
    })
    for (const call of result.hostCalls) await runtime.perform(call)
    const hostId = Object.values(runtime.state.sessions)[0].host.hostSessionId
    runtime.noteAgentStatus(hostId, 'running')
    runtime.noteSessionEvent(hostId, { type: 'tool/call', data: { name: 'bash' } })
    runtime.noteSessionEvent(hostId, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'Done. Files are in /tmp/out.' }] } },
    })
    const mid = posted.filter(d => d.kind === 'chat' && d.body.kind === 'stream' && d.body.snapshot?.text)
    assert.equal(mid.length, 1)
    assert.equal(mid[0].body.snapshot.text, 'Done. Files are in /tmp/out.')
    runtime.noteSessionEvent(hostId, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'Need anything else?' }] } },
    })
    runtime.noteAgentStatus(hostId, 'idle')
    const chat = posted.filter(d => d.kind === 'chat')
    const sentences = chat.filter(d => d.body.kind === 'stream' && d.body.snapshot?.text).map(d => d.body.snapshot.text)
    assert.deepEqual(sentences, ['Done. Files are in /tmp/out.', 'Need anything else?'])
    const said = []
    for (const delivery of chat) {
      await presentSlackDelivery(delivery, async args => { said.push(args.text) })
    }
    assert.equal(said[0], 'Working…')
    assert.deepEqual(said.slice(1), ['Done. Files are in /tmp/out.', 'Need anything else?'])
    assert.equal(said.some(text => text.includes('bash')), false)
    const cards = new Map()
    for (const delivery of chat) {
      assert.equal(feishuOutboundFromDelivery(delivery, cards), undefined)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Feishu approval outbound is a card; allow-once continues; deny stops; second click is ignored', async () => {
  n = 0
  let state = catalog(bind(feishu))
  const opened = handle(state, inboundFromFeishu({
    user: String(owner),
    chatId: String(dmChat),
    chatType: 'p2p',
    text: 'do it',
    id: 'om_appr_1',
    commands: ['help'],
  }))
  state = handle(opened.state, {
    kind: 'hostReport',
    sessionKey: opened.hostCalls[0].sessionKey,
    report: { kind: 'bound', hostSessionId: hostSessionId('session-feishu') },
    id: id(),
    at: t(),
  }).state
  const key = opened.hostCalls[0].sessionKey
  const asked = handle(state, {
    kind: 'hostReport',
    sessionKey: key,
    report: {
      kind: 'approvalRequested',
      request: {
        requestId: approvalId('req-1'),
        summary: 'Run bash',
        options: ['allow-once', 'deny'],
      },
    },
    id: id(),
    at: t(),
  })
  const approval = asked.deliveries.find(d => d.kind === 'chat' && d.body.kind === 'approval')
  assert.ok(approval)
  assert.equal(approval.body.handled, undefined)
  const cards = new Map()
  const outbound = feishuOutboundFromDelivery(approval, cards)
  assert.equal(outbound.msgType, 'interactive')
  const card = JSON.parse(outbound.content)
  assert.equal(card.header.title.content, '需要批准')
  const labels = card.elements[1].actions.map(a => a.text.content)
  assert.deepEqual(labels, ['允许一次', '拒绝'])
  assert.equal(labels.includes('Allow always'), false)
  const recorded = []
  await presentFeishuDelivery(approval, async out => {
    recorded.push(out)
    return { messageId: 'om_card_1' }
  }, cards)
  assert.equal(cards.get('req-1'), 'om_card_1')

  const clickAllow = inboundFromFeishuCardAction({
    operator: { open_id: String(owner) },
    action: { value: card.elements[1].actions[0].value },
    context: { open_chat_id: String(dmChat), open_message_id: 'om_card_1' },
  })
  assert.equal(clickAllow.kind, 'approvalAnswer')
  assert.equal(clickAllow.answer, 'allow-once')
  const allowed = handle(asked.state, clickAllow)
  assert.equal(allowed.hostCalls.length, 1)
  assert.equal(allowed.hostCalls[0].kind, 'answerApproval')
  assert.equal(allowed.hostCalls[0].answer, 'allow-once')
  const handled = allowed.deliveries.find(d => d.kind === 'chat' && d.body.kind === 'approval')
  assert.equal(handled.body.handled, true)
  const patch = feishuOutboundFromDelivery(handled, cards)
  assert.equal(patch.mode, 'patch')
  assert.equal(JSON.parse(patch.content).header.title.content, '已处理')

  const second = handle(allowed.state, inboundFromFeishuCardAction({
    operator: { open_id: String(owner) },
    action: { value: card.elements[1].actions[0].value },
    context: { open_chat_id: String(dmChat), open_message_id: 'om_card_1-again' },
  }))
  assert.equal(second.hostCalls.length, 0)

  const denyState = handle(asked.state, inboundFromFeishuCardAction({
    operator: { open_id: String(owner) },
    action: { value: card.elements[1].actions[1].value },
    context: { open_chat_id: String(dmChat), open_message_id: 'om_card_deny' },
  }))
  assert.equal(denyState.hostCalls[0].answer, 'deny')
})

test('non-owner Feishu card click does not settle', () => {
  n = 0
  let state = catalog(bind(feishu))
  state = handle(state, {
    kind: 'allowlist',
    platform: feishu,
    subject: guest,
    op: 'add',
    id: id(),
    at: t(),
  }).state
  const opened = handle(state, inboundFromFeishu({
    user: String(owner),
    chatId: String(groupChat),
    chatType: 'group',
    text: 'do it',
    id: 'om_grp_1',
    mentioned: true,
    commands: ['help'],
  }))
  state = handle(opened.state, {
    kind: 'hostReport',
    sessionKey: opened.hostCalls[0].sessionKey,
    report: { kind: 'bound', hostSessionId: hostSessionId('session-group') },
    id: id(),
    at: t(),
  }).state
  const asked = handle(state, {
    kind: 'hostReport',
    sessionKey: opened.hostCalls[0].sessionKey,
    report: {
      kind: 'approvalRequested',
      request: {
        requestId: approvalId('req-g'),
        summary: 'Write file',
        options: ['allow-once', 'deny'],
      },
    },
    id: id(),
    at: t(),
  })
  const identity = asked.state.sessions[opened.hostCalls[0].sessionKey].identity
  const card = feishuApprovalCard(asked.deliveries[0].body.request, identity)
  const click = inboundFromFeishuCardAction({
    operator: { open_id: String(guest) },
    action: { value: card.elements[1].actions[0].value },
    context: { open_chat_id: String(groupChat), open_message_id: 'om_card_g' },
  })
  const result = handle(asked.state, click)
  assert.equal(result.hostCalls.length, 0)
  assert.equal(result.deliveries[0].body.kind, 'notice')
  assert.match(result.deliveries[0].body.text, /owner/i)
  assert.equal(Object.values(result.state.sessions)[0].turn.kind, 'awaitingApproval')
})

test('Slack approval stays plain text, not a Feishu card', async () => {
  n = 0
  const identity = { platform: slack, kind: 'dm', chatId: chatId('D-1'), threadId: null }
  const delivery = {
    kind: 'chat',
    identity,
    sessionKey: sessionKey(identity),
    body: {
      kind: 'approval',
      request: { requestId: approvalId('req-s'), summary: 'Run bash', options: ['allow-once', 'deny'] },
    },
  }
  const said = []
  await presentSlackDelivery(delivery, async args => { said.push(args) })
  assert.equal(said[0].text, 'Approval needed: Run bash')
  assert.equal(feishuOutboundFromDelivery(delivery, new Map()), undefined)
  assert.equal(textFromDelivery(delivery), 'Approval needed: Run bash')
  const handled = handledFeishuCard(delivery.body.request, 'deny')
  assert.equal(handled.header.title.content, '已处理')
})

test('runtime maps approval/asked to a card delivery and allow-once resolves the host call', async () => {
  n = 0
  const created = []
  const listeners = []
  const { runtime, dir } = tmpRuntime(fakeAgents(created, [], listeners), catalog(bind(feishu)))
  const posted = []
  runtime.onDeliveries = deliveries => { posted.push(...deliveries) }
  try {
    const result = runtime.apply(inboundFromFeishu({
      user: String(owner),
      chatId: String(dmChat),
      chatType: 'p2p',
      text: 'touch disk',
      id: 'om_rt_appr',
      commands: ['help'],
    }))
    for (const call of result.hostCalls) await runtime.perform(call)
    assert.equal(listeners.some(row => row.event === 'approval/request'), true)
    const hostId = Object.values(runtime.state.sessions)[0].host.hostSessionId
    runtime.noteSessionEvent(hostId, {
      type: 'approval/asked',
      data: { id: 'req-live', toolName: 'bash', reason: 'Write outside workspace' },
    })
    const approval = posted.find(d => d.kind === 'chat' && d.body.kind === 'approval')
    assert.equal(approval.body.request.summary, 'Write outside workspace')
    const outbound = feishuOutboundFromDelivery(approval, new Map())
    assert.equal(outbound.msgType, 'interactive')
    const click = inboundFromFeishuCardAction({
      operator: { open_id: String(owner) },
      action: { value: JSON.parse(outbound.content).elements[1].actions[0].value },
      context: { open_chat_id: String(dmChat), open_message_id: 'om_live' },
    })
    const answered = runtime.apply(click)
    assert.equal(answered.hostCalls[0].kind, 'answerApproval')
    await runtime.perform(answered.hostCalls[0])
    runtime.noteSessionEvent(hostId, {
      type: 'approval/decided',
      data: { id: 'req-live', outcome: 'allowed-once' },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
