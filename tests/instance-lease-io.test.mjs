import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const leaseModule = new URL('../lib/types/instance-lease.js', import.meta.url).href

for (const operation of ['writeFileSync', 'renameSync']) {
  test(`heartbeat survives ${operation} ENOSPC, retains exclusivity and recovers`, () => {
    // Fault the real fs binding in an isolated process. An uncaught timer error
    // exits this process, reproducing the overnight Host crash without filling disk.
    const script = `
      import assert from 'node:assert/strict'
      import fs from 'node:fs'
      import { syncBuiltinESMExports } from 'node:module'
      import { tmpdir } from 'node:os'
      import { join } from 'node:path'
      import { setTimeout as delay } from 'node:timers/promises'
      const root = fs.mkdtempSync(join(tmpdir(), 'gateway-io-proof-'))
      let fault, attempts = 0
      const original = fs[${JSON.stringify(operation)}]
      fs[${JSON.stringify(operation)}] = function(path, ...args) {
        if (fault && String(path).endsWith('.tmp')) {
          attempts++
          throw Object.assign(new Error('injected storage failure'), { code: fault })
        }
        return original.call(this, path, ...args)
      }
      syncBuiltinESMExports()
      const logs = []
      console.error = message => logs.push(message)
      const { acquireGatewayInstanceLease } = await import(${JSON.stringify(leaseModule)})
      let lease
      try {
        const state = join(root, 'state.json')
        const first = acquireGatewayInstanceLease(state, { heartbeatMs: 5 })
        assert.equal(first.acquired, true)
        lease = first.lease
        const ownerPath = join(lease.path, 'owner.json')
        const before = fs.readFileSync(ownerPath, 'utf8')
        fault = 'ENOSPC'
        await delay(60)
        assert.ok(attempts >= 2)
        assert.equal(fs.readFileSync(ownerPath, 'utf8'), before)
        assert.equal(logs.length, 1, 'do not flood logs every heartbeat')
        assert.match(logs[0], /ENOSPC.*keeping ownership/)
        assert.match(logs[0], /Free disk space/)
        const contender = acquireGatewayInstanceLease(state, { staleMs: 1 })
        assert.equal(contender.acquired, false)
        assert.equal(contender.reason, 'active')
        fault = 'EROFS'
        await delay(30)
        assert.equal(logs.length, 2)
        assert.match(logs[1], /EROFS/)
        fault = undefined
        await delay(30)
        assert.notEqual(fs.readFileSync(ownerPath, 'utf8'), before)
        assert.equal(logs.filter(x => x.includes('recovered')).length, 1)
        fault = 'ENOSPC'
        await delay(30)
        assert.equal(logs.filter(x => x.includes('failed (ENOSPC)')).length, 2)
        lease.release()
        assert.equal(fs.existsSync(lease.path), false)
        await delay(15)
        assert.equal(fs.existsSync(lease.path), false)
        process.stdout.write('survived-retained-recovered')
      } finally {
        lease?.release()
        fs.rmSync(root, { recursive: true, force: true })
      }
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    assert.equal(result.stdout, 'survived-retained-recovered')
  })
}
