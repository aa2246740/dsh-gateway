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

const FEISHU = platformId('feishu')

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

export async function presentFeishuDelivery(
  delivery: Delivery,
  say: (args: { chatId: string; text: string; replyId?: string }) => Promise<void>,
): Promise<void> {
  const text = textFromDelivery(delivery)
  if (!text || delivery.kind !== 'chat') return
  const replyId = delivery.identity.threadId ?? undefined
  await say({
    chatId: String(delivery.identity.chatId),
    text,
    ...(replyId ? { replyId: String(replyId) } : {}),
  })
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
  const unwatch = runtime.watchDeliveries(deliveries => {
    for (const delivery of deliveries) {
      if (delivery.kind !== 'chat' || delivery.identity.platform !== FEISHU) continue
      void presentFeishuDelivery(delivery, async args => {
        if (args.replyId && args.replyId.startsWith('om_')) {
          await client.im.v1.message.reply({
            path: { message_id: args.replyId },
            data: { content: JSON.stringify({ text: args.text }), msg_type: 'text' },
          })
          return
        }
        await client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: args.chatId,
            msg_type: 'text',
            content: JSON.stringify({ text: args.text }),
          },
        })
      }).catch(error => {
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
