import assert from 'node:assert/strict'
import test from 'node:test'
import { inboundFromFeishu, inboundFromFeishuEvent, textFromFeishuContent } from '../lib/types/feishu.js'
import { planFeishuSlashSync } from '../lib/types/feishu-slash.js'
import { buildCatalog, feishuSlashesFromCatalog } from '../lib/types/host-catalog.js'

test('feishu slash picker text without slash is a command', () => {
  const inbound = inboundFromFeishu({
    user: 'ou_1',
    chatId: 'oc_dm',
    chatType: 'p2p',
    text: 'help',
    id: 'om_1',
    commands: ['help', 'model'],
  })
  assert.equal(inbound.kind, 'command')
  assert.equal(inbound.line.text, 'help')
  assert.equal(inbound.identity.kind, 'dm')
  assert.equal(inbound.identity.platform, 'feishu')
})

test('feishu ordinary p2p chat stays a prompt', () => {
  const inbound = inboundFromFeishu({
    user: 'ou_1',
    chatId: 'oc_dm',
    chatType: 'p2p',
    text: '你好',
    id: 'om_2',
    commands: ['help', 'model'],
  })
  assert.equal(inbound.kind, 'message')
  assert.equal(inbound.prompt.text, '你好')
})

test('feishu group needs a bot mention flag on inbound', () => {
  const inbound = inboundFromFeishu({
    user: 'ou_1',
    chatId: 'oc_group',
    chatType: 'group',
    text: 'help',
    id: 'om_3',
    mentioned: true,
    commands: ['help'],
  })
  assert.equal(inbound.addressing.kind, 'group')
  assert.equal(inbound.addressing.mentioned, true)
  assert.equal(inbound.kind, 'command')
})

test('feishu event parser skips bot senders and reads text JSON', () => {
  assert.equal(textFromFeishuContent('{"text":"@_user_1 /model"}'), '/model')
  const skipped = inboundFromFeishuEvent({
    sender: { sender_type: 'bot', sender_id: { open_id: 'ou_bot' } },
    message: { message_id: 'om_x', chat_id: 'oc_x', chat_type: 'p2p', content: '{"text":"hi"}' },
  }, ['help'])
  assert.equal(skipped, undefined)
  const inbound = inboundFromFeishuEvent({
    sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
    message: {
      message_id: 'om_4',
      chat_id: 'oc_g',
      chat_type: 'group',
      content: '{"text":"@_user_1 help"}',
      mentions: [{ mentioned_type: 'bot' }],
    },
  }, ['help'])
  assert.equal(inbound.kind, 'command')
  assert.equal(inbound.addressing.mentioned, true)
})

test('feishu slash descriptions stay within the OpenAPI 100-character cap', () => {
  const catalog = buildCatalog([{ name: 'long', description: 'x'.repeat(140) }], [])
  const desired = feishuSlashesFromCatalog(catalog)
  const long = desired.find(item => item.command === 'long')
  assert.ok(long)
  assert.equal(long.description.length, 100)
})

test('feishu slash plan creates, updates, and removes against the catalog', () => {
  const catalog = buildCatalog([{ name: 'help', description: 'List DSH commands' }], [])
  const desired = feishuSlashesFromCatalog(catalog)
  assert.equal(desired[0].command, 'dsh')
  assert.ok(desired.some(item => item.command === 'help'))
  const plan = planFeishuSlashSync(desired, [
    { command_id: '1', command: 'dsh', description: { default_value: 'old' } },
    { command_id: '2', command: 'gone', description: { default_value: 'x' } },
  ])
  assert.ok(plan.update.some(item => item.id === '1'))
  assert.deepEqual(plan.remove, ['2'])
  assert.ok(plan.create.some(item => item.command === 'help'))
})
