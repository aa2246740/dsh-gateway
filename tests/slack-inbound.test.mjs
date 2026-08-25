import assert from 'node:assert/strict'
import test from 'node:test'
import { inboundFromSlack, labelsFromConversation, peerNameFromSlackUser } from '../lib/types/slack.js'

test('slack /goal becomes a command inbound', () => {
  const inbound = inboundFromSlack({
    user: 'U1',
    channel: 'D1',
    text: '/goal keep going',
    id: '1.0',
  })
  assert.equal(inbound.kind, 'command')
  assert.equal(inbound.line.text, 'goal keep going')
  assert.equal(inbound.identity.kind, 'dm')
})

test('channel mention flag marks group addressing as mentioned', () => {
  const inbound = inboundFromSlack({
    user: 'U1',
    channel: 'C1',
    text: '@DSH ping',
    id: '4.0',
    mentioned: true,
  })
  assert.equal(inbound.kind, 'message')
  assert.equal(inbound.addressing.kind, 'group')
  assert.equal(inbound.addressing.mentioned, true)
})

test('slack IM conversation maps to the other member', () => {
  assert.deepEqual(labelsFromConversation({ is_im: true, user: 'U1' }), { imUser: 'U1' })
  assert.deepEqual(labelsFromConversation({ name: '新频道' }), { chatName: '新频道' })
  assert.equal(peerNameFromSlackUser({ profile: { display_name: 'wu', real_name: 'Wu' }, name: 'wu.bot' }), 'wu')
})

test('slack thread !stop becomes a command on that thread session', () => {
  const inbound = inboundFromSlack({
    user: 'U1',
    channel: 'C1',
    threadTs: '2.0',
    text: '!stop',
    id: '3.0',
  })
  assert.equal(inbound.kind, 'command')
  assert.equal(inbound.identity.kind, 'group')
  assert.equal(inbound.identity.threadId, '2.0')
})
