import {
  approvalId,
  chatId,
  inboundId,
  platformId,
  subjectId,
  threadId,
  timestamp,
  type ApprovalAnswer,
  type ApprovalView,
  type Inbound,
  type SessionIdentity,
} from './gateway/index.ts'

const FEISHU = platformId('feishu')

export const FEISHU_CARD_KIND = 'dsh-approval'

export type FeishuApprovalCardValue = {
  readonly kind: typeof FEISHU_CARD_KIND
  readonly requestId: string
  readonly answer: ApprovalAnswer
  readonly chatKind: SessionIdentity['kind']
  readonly chatId: string
  readonly threadId?: string
}

export type FeishuCardActionEvent = {
  operator?: { open_id?: string }
  open_id?: string
  action?: { value?: unknown; tag?: string }
  context?: { open_chat_id?: string; open_message_id?: string }
  open_chat_id?: string
  open_message_id?: string
}

export type FeishuCardJson = {
  config: { wide_screen_mode: boolean }
  header: {
    title: { tag: 'plain_text'; content: string }
    template: string
  }
  elements: unknown[]
}

function button(
  label: string,
  answer: ApprovalAnswer,
  identity: SessionIdentity,
  requestId: string,
  type: 'primary' | 'danger',
): unknown {
  const value: FeishuApprovalCardValue = {
    kind: FEISHU_CARD_KIND,
    requestId,
    answer,
    chatKind: identity.kind,
    chatId: String(identity.chatId),
    ...(identity.threadId ? { threadId: String(identity.threadId) } : {}),
  }
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type,
    value,
  }
}

/** Interactive card whose buttons map to existing allow-once / deny answers. */
export function feishuApprovalCard(request: ApprovalView, identity: SessionIdentity): FeishuCardJson {
  const requestId = String(request.requestId)
  const actions: unknown[] = []
  const options = request.options.length > 0 ? request.options : (['allow-once', 'deny'] as const)
  if (options.includes('allow-once')) {
    actions.push(button('允许一次', 'allow-once', identity, requestId, 'primary'))
  }
  if (options.includes('deny')) {
    actions.push(button('拒绝', 'deny', identity, requestId, 'danger'))
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '需要批准' },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: request.summary },
      },
      {
        tag: 'action',
        actions,
      },
    ],
  }
}

export function handledFeishuCard(
  request: ApprovalView,
  answer?: ApprovalAnswer,
): FeishuCardJson {
  const note = answer === 'allow-once'
    ? '已允许一次'
    : answer === 'deny'
      ? '已拒绝'
      : '已处理'
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '已处理' },
      template: 'grey',
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: request.summary },
      },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: note }],
      },
    ],
  }
}

function parseValue(raw: unknown): FeishuApprovalCardValue | undefined {
  let value: unknown = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }
  if (!value || typeof value !== 'object') return undefined
  const row = value as Partial<FeishuApprovalCardValue>
  if (row.kind !== FEISHU_CARD_KIND) return undefined
  if (typeof row.requestId !== 'string' || row.requestId.length === 0) return undefined
  if (row.answer !== 'allow-once' && row.answer !== 'deny') return undefined
  if (row.chatKind !== 'dm' && row.chatKind !== 'group') return undefined
  if (typeof row.chatId !== 'string' || row.chatId.length === 0) return undefined
  return {
    kind: FEISHU_CARD_KIND,
    requestId: row.requestId,
    answer: row.answer,
    chatKind: row.chatKind,
    chatId: row.chatId,
    ...(typeof row.threadId === 'string' && row.threadId.length > 0 ? { threadId: row.threadId } : {}),
  }
}

/** Card callback → existing approvalAnswer inbound. No new permission states. */
export function inboundFromFeishuCardAction(event: FeishuCardActionEvent): Inbound | undefined {
  const value = parseValue(event.action?.value)
  if (!value) return undefined
  const user = event.operator?.open_id ?? event.open_id
  const chat = event.context?.open_chat_id ?? event.open_chat_id ?? value.chatId
  if (!user || !chat) return undefined
  const identity: SessionIdentity = {
    platform: FEISHU,
    kind: value.chatKind,
    chatId: chatId(chat),
    threadId: value.threadId ? threadId(value.threadId) : null,
  }
  const clickId = event.context?.open_message_id ?? event.open_message_id ?? `${value.requestId}:${user}:${value.answer}`
  return {
    kind: 'approvalAnswer',
    actor: { platform: identity.platform, subject: subjectId(user) },
    identity,
    requestId: approvalId(value.requestId),
    answer: value.answer,
    id: inboundId(`card:${clickId}:${value.requestId}:${value.answer}:${user}`),
    at: timestamp(Date.now()),
  }
}

export function isFeishuPlatform(platform: string): boolean {
  return platform === FEISHU
}
