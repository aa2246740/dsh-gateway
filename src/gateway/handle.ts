import { accessOf, decideAccess } from './access.ts'
import { isFreshSessionCommand, matchCommand } from './catalog.ts'
import { sessionKey } from './key.ts'
import { list, projectDelta } from './list.ts'
import { displayTitle, looksLikePromptTitle } from './title.ts'
import {
  idempotencyKey,
  type Addressing,
  type ChatBody,
  type Delivery,
  type GatewayState,
  type HandleResult,
  type HostCall,
  type Inbound,
  type InboundId,
  type MessagingSession,
  type PlatformAccess,
  type QueuedWork,
  type SessionHost,
  type SessionIdentity,
  type Timestamp,
} from './types.ts'

const SEEN_LIMIT = 512

export function emptyState(): GatewayState {
  return {
    version: 1,
    access: { byPlatform: {} },
    sessions: {},
    catalog: { commands: [], catchAllPrefix: 'dsh' },
    seen: [],
    pairingSeq: 0,
  }
}

export { list }

function remember(seen: readonly InboundId[], id: InboundId): readonly InboundId[] {
  const next = seen.includes(id) ? seen : [...seen, id]
  return next.length > SEEN_LIMIT ? next.slice(next.length - SEEN_LIMIT) : next
}

function silent(state: GatewayState, inboundId: InboundId): HandleResult {
  const next = { ...state, seen: remember(state.seen, inboundId) }
  return { state: next, hostCalls: [], deliveries: [], listDelta: { kind: 'none' } }
}

function putAccess(state: GatewayState, platform: string, access: PlatformAccess): GatewayState {
  return { ...state, access: { byPlatform: { ...state.access.byPlatform, [platform]: access } } }
}

function putSession(state: GatewayState, session: MessagingSession): GatewayState {
  return { ...state, sessions: { ...state.sessions, [session.key]: session } }
}

function dropSession(state: GatewayState, key: string): GatewayState {
  const sessions = { ...state.sessions }
  delete sessions[key]
  return { ...state, sessions }
}

function chat(identity: SessionIdentity, key: ReturnType<typeof sessionKey>, body: ChatBody): Delivery {
  return { kind: 'chat', identity, sessionKey: key, body }
}

function mentionOk(addressing: Addressing, hasSession: boolean): boolean {
  if (addressing.kind === 'dm') return true
  return addressing.mentioned || addressing.botInvited || hasSession
}

function titleFor(identity: SessionIdentity, actor?: string): string {
  return displayTitle(identity, identity.kind === 'dm' && actor ? { peerName: actor } : {})
}

function ensureSession(state: GatewayState, identity: SessionIdentity, at: Timestamp, title: string): {
  state: GatewayState
  session: MessagingSession
} {
  const key = sessionKey(identity)
  const existing = state.sessions[key]
  if (existing) {
    const session = { ...existing, lastActivityAt: at, title: existing.title || title }
    return { state: putSession(state, session), session }
  }
  const session: MessagingSession = {
    key,
    identity,
    host: { kind: 'unbound' },
    workspace: { kind: 'host-default' },
    turn: { kind: 'idle' },
    queued: [],
    lastActivityAt: at,
    title,
  }
  return { state: putSession(state, session), session }
}

function dispatchWork(
  session: MessagingSession,
  work: QueuedWork,
): { session: MessagingSession; hostCalls: HostCall[] } {
  if (session.host.kind === 'provisioning') {
    return { session: { ...session, queued: [...session.queued, work] }, hostCalls: [] }
  }
  if (session.host.kind === 'bound' && session.turn.kind !== 'idle') {
    return { session: { ...session, queued: [...session.queued, work] }, hostCalls: [] }
  }

  const host: SessionHost = session.host.kind === 'unbound' ? { kind: 'provisioning' } : session.host
  const call: HostCall = work.kind === 'prompt'
    ? {
        kind: 'ensurePrompt',
        idempotencyKey: work.idempotencyKey,
        sessionKey: session.key,
        identity: session.identity,
        host: session.host,
        workspace: session.workspace,
        prompt: work.prompt,
      }
    : {
        kind: 'ensureCommand',
        idempotencyKey: work.idempotencyKey,
        sessionKey: session.key,
        identity: session.identity,
        host: session.host,
        workspace: session.workspace,
        line: work.line,
      }
  return {
    session: { ...session, host, turn: { kind: 'inFlight' } },
    hostCalls: [call],
  }
}

