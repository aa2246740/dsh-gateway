import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync, realpathSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import z from '@deepseek-ai/schemastery'
import { parseConfiguredModel, SETTINGS_NAMESPACE, type Config as GatewayConfig } from './config.ts'
import { isMainConversation, platformId, subjectId } from './gateway/index.ts'
import { mergeUserSkills, skillListViews, slashesFromCatalog } from './host-catalog.ts'
import { formatModelStatus, resolveModelPick, type LlmFace } from './model-command.ts'
import { captureAgents, captureCommands, GatewayRuntime } from './runtime.ts'
import { runFeishu, syncFeishuCatalog } from './feishu.ts'
import { isMessagingWorkspaceCwd, resolvePlatformWorkspaceDir } from './host-cwd.ts'
import { runSlack } from './slack.ts'
import { slackManifest } from './slack-manifest.ts'
import { acquireGatewayInstanceLease } from './instance-lease.ts'
import { currentSessionModel, installSessionModel } from './session-model.ts'

type LiveSession = { id?: unknown; header?: { cwd?: string } }
type SessionStore = { list?: () => LiveSession[]; get?: (id: ReturnType<typeof SessionId>) => unknown }
type TitleStore = { rename?: (session: unknown, title: string) => void }
type WorkspaceFace = {
  path: string
  attachSession?: (id: ReturnType<typeof SessionId>) => Promise<void>
}
type WorkspaceRegistry = {
  list?: () => WorkspaceFace[]
  resolveByPath?: (path: string) => Promise<WorkspaceFace | undefined>
  create?: (path: string, title?: string) => Promise<WorkspaceFace>
  archiveSession?: (id: ReturnType<typeof SessionId>) => Promise<void>
}

type CommandHost = {
  register: (definition: {
    name: string
    description: string
    input?: { hint: string; images: boolean }
    handler: (invocation: { agent: { id: unknown }; rawInput: string }) => Promise<{ kind: 'success' | 'error'; text: string }>
  }) => () => void
}
type HostConnectionAuth = Pick<HostConnectionHandle, 'requestRejection'>

function pinSessionTitle(ctx: Context, id: string, title: string): void {
  if (title.trim().length === 0) return
  try {
    const sessions = ctx.get('sessions') as SessionStore | undefined
    const titles = ctx.get('sessionTitle') as TitleStore | undefined
    const session = sessions?.get?.(SessionId(id))
    if (!session || !titles?.rename) {
      if (!session) console.error('[dsh-messaging-gateway] session title skipped, not live', id)
      return
    }
    titles.rename(session, title)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[dsh-messaging-gateway] session title failed', message)
  }
}

function archiveHostSession(ctx: Context, id: string): void {
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined
  if (!registry?.archiveSession) return
  void registry.archiveSession(SessionId(id)).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[dsh-messaging-gateway] session archive failed', message)
  })
}

function attachWorkspace(ctx: Context, id: string, cwd: string, workspaceDir: string, platform: string): void {
  if (!isMessagingWorkspaceCwd(cwd, workspaceDir)) return
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined
  if (!registry) return
  void (async () => {
    try {
      let workspace = registry.resolveByPath
        ? await registry.resolveByPath(workspaceDir)
        : registry.list?.().find(item => item.path === workspaceDir)
      if (!workspace && registry.create) workspace = await registry.create(workspaceDir, `Messaging · ${platform}`)
      await workspace?.attachSession?.(SessionId(id))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dsh-messaging-gateway] workspace attach failed', message)
    }
  })()
}

function boundHostIds(runtime: GatewayRuntime): string[] {
  const ids: string[] = []
  for (const session of Object.values(runtime.state.sessions)) {
    if (session.host.kind === 'bound') ids.push(String(session.host.hostSessionId))
  }
  return ids
}

