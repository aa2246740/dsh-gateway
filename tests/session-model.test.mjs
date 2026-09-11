import assert from 'node:assert/strict'
import test from 'node:test'
import { installSessionModel } from '../lib/types/session-model.js'
import { parseConfiguredModel } from '../lib/types/config.js'
import { resolveModelPick } from '../lib/types/model-command.js'

test('next gateway request reads desktop durable selection without a desktop message, including effort', async () => {
  let state = { pending: { provider: 'fixture', model: 'a', reasoningEffort: 'low' }, lastUsed: null }
  const session = {}
  const hooks = new Map()
  const agent = { id: 'fixture' }
  const ctx = {
    get: name => ({ sessions: { get: () => session }, sessionProjections: { stateOf: () => state } })[name],
    on: (name, handler) => { hooks.set(name, handler); return () => {} },
  }
  installSessionModel(ctx, agent)
  const request = async () => {
    await hooks.get('system-prompt/assemble')({}, {}, async () => ({ variables: {} }))
    return hooks.get('agent/request')({}, async () => ({ provider: 'stale', model: 'stale', reasoningEffort: 'medium' }))
  }
  assert.deepEqual(await request(), state.pending)
  state = { ...state, pending: { provider: 'fixture', model: 'b', reasoningEffort: 'high' } }
  assert.deepEqual(await request(), state.pending)
  state = { pending: null, lastUsed: state.pending }
  installSessionModel(ctx, agent) // simulate recreated agent using persisted projection
  assert.deepEqual(await request(), state.lastUsed)
  state = { ...state, pending: { provider: 'fixture', model: 'plain' } }
  assert.deepEqual(await request(), state.pending)
})

test('platform defaults and phone effort command preserve complete selection', async () => {
  const selected = parseConfiguredModel('fixture/model', 'high')
  assert.equal(selected.reasoningEffort, 'high')
  const llm = { resolveCallConfig: async pick => {
    if (pick.reasoningEffort === 'invalid') throw new Error('unsupported effort')
    return pick
  }, listProviders: () => [], listModels: async () => [] }
  assert.deepEqual(await resolveModelPick(llm, 'effort low', selected), { ok: true, pick: { ...selected, reasoningEffort: 'low' } })
  assert.deepEqual(await resolveModelPick(llm, 'fixture/model high', undefined), { ok: true, pick: selected })
  assert.deepEqual(await resolveModelPick(llm, 'effort default', selected), { ok: true, pick: { provider: 'fixture', model: 'model' } })
  assert.equal((await resolveModelPick(llm, 'effort invalid', selected)).ok, false)
})
