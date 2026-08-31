import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import {
  handle,
  hostSessionId,
  inboundId,
  isMainConversation,
  list,
  looksLikePromptTitle,
  matchCommand,
  recoverTurns,
  sessionKey,
  timestamp,
  approvalId,
  type ApprovalAnswer,
  type Delivery,
  type GatewayState,
  type HandleResult,
  type HostCall,
  type Inbound,
  type MessagingSession,
  type SessionKey,
} from './gateway/index.ts'
import { buildCatalog, formatHelp } from './host-catalog.ts'
import { gatewayStatePath, loadState, saveState } from './persist.ts'
import type { ModelPick } from './model-command.ts'
import {
  installFeishuApprovalHold,
  installFeishuSpeakingContract,
  outcomeFromAnswer,
  type ApprovalHoldOutcome,
  type ApprovalHoldRequest,
} from './feishu-voice.ts'

export type AgentFace = {
  followup: (message: ReturnType<typeof createUserMessage>) => void
  cancel: (cause: { kind: 'user' }) => void
  ctx?: Context
  options?: { provider?: string; model?: string }
}

export type AgentOptionsFace = {
  provider?: string
  model?: string
}

/**
 * Compose one messaging-owned Agent scope before it is published.
 *
 * The callback is deliberately scoped to the Agent factory's setup hook. A
 * messaging command must not be registered on the Host-wide command layer:
 * doing so makes it collide with a same-named command supplied by the core
 * product (for example, the built-in `/model`).
 */
export type AgentSetup = (agentCtx: Context) => void

export type HostAgents = {
  get: (id: ReturnType<typeof SessionId>) => AgentFace | undefined
  create: (opts: {
    sessionId: ReturnType<typeof SessionId>
    meta?: { cwd?: string }
    agentOptions?: AgentOptionsFace
    setup?: (agentCtx: Context) => void
  }) => Promise<{ agent: AgentFace; dispose: () => void }>
  resume: (opts: {
    resumeSessionId: ReturnType<typeof SessionId>
    agentOptions?: AgentOptionsFace
    setup?: (agentCtx: Context) => void
  }) => Promise<{ agent: AgentFace; dispose: () => void }>
}

export type HostCommands = {
  execute: (agent: AgentFace, line: string, images: never[], signal: AbortSignal) => Promise<{ result?: { kind: string; text?: string } } | undefined>
  list: (agent: AgentFace) => { name: string; description: string }[]
}

export type SkillPiece = { name: string; description: string }

export function assistantTextFromEvent(event: { type: string; data?: unknown }): string {
  if (event.type !== 'assistant/message' || event.data === null || typeof event.data !== 'object') return ''
  const message = (event.data as { message?: { content?: unknown } }).message
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(block => {
      if (!block || typeof block !== 'object') return []
      const row = block as { type?: unknown; text?: unknown }
      if (row.type !== 'text' || typeof row.text !== 'string' || row.text.length === 0) return []
      return [row.text]
    })
    .join('')
}

export function turnErrorFromEvent(event: { type: string; data?: unknown }): string | undefined {
  if (event.type !== 'turn/end' || event.data === null || typeof event.data !== 'object') return undefined
  const reason = (event.data as { reason?: { kind?: unknown; error?: { message?: unknown } } }).reason
  if (reason?.kind !== 'error') return undefined
  const message = reason.error?.message
  if (typeof message === 'string' && message.length > 0) return message
  return 'The agent turn failed.'
}

export class GatewayRuntime {
  state: GatewayState
  readonly path: string
  private readonly agents: HostAgents
  private readonly commands: HostCommands | undefined
  private readonly getCommands?: () => HostCommands | undefined
  private readonly setupAgent?: AgentSetup
  private readonly modeled = new Set<string>()
  private readonly configured = new Set<string>()
  private seq = 0
  private leftoverCalls: HostCall[] = []
  private pending: HostCall[] = []
  private flushWork: Promise<void> = Promise.resolve()
  private skills: SkillPiece[] = []
  private readonly turnStarted = new Set<string>()
  private readonly turnText = new Map<string, string>()
  private readonly commitVisibleSent = new Set<string>()
  private readonly approvalWaiters = new Map<string, {
    promise: Promise<ApprovalAnswer>
    resolve: (answer: ApprovalAnswer) => void
    settled: boolean
  }>()
  readonly modelPicks = new Map<string, ModelPick>()
  readonly outbox: Delivery[] = []
  onDeliveries: (deliveries: readonly Delivery[]) => void = () => {}
  private sinks: Array<(deliveries: readonly Delivery[]) => void> = []

