import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyState } from '../lib/types/gateway/index.js'
import { gatewayStatePath, loadState, saveState } from '../lib/types/persist.js'

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

test('only a missing state initializes; malformed or incompatible state fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mgw-persist-'))
  const path = join(dir, 'state.json')
  try {
    assert.equal(loadState(path).version, 1)
    writeFileSync(path, '{broken', 'utf8')
    assert.throws(() => loadState(path), /JSON/)
    writeFileSync(path, JSON.stringify({ version: 1 }), 'utf8')
    assert.throws(() => loadState(path), /Invalid messaging Gateway state/)
    writeFileSync(path, JSON.stringify({ ...emptyState(), version: 2 }), 'utf8')
    assert.throws(() => loadState(path), /Invalid messaging Gateway state/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('state replacement is atomic and leaves no temporary file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mgw-persist-'))
  const path = join(dir, 'state.json')
  try {
    saveState(path, emptyState())
    assert.equal(existsSync(path), true)
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), emptyState())
    assert.deepEqual(readdirSync(dir), ['state.json'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