function placeBoundSessions(
  ctx: Context,
  runtime: GatewayRuntime,
  workspaceDirFor: (platform: string) => string,
  after?: () => Promise<void>,
): void {
  const sessions = ctx.get('sessions') as SessionStore | undefined
  void (async () => {
    for (const row of Object.values(runtime.state.sessions)) {
      if (row.host.kind !== 'bound') continue
      const id = String(row.host.hostSessionId)
      let resumed = false
      try {
        const setup = runtime.setupForAgent(id)
        await ctx.agents.resume({
          resumeSessionId: SessionId(id),
          ...(setup ? { setup } : {}),
        })
        resumed = true
      } catch {
        /* already live or the log is gone */
      }
      if (!resumed) runtime.ensureAgentSetup(id)
      pinSessionTitle(ctx, id, row.title)
      if (!isMainConversation(row.identity)) {
        archiveHostSession(ctx, id)
        continue
      }
      const live = sessions?.get?.(SessionId(id)) as LiveSession | undefined
      const listed = sessions?.list?.().find(item => String(item.id) === id)
      const path = listed?.header?.cwd ?? live?.header?.cwd
      if (path) attachWorkspace(ctx, id, path, workspaceDirFor(row.identity.platform), row.identity.platform)
    }
    if (after) await after()
  })()
}

export const name = 'dsh-messaging-gateway'
export const inject = ['agents', 'commands', 'sessionController']

export const Config: z<GatewayConfig> = z.object({
  enabled: z.boolean().default(true),
  workspaceDir: z.string().default(''),
  slackWorkspaceDir: z.string().default(''),
  slackModel: z.string().default(''),
  slackReasoningEffort: z.string().default(''),
  slackBotToken: z.string().role('secret').default(''),
  slackAppToken: z.string().role('secret').default(''),
  slackOwner: z.string().default(''),
  feishuWorkspaceDir: z.string().default(''),
  feishuModel: z.string().default(''),
  feishuReasoningEffort: z.string().default(''),
  feishuAppId: z.string().default(''),
  feishuAppSecret: z.string().role('secret').default(''),
  feishuOwner: z.string().default(''),
})

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body, null, 2))
}

function html(res: ServerResponse, body: string): void {
  res.statusCode = 200
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(body)
}

function authorizeHost(req: IncomingMessage, res: ServerResponse, connection: HostConnectionAuth | undefined): boolean {
  if (!connection) {
    json(res, 503, { error: 'Host authentication unavailable' })
    return false
  }
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return true
  json(res, rejection, { error: rejection === 401 ? 'unauthorized' : 'forbidden' })
  return false
}

function setupPage(catalogSlashes?: ReturnType<typeof slashesFromCatalog>): string {
  const manifest = JSON.stringify(slackManifest(catalogSlashes), null, 2)
  return `<!doctype html>
<meta charset="utf-8">
<title>绑定 DSH 到你的 Slack</title>
<body style="font:16px/1.5 system-ui;max-width:720px;margin:40px auto;padding:0 16px">
<h1>绑定你的 Slack</h1>
<p>没有官方共用 bot。Slack 和飞书都在你的浏览器里绑定，token 只存你这台 DSH。飞书输入 <code>/</code> 弹出的指令来自同一份 DSH 命令目录。</p>
<ol>
<li><a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer">打开 Slack 创建应用（From an app manifest）</a>，登录你自己的 workspace，把下面清单整段贴进去，Create，然后 Install to workspace。</li>
<li>回到 <strong>DSH Web → 设置 → 消息</strong>，填 Bot Token（xoxb-）、App Token（xapp-，Socket Mode / connections:write）、你的 member id（头像 → Copy member ID）。点保存并连接。</li>
</ol>
<p><button type="button" id="copy">复制 Manifest</button> <a href="/plugins/dsh-messaging-gateway/slack-manifest">JSON</a></p>
<pre id="manifest" style="white-space:pre-wrap;background:#111;color:#eee;padding:12px;border-radius:8px">${manifest.replace(/</g, '&lt;')}</pre>
<script>
document.getElementById('copy').onclick = () => {
  navigator.clipboard.writeText(document.getElementById('manifest').innerText)
  document.getElementById('copy').textContent = '已复制'
}
</script>
</body>`
}

