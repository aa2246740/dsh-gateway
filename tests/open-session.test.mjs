import assert from 'node:assert/strict'
import test from 'node:test'
import { openListedSession, sessionIsListed } from '../lib/types/client/open-session.js'

test('sessionIsListed checks ids and byId', () => {
  assert.equal(sessionIsListed(undefined, 's1'), false)
  assert.equal(sessionIsListed({ ids: ['s1'] }, 's1'), true)
  assert.equal(sessionIsListed({ byId: { s2: { id: 's2' } } }, 's2'), true)
  assert.equal(sessionIsListed({ ids: ['s1'], byId: {} }, 'missing'), false)
})

test('openListedSession opens even when the list snapshot is empty', async () => {
  const opened = []
  const result = await openListedSession({
    open: id => { opened.push(id) },
    list: { getSnapshot: () => ({ ids: [], byId: {} }) },
  }, 'host-1')
  assert.equal(result, 'opened')
  assert.deepEqual(opened, ['host-1'])
})

test('openListedSession refreshes then retries after unknown session', async () => {
  const opened = []
  let calls = 0
  const result = await openListedSession({
    open: id => {
      calls += 1
      if (calls === 1) throw new Error('sessions.select: unknown session host-2')
      opened.push(id)
    },
    refresh: async () => {},
  }, 'host-2')
  assert.equal(result, 'opened')
  assert.deepEqual(opened, ['host-2'])
})

test('openListedSession is missing when every open throws', async () => {
  const result = await openListedSession({
    open: () => { throw new Error('sessions.select: unknown session ghost') },
    refresh: async () => {},
  }, 'ghost')
  assert.equal(result, 'missing')
})