function drainQueue(session: MessagingSession): { session: MessagingSession; hostCalls: HostCall[] } {
  if (session.host.kind !== 'bound' || session.queued.length === 0) {
    return { session, hostCalls: [] }
  }
  const [first, ...rest] = session.queued
  if (!first) return { session, hostCalls: [] }
  const cleared = { ...session, queued: rest, turn: { kind: 'idle' as const } }
  return dispatchWork(cleared, first)
}

/** Host restart cannot resume an in-flight turn. Idle the session and drain work queued behind it. */
export function recoverTurns(state: GatewayState): { state: GatewayState; hostCalls: HostCall[] } {
  let changed = false
  const hostCalls: HostCall[] = []
  const sessions: Record<string, MessagingSession> = {}
  for (const [key, session] of Object.entries(state.sessions)) {
    let next = session
    if (next.host.kind === 'provisioning') {
      next = { ...next, host: { kind: 'unbound' }, turn: { kind: 'idle' } }
      changed = true
    } else if (next.turn.kind !== 'idle') {
      next = { ...next, turn: { kind: 'idle' } }
      changed = true
    }
    if (looksLikePromptTitle(next.title, next.identity)) {
      next = { ...next, title: displayTitle(next.identity) }
      changed = true
    }
    if (next.host.kind === 'bound' && next.queued.length > 0) {
      const drained = drainQueue(next)
      next = drained.session
      hostCalls.push(...drained.hostCalls)
      changed = true
    }
    sessions[key] = next
  }
  if (!changed) return { state, hostCalls: [] }
  return { state: { ...state, sessions }, hostCalls }
}

function finish(before: GatewayState, after: GatewayState, hostCalls: readonly HostCall[], deliveries: readonly Delivery[]): HandleResult {
  return {
    state: after,
    hostCalls,
    deliveries,
    listDelta: projectDelta(before, after),
  }
}

export function handle(state: GatewayState, inbound: Inbound): HandleResult {
  if (state.seen.includes(inbound.id)) {
    return { state, hostCalls: [], deliveries: [], listDelta: { kind: 'none' } }
  }
  const stamped = { ...state, seen: remember(state.seen, inbound.id) }

  switch (inbound.kind) {
    case 'bind': {
      const access: PlatformAccess = {
        kind: 'bound',
        owner: inbound.owner,
        allowlist: [inbound.owner],
        guests: [],
        pending: [],
      }
      const after = putAccess(stamped, inbound.platform, access)
      return finish(state, after, [], [])
    }
    case 'unbind': {
      const after = putAccess(stamped, inbound.platform, { kind: 'unbound' })
      return finish(state, after, [], [])
    }
    case 'allowlist': {
      const current = accessOf(stamped.access, inbound.platform)
      if (current.kind !== 'bound') return silent(stamped, inbound.id)
      const allowlist = inbound.op === 'add'
        ? current.allowlist.includes(inbound.subject)
          ? current.allowlist
          : [...current.allowlist, inbound.subject]
        : current.allowlist.filter(s => s !== inbound.subject || s === current.owner)
      const after = putAccess(stamped, inbound.platform, { ...current, allowlist })
      return finish(state, after, [], [])
    }
    case 'pairingDecision': {
      let foundPlatform: string | undefined
      let current: Extract<PlatformAccess, { kind: 'bound' }> | undefined
      for (const [id, access] of Object.entries(stamped.access.byPlatform)) {
        if (access.kind !== 'bound') continue
        if (access.pending.some(p => p.code === inbound.code)) {
          foundPlatform = id
          current = access
          break
        }
      }
      if (!current || !foundPlatform) return silent(stamped, inbound.id)
      const pending = current.pending.find(p => p.code === inbound.code)
      if (!pending) return silent(stamped, inbound.id)
      const rest = current.pending.filter(p => p.code !== inbound.code)
      if (inbound.op === 'deny') {
        const after = putAccess(stamped, foundPlatform, { ...current, pending: rest })
        return finish(state, after, [], [])
      }
      const guests = current.guests.some(g => g.subject === pending.subject)
        ? current.guests
        : [...current.guests, { subject: pending.subject, pairedAt: inbound.at }]
      const after = putAccess(stamped, foundPlatform, { ...current, pending: rest, guests })
      return finish(state, after, [], [])
    }
    case 'revoke': {
      const current = accessOf(stamped.access, inbound.platform)
      if (current.kind !== 'bound') return silent(stamped, inbound.id)
      if (inbound.subject === current.owner) return silent(stamped, inbound.id)
      const after = putAccess(stamped, inbound.platform, {
        ...current,
        allowlist: current.allowlist.filter(s => s !== inbound.subject),
        guests: current.guests.filter(g => g.subject !== inbound.subject),
        pending: current.pending.filter(p => p.subject !== inbound.subject),
      })
      return finish(state, after, [], [])
    }
    case 'catalog': {
      const after = { ...stamped, catalog: inbound.catalog }
      return finish(state, after, [], [{ kind: 'catalogUpdated' }])
    }
    case 'setWorkspace': {
      const key = sessionKey(inbound.identity)
      const existing = stamped.sessions[key]
      if (!existing) return silent(stamped, inbound.id)
      const after = putSession(stamped, { ...existing, workspace: inbound.workspace })
      return finish(state, after, [], [])
    }
    case 'setTitle': {
      const key = sessionKey(inbound.identity)
      const existing = stamped.sessions[key]
      if (!existing) return silent(stamped, inbound.id)
      const title = inbound.title.trim()
      if (title.length === 0 || title === existing.title) return silent(stamped, inbound.id)
      const after = putSession(stamped, { ...existing, title, lastActivityAt: inbound.at })
      return finish(state, after, [], [])
    }
    case 'sessionDisposed': {
      const after = dropSession(stamped, inbound.sessionKey)
      return finish(state, after, [], [])
    }
    case 'hostReport': {
      const session = stamped.sessions[inbound.sessionKey]
      if (!session) return silent(stamped, inbound.id)
      return applyHostReport(state, stamped, session, inbound)
    }
    case 'message':
    case 'command':
    case 'cancel':
    case 'approvalAnswer':
      return applyActorInbound(state, stamped, inbound)
    default: {
      const _exhaustive: never = inbound
      return _exhaustive
    }
  }
}