/** This is called only from the Host's authenticated Settings lifecycle. Network adapters never bind owners. */
export function confirmOwnerFromSettings(runtime: GatewayRuntime, platform: string, owner: string): void {
  const selected = owner.trim()
  if (!selected) return
  const id = platformId(platform)
  const bound = runtime.state.access.byPlatform[id]
  if (bound?.kind === 'bound' && bound.owner === subjectId(selected)) return
  runtime.apply({
    kind: 'bind',
    platform: id,
    owner: subjectId(selected),
    id: runtime.nextId(),
    at: runtime.now(),
  })
}

export function apply(ctx: Context, config: GatewayConfig) {
  const workspaceDirs = new Map<string, string>()
  const workspaceDirFor = (platform: string): string => {
    const cached = workspaceDirs.get(platform)
    if (cached) return cached
    const current = source()
    const configured = resolvePlatformWorkspaceDir(
      platform,
      platform === 'slack' ? current.slackWorkspaceDir : current.feishuWorkspaceDir,
      current.workspaceDir,
    )
    mkdirSync(configured, { recursive: true, mode: 0o700 })
    const directory = realpathSync(configured)
    workspaceDirs.set(platform, directory)
    return directory
  }
  let source = () => config
  let instance: ReturnType<typeof acquireGatewayInstanceLease>
  try {
    instance = acquireGatewayInstanceLease()
  } catch {
    console.error('[dsh-messaging-gateway] inactive: single-Host lease is unavailable')
    return
  }
  if (!instance.acquired) {
    const owner = instance.ownerPid === undefined ? '' : ` pid ${instance.ownerPid}`
    console.error(`[dsh-messaging-gateway] inactive: another Host${owner} owns this DSH_HOME gateway (${instance.reason})`)
    return
  }
  ctx.effect(() => instance.lease.release, 'dsh-messaging-gateway: single Host lease')
  console.log('[my-plugins/dsh-messaging-gateway] loaded')
  const getLlm = (): LlmFace | undefined => ctx.get('llm') as LlmFace | undefined
  let runtime!: GatewayRuntime

  const registerModel = (commandHost: CommandHost) => commandHost.register({
    name: 'model',
    description: 'Show or switch this session model',
    input: { hint: '[provider/model [effort] | effort <level>]', images: false },
    handler: async invocation => {
      const key = String(invocation.agent.id)
      const llm = getLlm()
      if (llm === undefined) {
        return { kind: 'error', text: 'Model switching is unavailable on this Host.' }
      }
      const current = currentSessionModel(ctx, key) ?? ctx.get('agentDefaultModel')?.currentSelection()
      if (invocation.rawInput.trim().length === 0) {
        return { kind: 'success', text: formatModelStatus(current) }
      }
      const resolved = await resolveModelPick(llm, invocation.rawInput, current)
      if (!resolved.ok) return { kind: 'error', text: resolved.text }
      try {
        const result = await ctx.sessionController.selectModel({ sessionId: SessionId(key), ...resolved.pick })
        return { kind: 'success', text: `${formatModelStatus(result.selected)}\nSaved. The next message uses this selection; no desktop message is needed.` }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  const setupAgent = (agentCtx: Context): void => {
    installSessionModel(agentCtx)
    const commandHost = agentCtx.get('commands') as CommandHost | undefined
    if (!commandHost) return
    agentCtx.effect(() => registerModel(commandHost), 'dsh-messaging-gateway: /model')
  }

  const agents = captureAgents(ctx)
  runtime = new GatewayRuntime({
    agents,
    getCommands: () => captureCommands(ctx),
    setupAgent,
    selectModel: async (id, pick) => {
      await ctx.sessionController.selectModel({ sessionId: SessionId(id), ...pick })
    },
    defaultModel: platform => {
      const configured = parseConfiguredModel(platform === 'slack' ? source().slackModel : platform === 'feishu' ? source().feishuModel : '',
        platform === 'slack' ? source().slackReasoningEffort : source().feishuReasoningEffort)
      if (configured) return configured
      const svc = ctx.get('agentDefaultModel') as { currentSelection?: () => { provider: string; model: string } } | undefined
      return svc?.currentSelection?.()
    },
    cwd: platform => workspaceDirFor(platform),
    onHostSession: ({ id, title, cwd, platform, created, recents }) => {
      pinSessionTitle(ctx, id, title)
      if (!created) return
      if (recents) attachWorkspace(ctx, id, cwd, workspaceDirFor(platform), platform)
      else archiveHostSession(ctx, id)
    },
    onArchiveSession: id => { archiveHostSession(ctx, id) },
  })

  runtime.replaceCatalog([])

  const pullSkills = async () => {
    const skills = ctx.get('skills') as {
      list?: (options?: { scope?: unknown; cwd?: string }) => Promise<{
        name: string
        description: string
        invocation?: { userInvocable?: boolean }
      }[]>
    } | undefined
    if (!skills?.list) return
    const batches: { name: string; description: string; invocation?: { userInvocable?: boolean } }[][] = []
    for (const view of skillListViews(boundHostIds(runtime))) {
      try {
        batches.push(await skills.list(view))
      } catch {
        /* one SkillHub view failing must not wipe the rest */
      }
    }
    runtime.setSkills(mergeUserSkills(batches))
  }
  placeBoundSessions(ctx, runtime, workspaceDirFor, pullSkills)
  ctx.inject(['sessions', 'sessionTitle', 'workspaceRegistry'], () => {
    placeBoundSessions(ctx, runtime, workspaceDirFor, pullSkills)
  })
  void pullSkills()
  ctx.inject(['skills'], skillCtx => {
    void pullSkills()
    const events = skillCtx as Context & { on(event: 'skills/change', listener: () => void): () => void }
    skillCtx.effect(() => events.on('skills/change', () => { void pullSkills() }), 'dsh-messaging-gateway: skills')
  })

  let stopSlack: (() => Promise<void>) | undefined
  let stopFeishu: (() => Promise<void>) | undefined
  let slackSignature: string | undefined
  let feishuSignature: string | undefined
  let slackTail = Promise.resolve()
  let feishuTail = Promise.resolve()
  let shuttingDown = false

  const bindOwner = (platform: string, owner: string) => {
    confirmOwnerFromSettings(runtime, platform, owner)
  }

  const syncSlack = () => {
    const current = source()
    bindOwner('slack', current.slackOwner ?? '')
    const bot = current.slackBotToken ?? ''
    const app = current.slackAppToken ?? ''
    const signature = JSON.stringify([current.enabled !== false, bot, app])
    if (signature === slackSignature) return
    slackSignature = signature
    const replace = async () => {
      if (stopSlack) {
        await stopSlack()
        stopSlack = undefined
      }
      if (!shuttingDown && current.enabled !== false && bot && app && process.env.MESSAGING_GATEWAY_DISABLE_SLACK !== '1') {
        stopSlack = await runSlack(runtime, { bot, app })
      }
    }
    slackTail = slackTail.then(replace, replace).catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dsh-messaging-gateway] slack sync failed', message)
    })
  }

  const syncFeishu = () => {
    const current = source()
    bindOwner('feishu', current.feishuOwner ?? '')
    const appId = current.feishuAppId ?? ''
    const appSecret = current.feishuAppSecret ?? ''
    const signature = JSON.stringify([current.enabled !== false, appId, appSecret])
    if (signature === feishuSignature) return
    feishuSignature = signature
    const replace = async () => {
      if (stopFeishu) {
        await stopFeishu()
        stopFeishu = undefined
      }
      if (!shuttingDown && current.enabled !== false && appId && appSecret && process.env.MESSAGING_GATEWAY_DISABLE_FEISHU !== '1') {
        stopFeishu = await runFeishu(runtime, { appId, appSecret })
      }
    }
    feishuTail = feishuTail.then(replace, replace).catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dsh-messaging-gateway] feishu sync failed', message)
    })
  }

  let feishuSlashTail = Promise.resolve()
  runtime.watchDeliveries(deliveries => {
    if (!deliveries.some(item => item.kind === 'catalogUpdated')) return
    const current = source()
    const appId = current.feishuAppId ?? ''
    const appSecret = current.feishuAppSecret ?? ''
    if (!appId || !appSecret || process.env.MESSAGING_GATEWAY_DISABLE_FEISHU === '1') return
    feishuSlashTail = feishuSlashTail.then(
      () => syncFeishuCatalog(runtime, { appId, appSecret }),
      () => syncFeishuCatalog(runtime, { appId, appSecret }),
    ).catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dsh-messaging-gateway] feishu slash resync failed', message)
    })
  })

  bindOwner('slack', config.slackOwner ?? '')
  bindOwner('feishu', config.feishuOwner ?? '')

  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config, {
      setSource: current => { source = current },
      onChange: () => {
        workspaceDirs.clear()
        syncSlack()
        syncFeishu()
      },
    })
  })

  type WebServer = {
    register: (route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => () => void
  }
  ctx.inject(['webServer', 'connection'], httpCtx => {
    const webServer = httpCtx.get('webServer') as WebServer | undefined
    const connection = httpCtx.get('connection') as HostConnectionAuth | undefined
    if (!webServer) return
    httpCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-messaging-gateway/list',
      handler: (req, res) => {
        if (!authorizeHost(req, res, connection)) return
        if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
        const sessions = ctx.get('sessions') as SessionStore | undefined
        const rows = runtime.list()
        json(res, 200, {
          ...rows,
          platforms: Object.fromEntries(['slack', 'feishu'].map(platform => {
            const configured = parseConfiguredModel(platform === 'slack' ? source().slackModel : source().feishuModel)
            const fallback = (ctx.get('agentDefaultModel') as { currentSelection?: () => { provider: string; model: string } } | undefined)
              ?.currentSelection?.()
            const model = configured ?? fallback
            return [platform, {
              workspaceDir: workspaceDirFor(platform),
              ...(model ? { model: `${model.provider}/${model.model}` } : {}),
            }]
          })),
          groups: rows.groups.map(group => ({
            ...group,
            rows: group.rows.map(row => {
              if (!row.hostSessionId) return row
              const live = sessions?.get?.(SessionId(String(row.hostSessionId))) as LiveSession | undefined
              const listed = sessions?.list?.().find(item => String(item.id) === String(row.hostSessionId))
              const cwd = listed?.header?.cwd ?? live?.header?.cwd
              return cwd ? { ...row, cwd } : row
            }),
          })),
        })
      },
    }), 'dsh-messaging-gateway: list')
    httpCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-messaging-gateway/slack-manifest',
      handler: (_req, res) => json(res, 200, slackManifest(slashesFromCatalog(runtime.state.catalog))),
    }), 'dsh-messaging-gateway: slack-manifest')
    httpCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-messaging-gateway/setup',
      handler: (_req, res) => html(res, setupPage(slashesFromCatalog(runtime.state.catalog))),
    }), 'dsh-messaging-gateway: setup')
    httpCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-messaging-gateway/outbox',
      handler: (req, res) => {
        if (!authorizeHost(req, res, connection)) return
        if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
        json(res, 200, runtime.outbox)
      },
    }), 'dsh-messaging-gateway: outbox')
    console.log('[my-plugins/dsh-messaging-gateway] http /plugins/dsh-messaging-gateway/list')
  })

  ctx.effect(() => {
    const offStatus = ctx.on('agent/status', ({ agent, status }) => {
      runtime.noteAgentStatus(String(agent.id), status)
    })
    const offEvent = ctx.on('session/event', (session, event) => {
      runtime.noteSessionEvent(String(session.id), event)
    })
    return () => {
      offStatus()
      offEvent()
    }
  }, 'dsh-messaging-gateway: host bridge')

  ctx.effect(() => {
    syncSlack()
    syncFeishu()
    return () => {
      shuttingDown = true
      void slackTail.then(async () => { await stopSlack?.(); stopSlack = undefined })
      void feishuTail.then(async () => { await stopFeishu?.(); stopFeishu = undefined })
    }
  }, 'dsh-messaging-gateway: platforms')
}
