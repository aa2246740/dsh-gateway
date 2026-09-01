export type PlatformId = string & { readonly __brand: 'PlatformId' }
export type SubjectId = string & { readonly __brand: 'SubjectId' }
export type SessionKey = string & { readonly __brand: 'SessionKey' }
export type HostSessionId = string & { readonly __brand: 'HostSessionId' }
export type ThreadId = string & { readonly __brand: 'ThreadId' }
export type ChatId = string & { readonly __brand: 'ChatId' }
export type InboundId = string & { readonly __brand: 'InboundId' }
export type ApprovalId = string & { readonly __brand: 'ApprovalId' }
export type PairingCode = string & { readonly __brand: 'PairingCode' }
export type AttachmentToken = string & { readonly __brand: 'AttachmentToken' }
export type IdempotencyKey = string & { readonly __brand: 'IdempotencyKey' }
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' }
export type Timestamp = number & { readonly __brand: 'Timestamp' }

export type ChatKind = 'dm' | 'group'
export type WorkspaceRef = { kind: 'host-default' } | { kind: 'workspace'; id: WorkspaceId }

function brandString<T extends string>(label: string, raw: string): T {
  if (raw.length === 0) throw new Error(`${label} is empty`)
  return raw as T
}

export function platformId(raw: string): PlatformId {
  return brandString('platform', raw)
}
export function subjectId(raw: string): SubjectId {
  return brandString('subject', raw)
}
export function chatId(raw: string): ChatId {
  return brandString('chat', raw)
}
export function threadId(raw: string): ThreadId {
  return brandString('thread', raw)
}
export function inboundId(raw: string): InboundId {
  return brandString('inbound', raw)
}
export function hostSessionId(raw: string): HostSessionId {
  return brandString('host session', raw)
}
export function approvalId(raw: string): ApprovalId {
  return brandString('approval', raw)
}
export function pairingCode(raw: string): PairingCode {
  return brandString('pairing', raw)
}
export function attachmentToken(raw: string): AttachmentToken {
  return brandString('attachment', raw)
}
export function idempotencyKey(raw: string): IdempotencyKey {
  return brandString('idempotency', raw)
}
export function workspaceId(raw: string): WorkspaceId {
  return brandString('workspace', raw)
}
export function timestamp(ms: number): Timestamp {
  if (!Number.isFinite(ms)) throw new Error('timestamp is not finite')
  return ms as Timestamp
}

export type SessionIdentity = {
  readonly platform: PlatformId
  readonly kind: ChatKind
  readonly chatId: ChatId
  readonly threadId: ThreadId | null
}

export type Actor = {
  readonly platform: PlatformId
  readonly subject: SubjectId
}

export type Addressing =
  | { readonly kind: 'dm' }
  | { readonly kind: 'group'; readonly mentioned: boolean; readonly botInvited: boolean }

export type Attachment = {
  readonly name: string
  readonly mime: string
  readonly token: AttachmentToken
}

export type Prompt = {
  readonly text: string
  readonly attachments: readonly Attachment[]
}

export type CommandLine = {
  readonly text: string
}

export type ApprovalAnswer = 'allow-once' | 'deny'

export type TurnSnapshot = {
  readonly text: string
  readonly tools: readonly { readonly name: string; readonly status: 'running' | 'done' | 'error' }[]
}

export type ApprovalView = {
  readonly requestId: ApprovalId
  readonly summary: string
  readonly options: readonly ApprovalAnswer[]
}

export type OutboundFile = {
  readonly name: string
  readonly mime: string
  readonly token: AttachmentToken
}

export type CatalogSource = 'command' | 'skill'

export type CommandSpec = {
  readonly name: string
  readonly description: string
  readonly ownerOnly: boolean
  readonly source?: CatalogSource
}

export type CommandCatalog = {
  readonly commands: readonly CommandSpec[]
  readonly catchAllPrefix: string
}

export type InboundMeta = {
  readonly id: InboundId
  readonly at: Timestamp
}

export type MessageInbound = InboundMeta & {
  readonly kind: 'message'
  readonly actor: Actor
  readonly identity: SessionIdentity
  readonly addressing: Addressing
  readonly prompt: Prompt
}

export type CommandInbound = InboundMeta & {
  readonly kind: 'command'
  readonly actor: Actor
  readonly identity: SessionIdentity
  readonly addressing: Addressing
  readonly line: CommandLine
}

export type CancelInbound = InboundMeta & {
  readonly kind: 'cancel'
  readonly actor: Actor
  readonly identity: SessionIdentity
}

