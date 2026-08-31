import {
  chatId,
  displayTitle,
  inboundId,
  platformId,
  subjectId,
  threadId,
  timestamp,
  type Delivery,
  type Inbound,
  type SessionIdentity,
} from './gateway/index.ts'
import { feishuSlashHttp, syncFeishuSlashes } from './feishu-slash.ts'
import { feishuSlashesFromCatalog } from './host-catalog.ts'
import { textFromDelivery } from './present.ts'
import type { GatewayRuntime } from './runtime.ts'
import {
  feishuApprovalCard,
  handledFeishuCard,
  inboundFromFeishuCardAction,
  type FeishuCardActionEvent,
} from './feishu-card.ts'

const FEISHU = platformId('feishu')

export { inboundFromFeishuCardAction }
export type { FeishuCardActionEvent }

export type FeishuMessageEvent = {
  sender?: {
    sender_id?: { open_id?: string }
    sender_type?: string
  }
  message?: {
    message_id?: string
    chat_id?: string
    chat_type?: string
    thread_id?: string
    message_type?: string
    content?: string
    mentions?: { mentioned_type?: string }[]
  }
}

export function feishuIdentity(args: { chatId: string; chatType?: string; threadId?: string }): SessionIdentity {
  const kind = args.chatType === 'p2p' ? 'dm' : 'group'
  return {
    platform: FEISHU,
    kind,
    chatId: chatId(args.chatId),
    threadId: args.threadId ? threadId(args.threadId) : null,
  }
}

export function textFromFeishuContent(content: string | undefined): string {
  if (!content) return ''
  try {
    const parsed = JSON.parse(content) as { text?: unknown }
    if (typeof parsed.text === 'string') return parsed.text.replace(/@_user_\d+/g, '').trim()
  } catch {
    return content.trim()
  }
  return content.trim()
}

export function inboundFromFeishu(args: {
  user: string
  chatId: string
  chatType?: string
  threadId?: string
  text: string
  id: string
  mentioned?: boolean
  commands?: readonly string[]
}): Inbound {
  const identity = feishuIdentity({
    chatId: args.chatId,
    ...(args.chatType ? { chatType: args.chatType } : {}),
    ...(args.threadId ? { threadId: args.threadId } : {}),
  })
  const actor = { platform: FEISHU, subject: subjectId(args.user) }
  const addressing = identity.kind === 'dm'
    ? { kind: 'dm' as const }
    : { kind: 'group' as const, mentioned: args.mentioned === true, botInvited: false }
  const text = args.text.trim()
  const first = text.split(/\s+/)[0] ?? ''
  const names = new Set((args.commands ?? []).map(name => name.toLowerCase()))
  const isCommand = text.startsWith('/') || text.startsWith('!') || names.has(first.toLowerCase())
  const line = isCommand ? text.replace(/^[/!]/, '') : text
  const meta = { id: inboundId(args.id), at: timestamp(Date.now()) }
  if (isCommand) {
    return { kind: 'command', actor, identity, addressing, line: { text: line }, ...meta }
  }
  return { kind: 'message', actor, identity, addressing, prompt: { text, attachments: [] }, ...meta }
}

export function inboundFromFeishuEvent(event: FeishuMessageEvent, commands: readonly string[]): Inbound | undefined {
  const sender = event.sender
  const message = event.message
  if (sender?.sender_type === 'bot') return undefined
  const user = sender?.sender_id?.open_id
  const chat = message?.chat_id
  const id = message?.message_id
  if (!user || !chat || !id) return undefined
  if (message.message_type && message.message_type !== 'text') return undefined
  const mentioned = (message.mentions ?? []).some(item => item.mentioned_type === 'bot')
  return inboundFromFeishu({
    user,
    chatId: chat,
    ...(message.chat_type ? { chatType: message.chat_type } : {}),
    ...(message.thread_id ? { threadId: message.thread_id } : {}),
    text: textFromFeishuContent(message.content),
    id,
    ...(mentioned ? { mentioned: true } : {}),
    commands,
  })
}

export type FeishuOutbound = {
  readonly chatId: string
  readonly replyId?: string
  readonly msgType: 'text' | 'interactive'
  readonly content: string
  readonly mode: 'create' | 'patch'
  readonly messageId?: string
  readonly requestId?: string
}

export type FeishuSay = (out: FeishuOutbound) => Promise<{ messageId?: string } | void>

