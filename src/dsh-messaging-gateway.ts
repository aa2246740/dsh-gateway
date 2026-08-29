import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { SETTINGS_NAMESPACE, type Config as GatewayConfig } from './config.ts'
import { isMainConversation, platformId, subjectId } from './gateway/index.ts'
import { mergeUserSkills, skillListViews, slashesFromCatalog } from './host-catalog.ts'
import { formatModelStatus, resolveModelPick, type LlmFace } from './model-command.ts'
import { captureAgents, captureCommands, GatewayRuntime } from './runtime.ts'
import { inboundFromFeishu, runFeishu, syncFeishuCatalog } from './feishu.ts'
import { pickMessagingCwd } from './host-cwd.ts'
import { inboundFromSlack, runSlack } from './slack.ts'
import { slackManifest } from './slack-manifest.ts'

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

function gatewayHostIds(runtime: GatewayRuntime): Set<string> {
  const ids = new Set<string>()
  for (const session of Object.values(runtime.state.sessions)) {
    if (session.host.kind === 'bound') ids.add(String(session.host.hostSessionId))
  }
  return ids
}

function liveCwd(ctx: Context, skip: Set<string>): string {
  const sessions = ctx.get('sessions') as SessionStore | undefined
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined
  return pickMessagingCwd({
    skipIds: skip,
    live: sessions?.list?.() ?? [],
    workspaces: registry?.list?.() ?? [],
    fallback: process.cwd(),
  })
}

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