  watchDeliveries(fn: (deliveries: readonly Delivery[]) => void): () => void {
    this.sinks.push(fn)
    return () => { this.sinks = this.sinks.filter(sink => sink !== fn) }
  }

  private readonly defaultModel?: () => { provider: string; model: string } | undefined
  private readonly cwd?: () => string | undefined
  private readonly onHostSession?: (info: {
    id: string
    title: string
    cwd: string
    created: boolean
    recents: boolean
  }) => void
  private readonly onArchiveSession?: (id: string) => void

  constructor(args: {
    path?: string
    agents: HostAgents
    commands?: HostCommands
    getCommands?: () => HostCommands | undefined
    setupAgent?: AgentSetup
    state?: GatewayState
    defaultModel?: () => { provider: string; model: string } | undefined
    skills?: SkillPiece[]
    cwd?: () => string | undefined
    onHostSession?: (info: {
      id: string
      title: string
      cwd: string
      created: boolean
      recents: boolean
    }) => void
    onArchiveSession?: (id: string) => void
  }) {
    this.path = args.path ?? gatewayStatePath()
    const loaded = args.state ?? loadState(this.path)
    const recovered = recoverTurns(loaded)
    this.state = recovered.state
    this.leftoverCalls = []
    this.pending.push(...recovered.hostCalls)
    this.agents = args.agents
    this.commands = args.commands
    if (args.getCommands !== undefined) this.getCommands = args.getCommands
    if (args.setupAgent !== undefined) this.setupAgent = args.setupAgent
    if (args.defaultModel !== undefined) this.defaultModel = args.defaultModel
    if (args.skills !== undefined) this.skills = [...args.skills]
    if (args.cwd !== undefined) this.cwd = args.cwd
    if (args.onHostSession !== undefined) this.onHostSession = args.onHostSession
    if (args.onArchiveSession !== undefined) this.onArchiveSession = args.onArchiveSession
    if (recovered.state !== loaded) saveState(this.path, this.state)
  }

  setSkills(skills: readonly SkillPiece[]): void {
    this.skills = [...skills]
    this.replaceCatalog([])
  }

  replaceCatalog(commands: readonly { name: string; description: string }[]): void {
    const catalog = buildCatalog(commands, this.skills)
    this.apply({
      kind: 'catalog',
      catalog,
      id: this.nextId(),
      at: this.now(),
    })
  }

  async run(inbound: Inbound): Promise<HandleResult> {
    await this.flush()
    const result = this.apply(inbound)
    this.pending.push(...result.hostCalls)
    await this.flush()
    return result
  }

  async flush(): Promise<void> {
    this.flushWork = this.flushWork.then(async () => {
      while (this.pending.length > 0) {
        const call = this.pending.shift()
        if (!call) break
        await this.perform(call)
      }
    })
    return this.flushWork
  }

  takeRecoveryCalls(): HostCall[] {
    const calls = this.leftoverCalls
    this.leftoverCalls = []
    return calls
  }

  apply(inbound: Inbound): HandleResult {
    const result = handle(this.state, inbound)
    this.state = result.state
    saveState(this.path, this.state)
    this.outbox.push(...result.deliveries)
    if (this.outbox.length > 64) this.outbox.splice(0, this.outbox.length - 64)
    this.onDeliveries(result.deliveries)
    for (const sink of this.sinks) sink(result.deliveries)
    if (inbound.kind === 'setTitle') {
      this.pinHost(this.state.sessions[sessionKey(inbound.identity)], false)
    }
    return result
  }

  list() {
    return list(this.state)
  }

  nextId() {
    this.seq += 1
    return inboundId(`rt-${Date.now()}-${this.seq}`)
  }

  now() {
    return timestamp(Date.now())
  }

  noteAgentStatus(hostId: string, status: string): void {
    const key = this.keyForHost(hostId)
    if (!key) return
    if (status === 'running') {
      this.beginTurn(hostId, key)
      void this.flush()
      return
    }
    if (status !== 'idle') return
    this.endTurn(hostId, key)
    void this.flush()
  }