function applyHostReport(
  before: GatewayState,
  stamped: GatewayState,
  session: MessagingSession,
  inbound: Extract<Inbound, { kind: 'hostReport' }>,
): HandleResult {
  const report = inbound.report
  const deliveries: Delivery[] = []
  let next = session
  let hostCalls: HostCall[] = []

  switch (report.kind) {
    case 'bound': {
      next = { ...next, host: { kind: 'bound', hostSessionId: report.hostSessionId } }
      const drained = drainQueue(next)
      next = drained.session
      hostCalls = drained.hostCalls
      break
    }
    case 'turnStarted': {
      next = { ...next, turn: { kind: 'inFlight' } }
      deliveries.push(chat(session.identity, session.key, { kind: 'busy', on: true }))
      deliveries.push(chat(session.identity, session.key, { kind: 'stream', phase: 'start' }))
      break
    }
    case 'turnProgress': {
      deliveries.push(chat(session.identity, session.key, { kind: 'stream', phase: 'replace', snapshot: report.snapshot }))
      break
    }
    case 'turnEnded': {
      next = { ...next, turn: { kind: 'idle' } }
      deliveries.push(chat(session.identity, session.key, { kind: 'stream', phase: 'end' }))
      deliveries.push(chat(session.identity, session.key, { kind: 'busy', on: false }))
      const drained = drainQueue(next)
      next = drained.session
      hostCalls = drained.hostCalls
      break
    }
    case 'approvalRequested': {
      next = { ...next, turn: { kind: 'awaitingApproval', request: report.request } }
      deliveries.push(chat(session.identity, session.key, { kind: 'approval', request: report.request }))
      break
    }
    case 'approvalSettled': {
      const previous = next.turn.kind === 'awaitingApproval' ? next.turn.request : undefined
      next = { ...next, turn: { kind: 'idle' } }
      if (previous) {
        deliveries.push(chat(session.identity, session.key, {
          kind: 'approval',
          request: previous,
          handled: true,
          ...(report.answer ? { answer: report.answer } : {}),
        }))
      }
      break
    }
    case 'artifact': {
      deliveries.push(chat(session.identity, session.key, { kind: 'files', files: report.files }))
      break
    }
    case 'commandResult': {
      next = { ...next, turn: { kind: 'idle' } }
      deliveries.push(chat(session.identity, session.key, { kind: 'commandResult', text: report.text }))
      const drained = drainQueue(next)
      next = drained.session
      hostCalls = drained.hostCalls
      break
    }
    case 'error': {
      next = { ...next, turn: { kind: 'idle' } }
      deliveries.push(chat(session.identity, session.key, { kind: 'notice', text: report.message }))
      break
    }
    default: {
      const _exhaustive: never = report
      return _exhaustive
    }
  }

  const after = putSession(stamped, next)
  return finish(before, after, hostCalls, deliveries)
}

