import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  acquireGatewayInstanceLease,
  gatewayInstanceLeasePath,
} from '../lib/types/instance-lease.js'

test('only one Gateway instance owns a shared state path', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-gateway-lease-'))
  const state = join(root, 'state.json')
  try {
    const first = acquireGatewayInstanceLease(state)
    assert.equal(first.acquired, true)
    const second = acquireGatewayInstanceLease(state)
    assert.equal(second.acquired, false)
    if (!second.acquired) {
      assert.equal(second.reason, 'active')
      assert.equal(second.ownerPid, process.pid)
    }
    if (first.acquired) first.lease.release()
    const third = acquireGatewayInstanceLease(state)
    assert.equal(third.acquired, true)
    if (third.acquired) third.lease.release()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a dead owner lease is reclaimed without deleting live ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-gateway-lease-'))
  const state = join(root, 'state.json')
  const lock = gatewayInstanceLeasePath(state)
  try {
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'owner.json'), `${JSON.stringify({
      version: 1,
      token: 'stale-owner',
      pid: 999_999,
      createdAt: '2026-01-01T00:00:00.000Z',
      heartbeatAt: '2026-01-01T00:00:00.000Z',
    })}\n`)
    const acquired = acquireGatewayInstanceLease(state, { probePid: () => 'dead' })
    assert.equal(acquired.acquired, true)
    if (acquired.acquired) acquired.lease.release()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an inaccessible owner fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-gateway-lease-'))
  const state = join(root, 'state.json')
  try {
    const first = acquireGatewayInstanceLease(state)
    assert.equal(first.acquired, true)
    const blocked = acquireGatewayInstanceLease(state, { probePid: () => 'unknown' })
    assert.equal(blocked.acquired, false)
    if (!blocked.acquired) assert.equal(blocked.reason, 'inaccessible')
    if (first.acquired) first.lease.release()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
