import assert from 'node:assert/strict'
import test from 'node:test'
import { isMessagingWorkspaceCwd, resolveMessagingWorkspaceDir } from '../lib/types/host-cwd.js'

test('uses a directory owned by the DSH home when not configured', () => {
  assert.equal(resolveMessagingWorkspaceDir(undefined, '/tmp/dsh-home'), '/tmp/dsh-home/messaging-gateway')
})

test('uses an explicit absolute Gateway directory', () => {
  assert.equal(resolveMessagingWorkspaceDir('/var/lib/dsh-messaging', '/tmp/dsh-home'), '/var/lib/dsh-messaging')
})

test('rejects a relative Gateway directory', () => {
  assert.throws(() => resolveMessagingWorkspaceDir('messaging-gateway', '/tmp/dsh-home'), /absolute path/)
})

test('never attaches an existing project session to the Gateway workspace', () => {
  assert.equal(isMessagingWorkspaceCwd('/tmp/dsh-home/messaging-gateway', '/tmp/dsh-home/messaging-gateway'), true)
  assert.equal(isMessagingWorkspaceCwd('/workspace/project', '/tmp/dsh-home/messaging-gateway'), false)
})