  noteSessionEvent(hostId: string, event: { type: string; data?: unknown }): void {
    const key = this.keyForHost(hostId)
    if (!key) return
    const session = this.state.sessions[key]
    if (event.type === 'session/title' && session) {
      const data = event.data as { title?: unknown; source?: { kind?: unknown } } | undefined
      const title = typeof data?.title === 'string' ? data.title : ''
      const source = data?.source !== null && typeof data?.source === 'object' ? data.source.kind : undefined
      if (title.length > 0 && (source !== 'user' || looksLikePromptTitle(title, session.identity))) {
        this.pinHost(session, false)
      }
    }
    const failed = turnErrorFromEvent(event)
    if (failed !== undefined) {
      this.beginTurn(hostId, key)
      this.commit({
        kind: 'hostReport',
        sessionKey: key,
        report: { kind: 'error', message: failed },
        id: this.nextId(),
        at: this.now(),
      })
      void this.flush()
      return
    }
    if (event.type === 'approval/asked') {
      const data = event.data as { id?: unknown; toolName?: unknown; reason?: unknown } | undefined
      const rawId = typeof data?.id === 'string' && data.id.length > 0 ? data.id : `ask-${hostId}-${this.seq + 1}`
      const summary = typeof data?.reason === 'string' && data.reason.length > 0
        ? data.reason
        : typeof data?.toolName === 'string' && data.toolName.length > 0
          ? data.toolName
          : 'Approval needed'
      this.beginTurn(hostId, key)
      this.ensureApprovalWaiter(hostId)
      this.commit({
        kind: 'hostReport',
        sessionKey: key,
        report: {
          kind: 'approvalRequested',
          request: {
            requestId: approvalId(rawId),
            summary,
            options: ['allow-once', 'deny'],
          },
        },
        id: this.nextId(),
        at: this.now(),
      })
      void this.flush()
      return
    }
    if (event.type === 'approval/decided') {
      const data = event.data as { id?: unknown; outcome?: unknown } | undefined
      const rawId = typeof data?.id === 'string' && data.id.length > 0 ? data.id : `decided-${hostId}`
      const answer = data?.outcome === 'allowed-once'
        ? 'allow-once' as const
        : data?.outcome === 'rejected'
          ? 'deny' as const
          : undefined
      this.approvalWaiters.delete(hostId)
      this.commit({
        kind: 'hostReport',
        sessionKey: key,
        report: {
          kind: 'approvalSettled',
          requestId: approvalId(rawId),
          ...(answer ? { answer } : {}),
        },
        id: this.nextId(),
        at: this.now(),
      })
      void this.flush()
      return
    }
    const piece = assistantTextFromEvent(event)
    if (piece.length === 0) return
    this.beginTurn(hostId, key)
    const previous = this.turnText.get(hostId) ?? ''
    this.turnText.set(hostId, previous.length === 0 ? piece : `${previous}\n\n${piece}`)
    if (this.sessionWantsChatFeel(key)) {
      this.commitVisibleSent.add(hostId)
      this.commit({
        kind: 'hostReport',
        sessionKey: key,
        report: { kind: 'turnProgress', snapshot: { text: piece, tools: [] } },
        id: this.nextId(),
        at: this.now(),
      })
      void this.flush()
    }
  }

