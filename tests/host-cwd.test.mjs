import assert from 'node:assert/strict'
import test from 'node:test'
import { pickMessagingCwd } from '../lib/types/host-cwd.js'

test('picks the root workspace, not a nested folder or Host process cwd', () => {
  const cwd = pickMessagingCwd({
    skipIds: new Set(['gw-1']),
    live: [
      { id: 'gw-1', header: { cwd: '/tmp/harness' } },
      { id: 'live-1', header: { cwd: '/Users/wu/Documents/DSH/ox' } },
    ],
    workspaces: [
      { path: '/Users/wu/Documents/DSH/ox' },
      { path: '/Users/wu/Documents/DSH' },
      { path: '/Users/wu/Documents/DSH/test-cdx-withprompt' },
    ],
    fallback: '/tmp/harness',
  })
  assert.equal(cwd, '/Users/wu/Documents/DSH')
})

test('does not use a live harness session when any workspace exists', () => {
  const cwd = pickMessagingCwd({
    skipIds: new Set(),
    live: [{ id: 'a', header: { cwd: '/tmp/harness' } }],
    workspaces: [{ path: '/Users/wu/Documents/DSH' }],
    fallback: '/tmp/harness',
  })
  assert.equal(cwd, '/Users/wu/Documents/DSH')
})

test('falls back to a non-gateway live cwd only when no workspace is registered', () => {
  const cwd = pickMessagingCwd({
    skipIds: new Set(['gw']),
    live: [
      { id: 'gw', header: { cwd: '/tmp/gateway' } },
      { id: 'other', header: { cwd: '/tmp/project' } },
    ],
    workspaces: [],
    fallback: '/tmp/harness',
  })
  assert.equal(cwd, '/tmp/project')
})

test('uses fallback when nothing else is available', () => {
  assert.equal(pickMessagingCwd({
    skipIds: new Set(),
    fallback: '/tmp/harness',
  }), '/tmp/harness')
})
