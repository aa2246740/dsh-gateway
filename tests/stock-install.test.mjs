import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Config as GatewayConfig } from '../lib/types/dsh-messaging-gateway.js'

const require = createRequire(import.meta.url)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8')

test('stock dsh plugin add can boot this package as a bundle', () => {
  assert.equal(pkg.name, 'dsh-messaging-gateway')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(existsSync(join(root, 'cordis.patch.yml')), true)
  assert.equal(pkg.scripts?.prepare, undefined)
  assert.equal(existsSync(join(root, 'lib/dsh-messaging-gateway.js')), true)
  assert.equal(existsSync(join(root, 'lib/client.js')), true)
  for (const entry of ['lib/*.js', 'lib/*.js.map', 'cordis.patch.yml']) {
    assert.equal(pkg.files.includes(entry), true, `files must include ${entry}`)
  }
})

test('README leads with the official stock install and does not default to DSHX', () => {
  const heading = readme.indexOf('# dsh-gateway')
  const command = readme.indexOf('dsh plugin --profile web add github:aa2246740/dsh-gateway')
  const pairing = readme.indexOf('## 中文：自己配对')
  assert.ok(heading >= 0)
  assert.ok(command > heading)
  assert.ok(command < pairing)
  assert.match(readme, /\bpnpm\b/)
  assert.match(readme, /重启这个 Host，刷新页面/)
  assert.doesNotMatch(readme, /\bmy-plugins\b/)
  assert.doesNotMatch(readme, /\bdshx\b/i)
  assert.doesNotMatch(readme, /DSHX_HARNESS/)
})

test('AGENTS.md keeps official dsh as the stock install default', () => {
  const install = agents.indexOf('## Install')
  const pair = agents.indexOf('## Pair')
  const defaultBlock = agents.slice(install, pair)
  assert.match(defaultBlock, /dsh plugin --profile web add github:aa2246740\/dsh-gateway/)
  assert.match(defaultBlock, /\bpnpm\b/)
  assert.match(defaultBlock, /Do not send stock users through DSHX/)
  assert.match(defaultBlock, /0\.1\.7-rc\.2/)
  assert.doesNotMatch(defaultBlock, /0\.1\.7-alpha/)
})

const HARNESS_PEERS = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-settings',
]

test('Harness peers accept 0.1.7-rc.2 and reject 0.1.7 alphas', () => {
  const semver = require('semver')
  const adapter = readFileSync(join(root, 'tools/client-build.js'), 'utf8')
  for (const name of HARNESS_PEERS) {
    const range = pkg.peerDependencies[name]
    assert.equal(range, '>=0.1.7-rc.1 <0.1.8', name)
    assert.equal(pkg.devDependencies[name], range, name)
    assert.equal(semver.satisfies('0.1.7-rc.2', range), true, name)
    assert.equal(semver.satisfies('0.1.7-rc.1', range), true, name)
    assert.equal(semver.satisfies('0.1.5-rc.3', range), false, name)
    assert.equal(semver.satisfies('0.1.5-rc.2', range), false, name)
    assert.equal(semver.satisfies('0.1.7-alpha.1', range), false, name)
    assert.equal(semver.satisfies('0.1.7-alpha.2', range), false, name)
    assert.equal(semver.satisfies('0.1.7-rc.2', '^0.1.5-rc.3'), false)
  }
  assert.equal(semver.satisfies('4.0.4', pkg.peerDependencies['@deepseek-ai/cordis']), true)
  assert.equal(semver.satisfies('4.0.2', pkg.peerDependencies['@deepseek-ai/cordis']), false)
  assert.equal(semver.satisfies('3.18.4', pkg.peerDependencies['@deepseek-ai/schemastery']), true)
  assert.match(readme, /0\.1\.7-rc\.2/)
  assert.match(readme, /@deepseek-ai\/dsh@0\.1\.7-rc\.2/)
  assert.doesNotMatch(readme, /0\.1\.7-alpha/)
  assert.match(adapter, /dsh-v0\.1\.7-rc\.2/)
  assert.equal(adapter.includes('dsh-api-workspace-controller\\/default-workspace'), true)
})

test('profile settings fields are volatile', () => {
  for (const name of [
    'enabled', 'workspaceDir', 'slackWorkspaceDir', 'slackModel', 'slackReasoningEffort',
    'slackBotToken', 'slackAppToken', 'slackOwner', 'feishuWorkspaceDir', 'feishuModel',
    'feishuReasoningEffort', 'feishuAppId', 'feishuAppSecret', 'feishuOwner',
  ]) {
    assert.equal(GatewayConfig.dict[name].meta.volatile, true, name)
  }
  assert.equal(GatewayConfig.dict.slackBotToken.meta.role, 'secret')
  assert.equal(GatewayConfig.dict.slackAppToken.meta.role, 'secret')
  assert.equal(GatewayConfig.dict.feishuAppSecret.meta.role, 'secret')
})