export type ApprovalAnswerInbound = InboundMeta & {
  readonly kind: 'approvalAnswer'
  readonly actor: Actor
  readonly identity: SessionIdentity
  readonly requestId: ApprovalId
  readonly answer: ApprovalAnswer
}

export type BindInbound = InboundMeta & {
  readonly kind: 'bind'
  readonly platform: PlatformId
  readonly owner: SubjectId
}

export type UnbindInbound = InboundMeta & {
  readonly kind: 'unbind'
  readonly platform: PlatformId
}

export type AllowlistInbound = InboundMeta & {
  readonly kind: 'allowlist'
  readonly platform: PlatformId
  readonly subject: SubjectId
  readonly op: 'add' | 'remove'
}

export type PairingDecisionInbound = InboundMeta & {
  readonly kind: 'pairingDecision'
  readonly code: PairingCode
  readonly op: 'approve' | 'deny'
}

export type RevokeInbound = InboundMeta & {
  readonly kind: 'revoke'
  readonly platform: PlatformId
  readonly subject: SubjectId
}

export type CatalogInbound = InboundMeta & {
  readonly kind: 'catalog'
  readonly catalog: CommandCatalog
}

export type WorkspaceInbound = InboundMeta & {
  readonly kind: 'setWorkspace'
  readonly identity: SessionIdentity
  readonly workspace: WorkspaceRef
}

export type SetTitleInbound = InboundMeta & {
  readonly kind: 'setTitle'
  readonly identity: SessionIdentity
  readonly title: string
}

export type HostReport =
  | { readonly kind: 'bound'; readonly hostSessionId: HostSessionId }
  | { readonly kind: 'turnStarted' }
  | { readonly kind: 'turnProgress'; readonly snapshot: TurnSnapshot }
  | { readonly kind: 'turnEnded' }
  | { readonly kind: 'approvalRequested'; readonly request: ApprovalView }
  | { readonly kind: 'approvalSettled'; readonly requestId: ApprovalId; readonly answer?: ApprovalAnswer }
  | { readonly kind: 'artifact'; readonly files: readonly OutboundFile[] }
  | { readonly kind: 'commandResult'; readonly text: string }
  | { readonly kind: 'error'; readonly message: string }

export type HostReportInbound = InboundMeta & {
  readonly kind: 'hostReport'
  readonly sessionKey: SessionKey
  readonly report: HostReport
}

export type SessionDisposedInbound = InboundMeta & {
  readonly kind: 'sessionDisposed'
  readonly sessionKey: SessionKey
}

export type Inbound =
  | MessageInbound
  | CommandInbound
  | CancelInbound
  | ApprovalAnswerInbound
  | BindInbound
  | UnbindInbound
  | AllowlistInbound
  | PairingDecisionInbound
  | RevokeInbound
  | CatalogInbound
  | WorkspaceInbound
  | SetTitleInbound
  | HostReportInbound
  | SessionDisposedInbound

export type GuestGrant = {
  readonly subject: SubjectId
  readonly pairedAt: Timestamp
}

export type PendingPair = {
  readonly code: PairingCode
  readonly subject: SubjectId
  readonly identity: SessionIdentity
  readonly issuedAt: Timestamp
}

export type PlatformAccess =
  | { readonly kind: 'unbound' }
  | {
      readonly kind: 'bound'
      readonly owner: SubjectId
      readonly allowlist: readonly SubjectId[]
      readonly guests: readonly GuestGrant[]
      readonly pending: readonly PendingPair[]
    }

export type AccessStore = {
  readonly byPlatform: { readonly [platform: string]: PlatformAccess }
}

export type AccessDecision =
  | { readonly kind: 'owner' }
  | { readonly kind: 'allowlisted' }
  | { readonly kind: 'guest' }
  | { readonly kind: 'pair'; readonly code: PairingCode; readonly issued: boolean }
  | { readonly kind: 'deny' }

export type SessionHost =
  | { readonly kind: 'unbound' }
  | { readonly kind: 'provisioning' }
  | { readonly kind: 'bound'; readonly hostSessionId: HostSessionId }

export type TurnState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'inFlight' }
  | { readonly kind: 'awaitingApproval'; readonly request: ApprovalView }

export type QueuedWork =
  | { readonly kind: 'prompt'; readonly prompt: Prompt; readonly idempotencyKey: IdempotencyKey }
  | { readonly kind: 'command'; readonly line: CommandLine; readonly idempotencyKey: IdempotencyKey }

