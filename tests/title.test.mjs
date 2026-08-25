import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatId,
  displayTitle,
  emptyState,
  handle,
  inboundId,
  list,
  looksLikePromptTitle,
  platformId,
  platformLabel,
  recoverTurns,
  subjectId,
  threadId,
  timestamp,
} from '../lib/types/gateway/index.js'

const slack = platformId('slack')
const me = subjectId('U-owner')
let n = 0
const id = () => inboundId(`t-${++n}`)
const t = () => timestamp(++n * 1000)

test('platformLabel is title case, not uppercase SLACK', () => {
  assert.equal(platformLabel('slack'), 'Slack')
  assert.equal(platformLabel('feishu'), 'Feishu')
})

test('displayTitle uses Slack DM, #channel, and thread', () => {
  assert.equal(displayTitle({
    platform: slack, kind: 'dm', chatId: chatId('D1'), threadId: null,
  }, { peerName: 'wu' }), 'Slack DM · wu')
  assert.equal(displayTitle({
    platform: slack, kind: 'group', chatId: chatId('C1'), threadId: null,
  }, { chatName: '新频道' }), '#新频道')
  assert.equal(displayTitle({
    platform: slack, kind: 'group', chatId: chatId('C1'), threadId: threadId('2.0'),
  }, { chatName: '新频道' }), '#新频道 · 帖')
})

test('Feishu DM drops ou_/oc_ ids and keeps a human name', () => {
  const feishu = platformId('feishu')
  const dm = {
    platform: feishu, kind: 'dm', chatId: chatId('oc_testdm000000000000000000000000'), threadId: null,
  }
  assert.equal(displayTitle(dm), 'Feishu DM')
  assert.equal(displayTitle(dm, { peerName: 'ou_testowner0000000000000000000000' }), 'Feishu DM')
  assert.equal(displayTitle(dm, { peerName: '吴松斌' }), 'Feishu DM · 吴松斌')
  assert.equal(looksLikePromptTitle('Feishu DM · ou_testowner0000000000000000000000', dm), true)
  assert.equal(looksLikePromptTitle('Feishu DM', dm), false)
  assert.equal(looksLikePromptTitle('Feishu DM · 吴松斌', dm), false)
})

test('looksLikePromptTitle catches mention snippets and first messages', () => {
  const dm = { platform: slack, kind: 'dm', chatId: chatId('D1'), threadId: null }
  const group = { platform: slack, kind: 'group', chatId: chatId('C1'), threadId: null }
  assert.equal(looksLikePromptTitle('<@U00BOTMENTION> ping', group), true)
  assert.equal(looksLikePromptTitle('你是什么模型', dm), true)
  assert.equal(looksLikePromptTitle('Slack DM · wu', dm), false)
  assert.equal(looksLikePromptTitle('#新频道', group), false)
})

test('owner DM list row is Slack DM · member, not the first message', () => {
  n = 0
  const bound = handle(emptyState(), { kind: 'bind', platform: slack, owner: me, id: id(), at: t() }).state
  const cataloged = handle(bound, {
    kind: 'catalog',
    catalog: { catchAllPrefix: 'dsh', commands: [] },
    id: id(),
    at: t(),
  }).state
  const turn = handle(cataloged, {
    kind: 'message',
    actor: { platform: slack, subject: me },
    identity: { platform: slack, kind: 'dm', chatId: chatId('D-1'), threadId: null },
    addressing: { kind: 'dm' },
    prompt: { text: '你是什么模型', attachments: [] },
    id: id(),
    at: t(),
  })
  const row = list(turn.state).groups[0].rows[0]
  assert.equal(list(turn.state).groups[0].label, 'Slack')
  assert.equal(row.title, 'Slack DM · U-owner')
})

test('mentioned channel row is #chatId until setTitle names it', () => {
  n = 0
  const bound = handle(emptyState(), { kind: 'bind', platform: slack, owner: me, id: id(), at: t() }).state
  const cataloged = handle(bound, {
    kind: 'catalog',
    catalog: { catchAllPrefix: 'dsh', commands: [] },
    id: id(),
    at: t(),
  }).state
  const turn = handle(cataloged, {
    kind: 'message',
    actor: { platform: slack, subject: me },
    identity: { platform: slack, kind: 'group', chatId: chatId('C-1'), threadId: null },
    addressing: { kind: 'group', mentioned: true, botInvited: false },
    prompt: { text: '<@U00BOTMENTION> ping', attachments: [] },
    id: id(),
    at: t(),
  })
  assert.equal(Object.values(turn.state.sessions)[0].title, '#C-1')
  assert.equal(list(turn.state).groups[0].rows.length, 0)
  const named = handle(turn.state, {
    kind: 'setTitle',
    identity: { platform: slack, kind: 'group', chatId: chatId('C-1'), threadId: null },
    title: '#新频道',
    id: id(),
    at: t(),
  })
  assert.equal(Object.values(named.state.sessions)[0].title, '#新频道')
  assert.equal(list(named.state).groups[0].rows.length, 0)
})

test('recoverTurns rewrites first-message titles', () => {
  n = 0
  const bound = handle(emptyState(), { kind: 'bind', platform: slack, owner: me, id: id(), at: t() }).state
  const cataloged = handle(bound, {
    kind: 'catalog',
    catalog: { catchAllPrefix: 'dsh', commands: [] },
    id: id(),
    at: t(),
  }).state
  const turn = handle(cataloged, {
    kind: 'message',
    actor: { platform: slack, subject: me },
    identity: { platform: slack, kind: 'dm', chatId: chatId('D-1'), threadId: null },
    addressing: { kind: 'dm' },
    prompt: { text: 'ping', attachments: [] },
    id: id(),
    at: t(),
  })
  const key = Object.keys(turn.state.sessions)[0]
  const stuck = {
    ...turn.state,
    sessions: {
      ...turn.state.sessions,
      [key]: { ...turn.state.sessions[key], title: 'ping' },
    },
  }
  const recovered = recoverTurns(stuck)
  assert.equal(Object.values(recovered.state.sessions)[0].title, 'Slack DM · D-1')
})

test('recoverTurns strips Feishu open_id titles', () => {
  n = 0
  const feishu = platformId('feishu')
  const bound = handle(emptyState(), { kind: 'bind', platform: feishu, owner: subjectId('ou_testowner0000000000000000000000'), id: id(), at: t() }).state
  const turn = handle(bound, {
    kind: 'message',
    actor: { platform: feishu, subject: subjectId('ou_testowner0000000000000000000000') },
    identity: { platform: feishu, kind: 'dm', chatId: chatId('oc_testdm000000000000000000000000'), threadId: null },
    addressing: { kind: 'dm' },
    prompt: { text: 'hello', attachments: [] },
    id: id(),
    at: t(),
  })
  assert.equal(list(turn.state).groups[0].rows[0].title, 'Feishu DM')
  const key = Object.keys(turn.state.sessions)[0]
  const stuck = {
    ...turn.state,
    sessions: {
      ...turn.state.sessions,
      [key]: { ...turn.state.sessions[key], title: 'Feishu DM · ou_testowner0000000000000000000000' },
    },
  }
  const recovered = recoverTurns(stuck)
  assert.equal(Object.values(recovered.state.sessions)[0].title, 'Feishu DM')
})