function applyActorInbound(
  before: GatewayState,
  stamped: GatewayState,
  inbound: Extract<Inbound, { kind: 'message' | 'command' | 'cancel' | 'approvalAnswer' }>,
): HandleResult {
  const key = sessionKey(inbound.identity)
  const hasSession = Boolean(stamped.sessions[key])
  const existing = stamped.sessions[key]
  const addressing: Addressing = inbound.kind === 'message' || inbound.kind === 'command'
    ? inbound.addressing
    : existing?.identity.kind === 'group'
      ? { kind: 'group', mentioned: true, botInvited: false }
      : { kind: 'dm' }
  if (!mentionOk(addressing, hasSession)) {
    return silent(stamped, inbound.id)
  }

  const platform = inbound.identity.platform
  const decided = decideAccess({
    access: accessOf(stamped.access, platform),
    actor: inbound.actor.subject,
    addressing,
    identity: inbound.identity,
    at: inbound.at,
    pairingSeq: stamped.pairingSeq,
  })
  let working = putAccess(stamped, platform, decided.access)
  working = { ...working, pairingSeq: decided.pairingSeq }

  if (decided.decision.kind === 'deny') {
    return finish(before, working, [], [])
  }
  if (decided.decision.kind === 'pair') {
    const deliveries: Delivery[] = [
      chat(inbound.identity, key, { kind: 'pairingCode', code: decided.decision.code }),
    ]
    return finish(before, working, [], deliveries)
  }

  const role = decided.decision.kind
  if (inbound.kind === 'cancel') {
    const session = working.sessions[key]
    if (!session || session.host.kind !== 'bound') return finish(before, working, [], [])
    const call: HostCall = {
      kind: 'cancel',
      idempotencyKey: idempotencyKey(inbound.id),
      sessionKey: session.key,
      host: session.host,
    }
    return finish(before, working, [call], [])
  }

  if (inbound.kind === 'approvalAnswer') {
    const session = working.sessions[key]
    if (!session || session.host.kind !== 'bound') return finish(before, working, [], [])
    if (role !== 'owner') {
      return finish(before, working, [], [
        chat(session.identity, session.key, { kind: 'notice', text: 'Only the session owner can approve.' }),
      ])
    }
    if (session.turn.kind !== 'awaitingApproval' || session.turn.request.requestId !== inbound.requestId) {
      return finish(before, working, [], [])
    }
    const request = session.turn.request
    const call: HostCall = {
      kind: 'answerApproval',
      idempotencyKey: idempotencyKey(inbound.id),
      sessionKey: session.key,
      host: session.host,
      requestId: inbound.requestId,
      answer: inbound.answer,
    }
    const after = putSession(working, { ...session, turn: { kind: 'idle' } })
    return finish(before, after, [call], [
      chat(session.identity, session.key, {
        kind: 'approval',
        request,
        handled: true,
        answer: inbound.answer,
      }),
    ])
  }

  if (inbound.kind === 'command') {
    const matched = matchCommand(working.catalog, inbound.line)
    if (matched.kind === 'unknown') {
      return finish(before, working, [], [
        chat(inbound.identity, key, { kind: 'rejectCommand', reason: 'unknown' }),
      ])
    }
    if (role === 'guest' && matched.spec.ownerOnly) {
      return finish(before, working, [], [
        chat(inbound.identity, key, { kind: 'rejectCommand', reason: 'guest-forbidden' }),
      ])
    }
    const ensured = ensureSession(working, inbound.identity, inbound.at, titleFor(inbound.identity, inbound.actor.subject))
    if (isFreshSessionCommand(matched.spec.name)) {
      const session = { ...ensured.session, turn: { kind: 'idle' as const }, queued: [] }
      const after = putSession(ensured.state, session)
      const call: HostCall = {
        kind: 'rotateSession',
        idempotencyKey: idempotencyKey(inbound.id),
        sessionKey: session.key,
        identity: session.identity,
        host: session.host,
        workspace: session.workspace,
      }
      return finish(before, after, [call], [])
    }
    const dispatched = dispatchWork(ensured.session, {
      kind: 'command',
      line: inbound.line,
      idempotencyKey: idempotencyKey(inbound.id),
    })
    const after = putSession(ensured.state, dispatched.session)
    return finish(before, after, dispatched.hostCalls, [])
  }

  const ensured = ensureSession(working, inbound.identity, inbound.at, titleFor(inbound.identity, inbound.actor.subject))
  const dispatched = dispatchWork(ensured.session, {
    kind: 'prompt',
    prompt: inbound.prompt,
    idempotencyKey: idempotencyKey(inbound.id),
  })
  const after = putSession(ensured.state, dispatched.session)
  return finish(before, after, dispatched.hostCalls, [])
}