export type MessagingSession = {
  readonly key: SessionKey
  readonly identity: SessionIdentity
  readonly host: SessionHost
  readonly workspace: WorkspaceRef
  readonly turn: TurnState
  readonly queued: readonly QueuedWork[]
  readonly lastActivityAt: Timestamp
  readonly title: string
}

export type SessionMap = { readonly [key: string]: MessagingSession }

export type GatewayState = {
  readonly version: 1
  readonly access: AccessStore
  readonly sessions: SessionMap
  readonly catalog: CommandCatalog
  readonly seen: readonly InboundId[]
  readonly pairingSeq: number
}

export type EnsurePrompt = {
  readonly kind: 'ensurePrompt'
  readonly idempotencyKey: IdempotencyKey
  readonly sessionKey: SessionKey
  readonly identity: SessionIdentity
  readonly host: SessionHost
  readonly workspace: WorkspaceRef
  readonly prompt: Prompt
}

export type EnsureCommand = {
  readonly kind: 'ensureCommand'
  readonly idempotencyKey: IdempotencyKey
  readonly sessionKey: SessionKey
  readonly identity: SessionIdentity
  readonly host: SessionHost
  readonly workspace: WorkspaceRef
  readonly line: CommandLine
}

export type CancelTurn = {
  readonly kind: 'cancel'
  readonly idempotencyKey: IdempotencyKey
  readonly sessionKey: SessionKey
  readonly host: { readonly kind: 'bound'; readonly hostSessionId: HostSessionId }
}

export type RotateSession = {
  readonly kind: 'rotateSession'
  readonly idempotencyKey: IdempotencyKey
  readonly sessionKey: SessionKey
  readonly identity: SessionIdentity
  readonly host: SessionHost
  readonly workspace: WorkspaceRef
}

export type AnswerApproval = {
  readonly kind: 'answerApproval'
  readonly idempotencyKey: IdempotencyKey
  readonly sessionKey: SessionKey
  readonly host: { readonly kind: 'bound'; readonly hostSessionId: HostSessionId }
  readonly requestId: ApprovalId
  readonly answer: ApprovalAnswer
}

export type HostCall = EnsurePrompt | EnsureCommand | CancelTurn | AnswerApproval | RotateSession

export type ChatBody =
  | { readonly kind: 'pairingCode'; readonly code: PairingCode }
  | { readonly kind: 'rejectCommand'; readonly reason: 'unknown' | 'guest-forbidden' }
  | { readonly kind: 'commandResult'; readonly text: string }
  | { readonly kind: 'notice'; readonly text: string }
  | { readonly kind: 'busy'; readonly on: boolean }
  | { readonly kind: 'stream'; readonly phase: 'start' | 'replace' | 'end'; readonly snapshot?: TurnSnapshot }
  | { readonly kind: 'approval'; readonly request: ApprovalView; readonly handled?: boolean; readonly answer?: ApprovalAnswer }
  | { readonly kind: 'files'; readonly files: readonly OutboundFile[] }

export type ChatDelivery = {
  readonly kind: 'chat'
  readonly identity: SessionIdentity
  readonly sessionKey: SessionKey
  readonly body: ChatBody
}

export type CatalogUpdated = { readonly kind: 'catalogUpdated' }

export type Delivery = ChatDelivery | CatalogUpdated

export type MessagingRow = {
  readonly sessionKey: SessionKey
  readonly hostSessionId: HostSessionId | null
  readonly identity: SessionIdentity
  readonly title: string
  readonly turn: TurnState['kind']
  readonly lastActivityAt: Timestamp
}

export type PlatformGroup = {
  readonly platform: PlatformId
  readonly label: string
  readonly collapsedByDefault: true
  readonly rows: readonly MessagingRow[]
}

export type PlatformBind = {
  readonly platform: PlatformId
  readonly bound: boolean
  readonly owner: string | null
}

export type MessagingList = {
  readonly groups: readonly PlatformGroup[]
  readonly access: readonly PlatformBind[]
}

export type ListDelta =
  | { readonly kind: 'none' }
  | { readonly kind: 'upsert'; readonly platform: PlatformId; readonly row: MessagingRow }
  | { readonly kind: 'remove'; readonly platform: PlatformId; readonly sessionKey: SessionKey }
  | { readonly kind: 'rebuild' }

export type HandleResult = {
  readonly state: GatewayState
  readonly hostCalls: readonly HostCall[]
  readonly deliveries: readonly Delivery[]
  readonly listDelta: ListDelta
}
