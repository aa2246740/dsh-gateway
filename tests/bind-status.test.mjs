import assert from 'node:assert/strict'
import test from 'node:test'
import { bindLabel, platformBind, saveActionLabel } from '../lib/types/client/bind-status.js'

test('settings owner counts as bound', () => {
  const slack = platformBind({ platform: 'slack', settingsOwner: 'U1' })
  assert.equal(slack.bound, true)
  assert.equal(slack.owner, 'U1')
  assert.equal(bindLabel('Slack', slack.bound, slack.owner), 'Slack 已绑定 U1')
})

test('live access wins over empty settings owner', () => {
  const feishu = platformBind({
    platform: 'feishu',
    settingsOwner: '',
    access: [{ platform: 'feishu', bound: true, owner: 'ou_testowner0000000000000000000000' }],
  })
  assert.equal(feishu.bound, true)
  assert.equal(bindLabel('飞书', feishu.bound, feishu.owner), '飞书 已绑定')
})

test('a live conversation still counts when access is missing from an old Host', () => {
  const feishu = platformBind({
    platform: 'feishu',
    groups: [{ platform: 'feishu', rows: [{ title: 'Feishu DM' }] }],
  })
  assert.equal(feishu.bound, true)
  assert.equal(bindLabel('飞书', feishu.bound, feishu.owner), '飞书 已绑定')
})

test('unbound stays unbound', () => {
  const slack = platformBind({ platform: 'slack' })
  assert.equal(slack.bound, false)
  assert.equal(bindLabel('Slack', slack.bound, slack.owner), 'Slack 未绑定')
})

test('connected platforms do not still say 保存并连接', () => {
  assert.equal(saveActionLabel({ bound: false, dirty: false, writing: false }), '保存并连接')
  assert.equal(saveActionLabel({ bound: true, dirty: false, writing: false }), '已连接')
  assert.equal(saveActionLabel({ bound: true, dirty: true, writing: false }), '保存')
  assert.equal(saveActionLabel({ bound: true, dirty: false, writing: true }), '正在保存…')
})
