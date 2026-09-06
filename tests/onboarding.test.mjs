import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../lib/types/dsh-messaging-gateway.js'
import { parseConfiguredModel } from '../lib/types/config.js'
import { chatId, inboundId, platformId, subjectId, timestamp } from '../lib/types/gateway/index.js'
import { resolvePlatformWorkspaceDir } from '../lib/types/host-cwd.js'
import { loadState } from '../lib/types/persist.js'
import { GatewayRuntime } from '../lib/types/runtime.js'

function response() {
  const state = { status: 0, body: '', headers: {} }
  return {
    state,
    statusCode: 0,
    setHeader(name, value) { state.headers[name] = value },
    end(body = '') {
      state.status = this.statusCode
      state.body = String(body)
    },
  }
}

function fakeHost() {
  const routes = new Map()
  const disposers = []
  let settingsHooks
  const services = {
    commands: { list: () => [], execute: async () => undefined },
    sessions: { list: () => [], get: () => undefined },
    sessionTitle: { rename: () => {} },
    workspaceRegistry: { list: () => [] },
    skills: { list: async () => [] },
    connection: {
      requestRejection: req => req.headers?.cookie === 'dsh-test=authenticated' ? undefined : 401,
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
  }
  const ctx = {
    agents: {
      get: () => undefined,
      create: async () => { throw new Error('plugin apply must not create a session') },
      resume: async () => { throw new Error('plugin apply must not resume a session') },
    },
    get: name => services[name],
    on: () => () => {},
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    inject(dependencies, callback) {
      if (dependencies.every(name => name === 'settings' || services[name] !== undefined)) callback(ctx)
    },
    settings: {
      installSection(_owner, _namespace, _schema, config, hooks) {
        settingsHooks = hooks
        hooks.setSource(() => config)
        return () => {}
      },
    },
  }
  return { ctx, routes, get settingsHooks() { return settingsHooks }, dispose: () => disposers.reverse().forEach(fn => fn()) }
}

function fakeSlackMessage(sequence, text) {
  return {
    kind: 'message',
    actor: { platform: platformId('slack'), subject: subjectId('U-local-owner') },
    identity: { platform: platformId('slack'), kind: 'dm', chatId: chatId('D-fake'), threadId: null },
    addressing: { kind: 'dm' },
    prompt: { text, attachments: [] },
    id: inboundId(`fake-${sequence}`),
    at: timestamp(sequence * 1000),
  }
}

test('authenticated Settings configures a new fake platform while old state remains resumable', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mgw-onboarding-'))
  const previous = {
    home: process.env.DSH_HOME,
    state: process.env.MESSAGING_GATEWAY_STATE,
    slack: process.env.MESSAGING_GATEWAY_DISABLE_SLACK,
    feishu: process.env.MESSAGING_GATEWAY_DISABLE_FEISHU,
  }
  process.env.DSH_HOME = home
  delete process.env.MESSAGING_GATEWAY_STATE
  process.env.MESSAGING_GATEWAY_DISABLE_SLACK = '1'
  process.env.MESSAGING_GATEWAY_DISABLE_FEISHU = '1'
  const config = {
    enabled: true,
    slackBotToken: 'xoxb-test-fixture-not-production',
    slackAppToken: 'xapp-test-fixture-not-production',
    slackOwner: '',
    slackWorkspaceDir: join(home, 'chosen-slack'),
    slackModel: 'fake-provider/fake-model',
  }
  const host = fakeHost()
  try {
    apply(host.ctx, config)
    assert.equal(host.routes.has('/plugins/dsh-messaging-gateway/ingest'), false)

    const list = host.routes.get('/plugins/dsh-messaging-gateway/list')
    const denied = response()
    list.handler({ method: 'GET', headers: { host: '127.0.0.1' } }, denied)
    assert.equal(denied.state.status, 401)

    config.slackOwner = 'U-local-owner'
    host.settingsHooks.onChange()
    const allowed = response()
    list.handler({ method: 'GET', headers: { host: '127.0.0.1', cookie: 'dsh-test=authenticated' } }, allowed)
    assert.equal(allowed.state.status, 200)
    assert.equal(JSON.parse(allowed.state.body).access[0].owner, 'U-local-owner')
    host.dispose()

    const statePath = join(home, 'messaging-gateway', 'state.json')
    const created = []
    const runtime = new GatewayRuntime({
      path: statePath,
      agents: {
        get: () => undefined,
        create: async opts => {
          created.push(opts)
          return { agent: { followup: () => {}, cancel: () => {} }, dispose: () => {} }
        },
        resume: async () => { throw new Error('new user must create first session') },
      },
      cwd: platform => resolvePlatformWorkspaceDir(platform, config.slackWorkspaceDir, config.workspaceDir, home),
      defaultModel: platform => platform === 'slack' ? parseConfiguredModel(config.slackModel) : undefined,
    })
    await runtime.run(fakeSlackMessage(1, 'hello fake platform'))
    assert.equal(created.length, 1)
    assert.equal(created[0].meta.cwd, join(home, 'chosen-slack'))
    assert.deepEqual(created[0].agentOptions, { provider: 'fake-provider', model: 'fake-model' })
    const key = Object.keys(runtime.state.sessions)[0]
    runtime.apply({ kind: 'hostReport', sessionKey: key, report: { kind: 'turnEnded' }, id: inboundId('fake-ended'), at: timestamp(2000) })

    const old = loadState(statePath)
    const oldHostId = old.sessions[key].host.hostSessionId
    assert.equal(old.access.byPlatform.slack.owner, 'U-local-owner')
    assert.equal(readFileSync(statePath, 'utf8').includes('xoxb-test-fixture'), false)

    const resumed = []
    const upgraded = new GatewayRuntime({
      path: statePath,
      agents: {
        get: () => undefined,
        create: async () => { throw new Error('existing session must not be recreated') },
        resume: async opts => {
          resumed.push(opts)
          return { agent: { followup: () => {}, cancel: () => {} }, dispose: () => {} }
        },
      },
      cwd: () => join(home, 'changed-after-upgrade'),
    })
    await upgraded.run(fakeSlackMessage(3, 'resume old session'))
    assert.equal(String(resumed[0].resumeSessionId), String(oldHostId))
    assert.equal('meta' in resumed[0], false)
    assert.equal(loadState(statePath).access.byPlatform.slack.owner, 'U-local-owner')
  } finally {
    host.dispose()
    if (previous.home === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous.home
    if (previous.state === undefined) delete process.env.MESSAGING_GATEWAY_STATE
    else process.env.MESSAGING_GATEWAY_STATE = previous.state
    if (previous.slack === undefined) delete process.env.MESSAGING_GATEWAY_DISABLE_SLACK
    else process.env.MESSAGING_GATEWAY_DISABLE_SLACK = previous.slack
    if (previous.feishu === undefined) delete process.env.MESSAGING_GATEWAY_DISABLE_FEISHU
    else process.env.MESSAGING_GATEWAY_DISABLE_FEISHU = previous.feishu
    rmSync(home, { recursive: true, force: true })
  }
})