function attachWorkspace(ctx: Context, id: string, cwd: string): void {
  const registry = ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined
  if (!registry) return
  void (async () => {
    try {
      let workspace = registry.resolveByPath
        ? await registry.resolveByPath(cwd)
        : registry.list?.().find(item => item.path === cwd)
      if (!workspace && registry.create) workspace = await registry.create(cwd, 'Messaging')
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

function placeBoundSessions(ctx: Context, runtime: GatewayRuntime, after?: () => Promise<void>): void {
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
      if (path) attachWorkspace(ctx, id, path)
    }
    if (after) await after()
  })()
}

export const name = 'dsh-messaging-gateway'
export const inject = ['agents', 'commands']

export const Config: z<GatewayConfig> = z.object({
  enabled: z.boolean().default(true),
  slackBotToken: z.string().role('secret').default(''),
  slackAppToken: z.string().role('secret').default(''),
  slackOwner: z.string().default(''),
  feishuAppId: z.string().default(''),
  feishuAppSecret: z.string().role('secret').default(''),
  feishuOwner: z.string().default(''),
})

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body, null, 2))
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => { chunks.push(chunk as Buffer) })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw) as unknown)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function html(res: ServerResponse, body: string): void {
  res.statusCode = 200
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(body)
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

export function apply(ctx: Context, config: GatewayConfig) {
  console.log('[my-plugins/dsh-messaging-gateway] loaded')
  const getLlm = (): LlmFace | undefined => ctx.get('llm') as LlmFace | undefined
  let runtime!: GatewayRuntime

  const registerModel = (commandHost: CommandHost) => commandHost.register({
    name: 'model',
    description: 'Show or switch this session model',
    input: { hint: '[provider/model]', images: false },
    handler: async invocation => {
      const key = String(invocation.agent.id)
      const llm = getLlm()
      if (llm === undefined) {
        return { kind: 'error', text: 'Model switching is unavailable on this Host.' }
      }
      const current = runtime.modelPicks.get(key)
      if (invocation.rawInput.trim().length === 0) {
        return { kind: 'success', text: formatModelStatus(current) }
      }
      const resolved = await resolveModelPick(llm, invocation.rawInput, current)
      if (!resolved.ok) return { kind: 'error', text: resolved.text }
      runtime.modelPicks.set(key, resolved.pick)
      return { kind: 'success', text: `This Slack session now uses ${resolved.pick.provider}/${resolved.pick.model}. Later turns follow this pick.` }
    },
  })

  const setupAgent = (agentCtx: Context): void => {
    const commandHost = agentCtx.get('commands') as CommandHost | undefined
    if (!commandHost) return
    agentCtx.effect(() => registerModel(commandHost), 'dsh-messaging-gateway: /model')
  }

  const agents = captureAgents(ctx)
  runtime = new GatewayRuntime({
    agents,
    getCommands: () => captureCommands(ctx),
    setupAgent,
    defaultModel: () => {
      const svc = ctx.get('agentDefaultModel') as { currentSelection?: () => { provider: string; model: string } } | undefined
      return svc?.currentSelection?.()
    },
    cwd: (): string => liveCwd(ctx, gatewayHostIds(runtime)),
    onHostSession: ({ id, title, cwd, created, recents }) => {
      pinSessionTitle(ctx, id, title)
      if (!created) return
      if (recents) attachWorkspace(ctx, id, cwd)
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
  placeBoundSessions(ctx, runtime, pullSkills)
  ctx.inject(['sessions', 'sessionTitle', 'workspaceRegistry'], () => {
    placeBoundSessions(ctx, runtime, pullSkills)
  })
  void pullSkills()
  ctx.inject(['skills'], skillCtx => {
    void pullSkills()
    const events = skillCtx as Context & { on(event: 'skills/change', listener: () => void): () => void }
    skillCtx.effect(() => events.on('skills/change', () => { void pullSkills() }), 'dsh-messaging-gateway: skills')
  })

  ctx.effect(() => ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const pick = runtime.modelPicks.get(String(payload.agent.id))
    if (pick === undefined) return resolved
    return {
      ...resolved,
      provider: pick.provider,
      model: pick.model,
    }
  }), 'dsh-messaging-gateway: session model')

  let source = () => config
  let stopSlack: (() => Promise<void>) | undefined
  let stopFeishu: (() => Promise<void>) | undefined

  const bindOwner = (platform: string, owner: string) => {
    if (!owner) return
    const id = platformId(platform)
    const bound = runtime.state.access.byPlatform[id]
    if (!bound || bound.kind !== 'bound' || bound.owner !== subjectId(owner)) {
      runtime.apply({
        kind: 'bind',
        platform: id,
        owner: subjectId(owner),
        id: runtime.nextId(),
        at: runtime.now(),
      })
    }
  }

  const syncSlack = () => {
    const current = source()
    bindOwner('slack', current.slackOwner ?? '')
    const bot = current.slackBotToken ?? ''
    const app = current.slackAppToken ?? ''
    void (async () => {
      if (stopSlack) {
        await stopSlack()
        stopSlack = undefined
      }
      if (current.enabled !== false && bot && app && process.env.MESSAGING_GATEWAY_DISABLE_SLACK !== '1') {
        stopSlack = await runSlack(runtime, { bot, app })
      }
    })().catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dsh-messaging-gateway] slack sync failed', message)
    })
  }

  const syncFeishu = () => {
    const current = source()
    bindOwner('feishu', current.feishuOwner ?? '')
    const appId = current.feishuAppId ?? ''
    const appSecret = current.feishuAppSecret ?? ''
    void (async () => {
      if (stopFeishu) {
        await stopFeishu()
        stopFeishu = undefined
      }
      if (current.enabled !== false && appId && appSecret && process.env.MESSAGING_GATEWAY_DISABLE_FEISHU !== '1') {
        stopFeishu = await runFeishu(runtime, { appId, appSecret })
      }
    })().catch(error => {
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

  installSettingsSection(ctx, settingsNamespace(SETTINGS_NAMESPACE), Config, config, {
    setSource: current => { source = current },
    onChange: () => {
      syncSlack()
      syncFeishu()
    },
  })

  type WebServer = {
    register: (route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => () => void
  }
  ctx.inject(['webServer'], httpCtx => {
    const webServer = httpCtx.get('webServer') as WebServer | undefined
    if (!webServer) return
    httpCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-messaging-gateway/list',
      handler: (_req, res) => json(res, 200, runtime.list()),
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
      handler: (_req, res) => json(res, 200, runtime.outbox),
    }), 'dsh-messaging-gateway: outbox')
    httpCtx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-messaging-gateway/ingest',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'POST only' })
          return
        }
        void readJson(req).then(async raw => {
          const body = raw && typeof raw === 'object' ? raw as {
            platform?: string
            user?: string
            channel?: string
            text?: string
            mentioned?: boolean
            chatType?: string
          } : {}
          if (!body.user || !body.channel || !body.text) {
            json(res, 400, { error: 'user, channel, and text are required' })
            return
          }
          const inbound = body.platform === 'feishu'
            ? inboundFromFeishu({
              user: body.user,
              chatId: body.channel,
              ...(body.chatType ? { chatType: body.chatType } : {}),
              text: body.text,
              id: `ingest-${Date.now()}`,
              ...(body.mentioned === true ? { mentioned: true } : {}),
              commands: runtime.state.catalog.commands.map(spec => spec.name),
            })
            : inboundFromSlack({
              user: body.user,
              channel: body.channel,
              text: body.text,
              id: `ingest-${Date.now()}`,
              ...(body.mentioned === true ? { mentioned: true } : {}),
            })
          const result = await runtime.run(inbound)
          json(res, 200, { hostCalls: result.hostCalls.length, deliveries: result.deliveries, list: runtime.list() })
        }).catch(error => {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) })
        })
      },
    }), 'dsh-messaging-gateway: ingest')
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
      void stopSlack?.()
      void stopFeishu?.()
    }
  }, 'dsh-messaging-gateway: platforms')
}