  async perform(call: HostCall): Promise<void> {
    try {
      await this.performInner(call)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dsh-messaging-gateway] host call failed', message)
      if (call.kind === 'ensurePrompt' || call.kind === 'ensureCommand' || call.kind === 'rotateSession') {
        this.commit({
          kind: 'hostReport',
          sessionKey: call.sessionKey,
          report: { kind: 'error', message },
          id: this.nextId(),
          at: this.now(),
        })
      }
    }
  }

  private async performInner(call: HostCall): Promise<void> {
    if (call.kind === 'ensurePrompt' || call.kind === 'ensureCommand') {
      const agent = await this.ensureAgent(call)
      if (call.kind === 'ensurePrompt') {
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: call.prompt.text }],
          source: { kind: 'user' },
        }))
        return
      }
      const raw = call.line.text.replace(/^\//, '')
      const name = raw.split(/\s+/)[0] ?? ''
      this.syncCatalog(agent)
      if (name === 'help' || name === 'dsh' && raw.split(/\s+/)[1] === 'help') {
        this.commit({
          kind: 'hostReport',
          sessionKey: call.sessionKey,
          report: { kind: 'commandResult', text: formatHelp(this.state.catalog) },
          id: this.nextId(),
          at: this.now(),
        })
        return
      }
      const matched = matchCommand(this.state.catalog, call.line)
      if (matched.kind === 'ok' && matched.spec.source === 'skill') {
        const text = `/${matched.spec.name}${matched.args.length > 0 ? ` ${matched.args}` : ''}`
        agent.followup(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }))
        return
      }
      const line = call.line.text.startsWith('/') ? call.line.text : `/${call.line.text}`
      const commands = this.getCommands?.() ?? this.commands
      const executed = await commands?.execute(agent, line, [], new AbortController().signal)
      const text = executed && 'result' in executed ? executed.result?.text ?? '' : ''
      this.commit({
        kind: 'hostReport',
        sessionKey: call.sessionKey,
        report: { kind: 'commandResult', text: text || 'Unknown command.' },
        id: this.nextId(),
        at: this.now(),
      })
      return
    }
    if (call.kind === 'rotateSession') {
      await this.rotateAgent(call)
      return
    }
    if (call.kind === 'cancel') {
      this.agents.get(SessionId(call.host.hostSessionId))?.cancel({ kind: 'user' })
      return
    }
    if (call.kind === 'answerApproval') {
      this.ensureApprovalWaiter(String(call.host.hostSessionId)).resolve(call.answer)
    }
  }

  private beginTurn(hostId: string, key: SessionKey): void {
    if (this.turnStarted.has(hostId)) return
    this.turnStarted.add(hostId)
    this.turnText.set(hostId, '')
    this.commitVisibleSent.delete(hostId)
    this.commit({
      kind: 'hostReport',
      sessionKey: key,
      report: { kind: 'turnStarted' },
      id: this.nextId(),
      at: this.now(),
    })
  }

  private endTurn(hostId: string, key: SessionKey): void {
    if (!this.turnStarted.has(hostId)) return
    const text = (this.turnText.get(hostId) ?? '').trim()
    const alreadySent = this.commitVisibleSent.has(hostId)
    this.turnStarted.delete(hostId)
    this.turnText.delete(hostId)
    this.commitVisibleSent.delete(hostId)
    if (text.length > 0 && !alreadySent) {
      this.commit({
        kind: 'hostReport',
        sessionKey: key,
        report: { kind: 'turnProgress', snapshot: { text, tools: [] } },
        id: this.nextId(),
        at: this.now(),
      })
    }
    this.commit({
      kind: 'hostReport',
      sessionKey: key,
      report: { kind: 'turnEnded' },
      id: this.nextId(),
      at: this.now(),
    })
  }

  private commit(inbound: Inbound): HandleResult {
    const result = this.apply(inbound)
    this.pending.push(...result.hostCalls)
    return result
  }

  private syncCatalog(agent: AgentFace): void {
    const commands = this.getCommands?.() ?? this.commands
    const listed = commands?.list(agent) ?? []
    this.replaceCatalog(listed)
  }

  private keyForHost(hostId: string): SessionKey | undefined {
    for (const session of Object.values(this.state.sessions)) {
      if (session.host.kind === 'bound' && String(session.host.hostSessionId) === hostId) {
        return session.key
      }
    }
    return undefined
  }

  private modelFor(hostId?: string): { provider: string; model: string } | undefined {
    if (hostId !== undefined) {
      const picked = this.modelPicks.get(hostId)
      if (picked) return { provider: picked.provider, model: picked.model }
    }
    return this.defaultModel?.()
  }

  private agentSetup(
    pick: { provider: string; model: string } | undefined,
    opts?: { chatFeel?: boolean; feishuCards?: boolean },
  ): ((agentCtx: Context) => void) | undefined {
    const chatFeel = opts?.chatFeel === true
    const feishuCards = opts?.feishuCards === true
    if (!pick && this.setupAgent === undefined && !chatFeel && !feishuCards) return undefined
    return agentCtx => {
      this.setupAgent?.(agentCtx)
      this.installGatewayChatHooks(agentCtx, { chatFeel, feishuCards })
      if (pick) {
        installModelSelection(agentCtx, {
          current: { provider: pick.provider, model: pick.model },
          assembled: undefined,
        })
      }
      const id = agentCtx.agent?.id
      if (id !== undefined) this.configured.add(String(id))
    }
  }

  private sessionPlatform(key: SessionKey | undefined): string | undefined {
    if (!key) return undefined
    return this.state.sessions[key]?.identity.platform
  }

  private sessionWantsChatFeel(key: SessionKey | undefined): boolean {
    const platform = this.sessionPlatform(key)
    return platform === 'feishu' || platform === 'slack'
  }

  private sessionIsFeishu(key: SessionKey | undefined): boolean {
    return this.sessionPlatform(key) === 'feishu'
  }

  private hostWantsChatFeel(hostId: string): boolean {
    return this.sessionWantsChatFeel(this.keyForHost(hostId))
  }

  private hostIsFeishu(hostId: string): boolean {
    return this.sessionIsFeishu(this.keyForHost(hostId))
  }

  private feelOpts(key: SessionKey | undefined): { chatFeel: boolean; feishuCards: boolean } {
    return {
      chatFeel: this.sessionWantsChatFeel(key),
      feishuCards: this.sessionIsFeishu(key),
    }
  }

  private installGatewayChatHooks(
    agentCtx: Context,
    opts: { chatFeel: boolean; feishuCards: boolean },
  ): void {
    if (opts.chatFeel) installFeishuSpeakingContract(agentCtx)
    if (!opts.feishuCards) return
    installFeishuApprovalHold(agentCtx, (request, next) => {
      const hostId = String((agentCtx as Context & { agent?: { id?: unknown } }).agent?.id ?? request.agent?.id ?? '')
      return this.holdFeishuApproval(hostId, request, next)
    })
  }

  private ensureApprovalWaiter(hostId: string): {
    promise: Promise<ApprovalAnswer>
    resolve: (answer: ApprovalAnswer) => void
    settled: boolean
  } {
    const existing = this.approvalWaiters.get(hostId)
    if (existing && !existing.settled) return existing
    let resolve!: (answer: ApprovalAnswer) => void
    const promise = new Promise<ApprovalAnswer>(done => { resolve = done })
    const entry = {
      promise,
      resolve: (answer: ApprovalAnswer) => {
        if (entry.settled) return
        entry.settled = true
        resolve(answer)
      },
      settled: false,
    }
    this.approvalWaiters.set(hostId, entry)
    return entry
  }

  private async holdFeishuApproval(
    hostId: string,
    request: ApprovalHoldRequest,
    next: () => Promise<ApprovalHoldOutcome>,
  ): Promise<ApprovalHoldOutcome> {
    const id = hostId || String(request.agent?.id ?? '')
    if (!id) return next()
    const waiter = this.ensureApprovalWaiter(id)
    try {
      return await Promise.race([
        waiter.promise.then(outcomeFromAnswer),
        next(),
      ])
    } catch {
      return 'unavailable'
    }
  }

  /** Return the complete setup used for a messaging-owned Agent. */
  setupForAgent(hostId?: string): ((agentCtx: Context) => void) | undefined {
    const pick = hostId === undefined ? this.modelFor() : this.modelFor(hostId)
    const key = hostId === undefined ? undefined : this.keyForHost(hostId)
    return this.agentSetup(pick, this.feelOpts(key))
  }

  /**
   * Mount messaging-owned scoped contributions onto an already-live Agent.
   * This is used when startup discovers that a persisted session was already
   * resumed by another lifecycle pass, so the resume setup callback did not
   * get a chance to run in this pass.
   */
  ensureAgentSetup(hostId: string): void {
    if (this.configured.has(hostId)) return
    const agent = this.agents.get(SessionId(hostId))
    if (!agent?.ctx) return
    this.setupAgent?.(agent.ctx)
    this.installGatewayChatHooks(agent.ctx, {
      chatFeel: this.hostWantsChatFeel(hostId),
      feishuCards: this.hostIsFeishu(hostId),
    })
    this.configured.add(hostId)
  }

  private attachModel(hostId: string, agent: AgentFace, pick: { provider: string; model: string } | undefined): void {
    if (!pick || this.modeled.has(hostId)) return
    if (agent.ctx) {
      installModelSelection(agent.ctx, {
        current: { provider: pick.provider, model: pick.model },
        assembled: undefined,
      })
    }
    this.modeled.add(hostId)
    this.modelPicks.set(hostId, pick)
  }

  private pinHost(session: MessagingSession | undefined, created: boolean): void {
    if (!session || session.host.kind !== 'bound' || !this.onHostSession) return
    const cwd = this.cwd?.() ?? process.cwd()
    this.onHostSession({
      id: String(session.host.hostSessionId),
      title: session.title,
      cwd,
      created,
      recents: isMainConversation(session.identity),
    })
  }

  private archiveHost(id: string): void {
    this.onArchiveSession?.(id)
  }

  private async rotateAgent(call: Extract<HostCall, { kind: 'rotateSession' }>): Promise<void> {
    this.pending = this.pending.filter(item => item.sessionKey !== call.sessionKey)
    const ids = new Set<string>()
    if (call.host.kind === 'bound') ids.add(String(call.host.hostSessionId))
    const current = this.state.sessions[call.sessionKey]
    if (current?.host.kind === 'bound') ids.add(String(current.host.hostSessionId))
    for (const id of ids) {
      this.agents.get(SessionId(id))?.cancel({ kind: 'user' })
      this.archiveHost(id)
    }
    await this.bindNewAgent(call.sessionKey)
    this.commit({
      kind: 'hostReport',
      sessionKey: call.sessionKey,
      report: { kind: 'commandResult', text: 'Started a new session.' },
      id: this.nextId(),
      at: this.now(),
    })
  }

  private async ensureAgent(call: Extract<HostCall, { kind: 'ensurePrompt' | 'ensureCommand' }>): Promise<AgentFace> {
    if (call.host.kind === 'bound') {
      const live = this.agents.get(SessionId(call.host.hostSessionId))
      if (live) {
        this.ensureAgentSetup(String(call.host.hostSessionId))
        this.attachModel(String(call.host.hostSessionId), live, this.modelFor(String(call.host.hostSessionId)))
        return live
      }
      const pick = this.modelFor(String(call.host.hostSessionId))
      const setup = this.agentSetup(pick, this.feelOpts(call.sessionKey))
      const resumed = await this.agents.resume({
        resumeSessionId: SessionId(call.host.hostSessionId),
        ...(pick ? { agentOptions: { provider: pick.provider, model: pick.model } } : {}),
        ...(setup ? { setup } : {}),
      })
      this.pinHost(this.state.sessions[call.sessionKey], false)
      return resumed.agent
    }
    return this.bindNewAgent(call.sessionKey)
  }

  private async bindNewAgent(key: SessionKey): Promise<AgentFace> {
    const sessionId = SessionId(`session-${randomUUID()}`)
    const pick = this.modelFor(String(sessionId))
    const setup = this.agentSetup(pick, this.feelOpts(key))
    const cwd = this.cwd?.() ?? process.cwd()
    const created = await this.agents.create({
      sessionId,
      meta: { cwd },
      ...(pick ? { agentOptions: { provider: pick.provider, model: pick.model } } : {}),
      ...(setup ? { setup } : {}),
    })
    if (pick) this.modelPicks.set(String(sessionId), pick)
    this.commit({
      kind: 'hostReport',
      sessionKey: key,
      report: { kind: 'bound', hostSessionId: hostSessionId(String(sessionId)) },
      id: this.nextId(),
      at: this.now(),
    })
    this.pinHost(this.state.sessions[key], true)
    return created.agent
  }
}

export function captureAgents(ctx: Context): HostAgents {
  const agents = ctx.agents
  return {
    get: id => agents.get(id),
    create: async opts => {
      const handle = await agents.create(opts)
      return { agent: handle.agent, dispose: () => { void handle.dispose() } }
    },
    resume: async opts => {
      const handle = await agents.resume(opts)
      return { agent: handle.agent, dispose: () => { void handle.dispose() } }
    },
  }
}

export function captureCommands(ctx: Context): HostCommands | undefined {
  const commands = ctx.get('commands') as HostCommands | undefined
  return commands
}
