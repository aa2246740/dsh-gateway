import assert from 'node:assert/strict'
import test from 'node:test'
import { formatModelStatus, parseModelLine, resolveModelPick } from '../lib/types/model-command.js'

test('parseModelLine splits provider/model', () => {
  assert.deepEqual(parseModelLine('pi-openrouter/gpt-5.6'), { provider: 'pi-openrouter', model: 'gpt-5.6' })
  assert.deepEqual(parseModelLine('gpt-5.6'), { model: 'gpt-5.6' })
  assert.equal(parseModelLine(''), undefined)
})

test('formatModelStatus names the default when unset', () => {
  assert.match(formatModelStatus(undefined), /default model/)
  assert.match(formatModelStatus({ provider: 'pi-openrouter', model: 'gpt-5.6' }), /pi-openrouter\/gpt-5.6/)
})

test('resolveModelPick uses an explicit provider/model pair', async () => {
  const llm = {
    resolveCallConfig: async config => config,
    listProviders: () => [],
    listModels: async () => [],
  }
  const resolved = await resolveModelPick(llm, 'pi-openrouter/gpt-5.6', undefined)
  assert.equal(resolved.ok, true)
  if (resolved.ok) {
    assert.equal(resolved.pick.provider, 'pi-openrouter')
    assert.equal(resolved.pick.model, 'gpt-5.6')
  }
})

test('resolveModelPick searches registered providers for a bare model id', async () => {
  const llm = {
    resolveCallConfig: async config => config,
    listProviders: () => [{ provider: 'pi-openrouter' }],
    listModels: async () => [{ id: 'gpt-5.6-sol' }],
  }
  const resolved = await resolveModelPick(llm, 'gpt-5.6-sol', undefined)
  assert.equal(resolved.ok, true)
  if (resolved.ok) {
    assert.equal(resolved.pick.provider, 'pi-openrouter')
    assert.equal(resolved.pick.model, 'gpt-5.6-sol')
  }
})
