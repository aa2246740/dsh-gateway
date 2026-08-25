import assert from 'node:assert/strict'
import test from 'node:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { gatewayStatePath } from '../lib/types/persist.js'

test('gatewayStatePath uses DSH_HOME as the .dsh root, not a nested .dsh', () => {
  const prevHome = process.env.DSH_HOME
  const prevState = process.env.MESSAGING_GATEWAY_STATE
  delete process.env.MESSAGING_GATEWAY_STATE
  process.env.DSH_HOME = '/tmp/user-dsh-home'
  try {
    assert.equal(gatewayStatePath(), join('/tmp/user-dsh-home', 'messaging-gateway', 'state.json'))
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    if (prevState === undefined) delete process.env.MESSAGING_GATEWAY_STATE
    else process.env.MESSAGING_GATEWAY_STATE = prevState
  }
})

test('gatewayStatePath falls back to ~/.dsh when DSH_HOME is unset', () => {
  const prevHome = process.env.DSH_HOME
  const prevState = process.env.MESSAGING_GATEWAY_STATE
  delete process.env.MESSAGING_GATEWAY_STATE
  delete process.env.DSH_HOME
  try {
    assert.equal(gatewayStatePath(), join(homedir(), '.dsh', 'messaging-gateway', 'state.json'))
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    if (prevState === undefined) delete process.env.MESSAGING_GATEWAY_STATE
    else process.env.MESSAGING_GATEWAY_STATE = prevState
  }
})