/** Map one gateway chat delivery to a Feishu create/patch. No period-splitting. */
export function feishuOutboundFromDelivery(
  delivery: Delivery,
  cards: Map<string, string>,
): FeishuOutbound | undefined {
  if (delivery.kind !== 'chat' || delivery.identity.platform !== FEISHU) return undefined
  const chat = String(delivery.identity.chatId)
  const replyId = delivery.identity.threadId ? String(delivery.identity.threadId) : undefined
  const body = delivery.body
  if (body.kind === 'approval') {
    const requestId = String(body.request.requestId)
    if (body.handled) {
      const messageId = cards.get(requestId)
      if (!messageId) return undefined
      return {
        chatId: chat,
        msgType: 'interactive',
        content: JSON.stringify(handledFeishuCard(body.request, body.answer)),
        mode: 'patch',
        messageId,
        requestId,
      }
    }
    return {
      chatId: chat,
      ...(replyId ? { replyId } : {}),
      msgType: 'interactive',
      content: JSON.stringify(feishuApprovalCard(body.request, delivery.identity)),
      mode: 'create',
      requestId,
    }
  }
  const text = textFromDelivery(delivery)
  if (!text) return undefined
  return {
    chatId: chat,
    ...(replyId ? { replyId } : {}),
    msgType: 'text',
    content: JSON.stringify({ text }),
    mode: 'create',
  }
}

export async function presentFeishuDelivery(
  delivery: Delivery,
  say: FeishuSay,
  cards: Map<string, string> = new Map(),
): Promise<void> {
  const outbound = feishuOutboundFromDelivery(delivery, cards)
  if (!outbound) return
  const posted = await say(outbound)
  if (outbound.mode === 'create' && outbound.msgType === 'interactive' && outbound.requestId) {
    const messageId = posted && typeof posted === 'object' ? posted.messageId : undefined
    if (typeof messageId === 'string' && messageId.length > 0) cards.set(outbound.requestId, messageId)
  }
}

export async function syncFeishuCatalog(
  runtime: GatewayRuntime,
  tokens: { appId: string; appSecret: string },
): Promise<void> {
  const desired = feishuSlashesFromCatalog(runtime.state.catalog)
  await syncFeishuSlashes(feishuSlashHttp(tokens.appId, tokens.appSecret), desired)
}

export async function runFeishu(
  runtime: GatewayRuntime,
  tokens: { appId: string; appSecret: string },
): Promise<() => Promise<void>> {
  const Lark = await import('@larksuiteoapi/node-sdk')
  const client = new Lark.Client({ appId: tokens.appId, appSecret: tokens.appSecret })
  const cards = new Map<string, string>()
  const unwatch = runtime.watchDeliveries(deliveries => {
    for (const delivery of deliveries) {
      if (delivery.kind !== 'chat' || delivery.identity.platform !== FEISHU) continue
      void presentFeishuDelivery(delivery, async out => {
        if (out.mode === 'patch' && out.messageId) {
          await client.im.v1.message.patch({
            path: { message_id: out.messageId },
            data: { content: out.content },
          })
          return
        }
        if (out.replyId && out.replyId.startsWith('om_')) {
          const replied = await client.im.v1.message.reply({
            path: { message_id: out.replyId },
            data: { content: out.content, msg_type: out.msgType },
          }) as { data?: { message_id?: string } }
          return { messageId: replied.data?.message_id }
        }
        const created = await client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: out.chatId,
            msg_type: out.msgType,
            content: out.content,
          },
        }) as { data?: { message_id?: string } }
        return { messageId: created.data?.message_id }
      }, cards).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[dsh-messaging-gateway] feishu delivery failed', message)
      })
    }
  })
  const commandsOf = () => runtime.state.catalog.commands.map(spec => spec.name)
  const pinTitle = (identity: SessionIdentity, peerName?: string) => {
    runtime.apply({
      kind: 'setTitle',
      identity,
      title: displayTitle(identity, peerName ? { peerName } : {}),
      id: runtime.nextId(),
      at: runtime.now(),
    })
  }
  const wsClient = new Lark.WSClient({ appId: tokens.appId, appSecret: tokens.appSecret })
  const started = wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: FeishuMessageEvent) => {
        const inbound = inboundFromFeishuEvent(data, commandsOf())
        if (!inbound) return
        await runtime.run(inbound)
        if (inbound.kind === 'message' || inbound.kind === 'command') pinTitle(inbound.identity)
      },
      'card.action.trigger': async (data: FeishuCardActionEvent) => {
        const inbound = inboundFromFeishuCardAction(data)
        if (!inbound) return
        await runtime.run(inbound)
      },
    }),
  })
  await Promise.resolve(started).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[dsh-messaging-gateway] feishu ws start failed', message)
  })
  try {
    await syncFeishuCatalog(runtime, tokens)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[dsh-messaging-gateway] feishu slash sync failed', message)
  }
  for (const session of Object.values(runtime.state.sessions)) {
    if (session.identity.platform !== FEISHU) continue
    pinTitle(session.identity)
  }
  return async () => {
    unwatch()
    wsClient.close()
  }
}
