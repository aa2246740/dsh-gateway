import {
  chatId,
  displayTitle,
  inboundId,
  platformId,
  subjectId,
  threadId,
  timestamp,
  type ChatLabels,
  type Delivery,
  type Inbound,
  type SessionIdentity,
} from './gateway/index.ts'
import type { GatewayRuntime } from './runtime.ts'

const SLACK = platformId('slack')

type SlackSay = (args: { text: string; thread_ts?: string }) => Promise<{ ts?: string } | unknown>

type SlackUser = {
  profile?: { display_name?: string; real_name?: string }
  real_name?: string
  name?: string
}

type SlackChannel = {
  name?: string
  is_im?: boolean
  user?: string
}

export function peerNameFromSlackUser(user: SlackUser | undefined): string | undefined {
  const pieces = [user?.profile?.display_name, user?.profile?.real_name, user?.real_name, user?.name]
  for (const piece of pieces) {
    if (typeof piece === 'string' && piece.trim().length > 0) return piece.trim()
  }
  return undefined
}

export function labelsFromConversation(channel: SlackChannel | undefined): ChatLabels & { imUser?: string } {
  if (!channel) return {}
  if (channel.is_im === true && channel.user) return { imUser: channel.user }
  if (typeof channel.name === 'string' && channel.name.length > 0) return { chatName: channel.name }
  return {}
}

export function slackIdentity(args: { channel: string; threadTs?: string }): SessionIdentity {
  const kind = args.channel.startsWith('D') ? 'dm' : 'group'
  return {
    platform: SLACK,
    kind,
    chatId: chatId(args.channel),
    threadId: args.threadTs ? threadId(args.threadTs) : null,
  }
}

export function inboundFromSlack(args: {
  user: string
  channel: string
  threadTs?: string
  text: string
  id: string
  mentioned?: boolean
}): Inbound {
  const identity = args.threadTs
    ? slackIdentity({ channel: args.channel, threadTs: args.threadTs })
    : slackIdentity({ channel: args.channel })
  const actor = { platform: SLACK, subject: subjectId(args.user) }
  const addressing = identity.kind === 'dm'
    ? { kind: 'dm' as const }
    : { kind: 'group' as const, mentioned: args.mentioned === true || args.text.includes('<@'), botInvited: false }
  const text = args.text.trim()
  const isCommand = text.startsWith('/') || text.startsWith('!')
  const line = isCommand ? text.replace(/^[/!]/, '') : text
  const meta = { id: inboundId(args.id), at: timestamp(Date.now()) }
  if (isCommand) {
    return { kind: 'command', actor, identity, addressing, line: { text: line }, ...meta }
  }
  return { kind: 'message', actor, identity, addressing, prompt: { text, attachments: [] }, ...meta }
}

export async function presentSlackDelivery(
  delivery: Delivery,
  say: SlackSay,
): Promise<void> {
  if (delivery.kind !== 'chat') return
  const thread_ts = delivery.identity.threadId ?? undefined
  const body = delivery.body
  let text: string | undefined
  switch (body.kind) {
    case 'pairingCode':
      text = `Pairing code: ${body.code}. Approve it in DSH Messaging settings.`
      break
    case 'rejectCommand':
      text = body.reason === 'unknown' ? 'Unknown command.' : 'That command is owner-only.'
      break
    case 'commandResult':
      text = body.text
      break
    case 'notice':
      text = body.text
      break
    case 'busy':
      text = body.on ? 'Working…' : undefined
      break
    case 'stream':
      text = body.snapshot?.text
      break
    case 'approval':
      text = body.handled ? undefined : `Approval needed: ${body.request.summary}`
      break
    case 'files':
      text = body.files.map(f => f.name).join(', ')
      break
    default: {
      const _exhaustive: never = body
      void _exhaustive
    }
  }
  if (!text) return
  if (thread_ts) await say({ text, thread_ts })
  else await say({ text })
}

export async function runSlack(runtime: GatewayRuntime, tokens: { bot: string; app: string }): Promise<() => Promise<void>> {
  const { App } = await import('@slack/bolt')
  const app = new App({ token: tokens.bot, appToken: tokens.app, socketMode: true })
  const unwatch = runtime.watchDeliveries(deliveries => {
    for (const d of deliveries) {
      if (d.kind !== 'chat' || d.identity.platform !== SLACK) continue
      void presentSlackDelivery(d, async args => {
        if (args.thread_ts) {
          return app.client.chat.postMessage({ channel: d.identity.chatId, text: args.text, thread_ts: args.thread_ts })
        }
        return app.client.chat.postMessage({ channel: d.identity.chatId, text: args.text })
      }).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[dsh-messaging-gateway] slack delivery failed', message)
      })
    }
  })
  const seen = new Set<string>()
  const take = (id: string): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    if (seen.size > 512) seen.clear()
    return true
  }
  const names = new Map<string, ChatLabels>()
  const resolveLabels = async (channel: string, fallbackUser?: string): Promise<ChatLabels> => {
    const cached = names.get(channel)
    if (cached) return cached
    try {
      const info = await app.client.conversations.info({ channel }) as { channel?: SlackChannel }
      const fromChannel = labelsFromConversation(info.channel)
      if (fromChannel.imUser) {
        const userInfo = await app.client.users.info({ user: fromChannel.imUser }) as { user?: SlackUser }
        const peerName = peerNameFromSlackUser(userInfo.user) ?? fromChannel.imUser
        const labels: ChatLabels = { peerName }
        names.set(channel, labels)
        return labels
      }
      const labels: ChatLabels = fromChannel.chatName ? { chatName: fromChannel.chatName } : {}
      if (labels.chatName || labels.peerName) names.set(channel, labels)
      return labels
    } catch {
      return fallbackUser ? { peerName: fallbackUser } : {}
    }
  }
  const pinTitle = async (identity: SessionIdentity, channel: string, user?: string) => {
    const labels = await resolveLabels(channel, identity.kind === 'dm' ? user : undefined)
    const title = displayTitle(identity, labels)
    runtime.apply({
      kind: 'setTitle',
      identity,
      title,
      id: runtime.nextId(),
      at: runtime.now(),
    })
  }
  const ingest = async (args: Parameters<typeof inboundFromSlack>[0]) => {
    if (!take(args.id)) return
    const inbound = inboundFromSlack(args)
    await runtime.run(inbound)
    if (inbound.kind === 'message' || inbound.kind === 'command') {
      void pinTitle(inbound.identity, args.channel, args.user).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[dsh-messaging-gateway] slack title failed', message)
      })
    }
  }
  app.message(async ({ message }) => {
    if (!('user' in message) || !message.user || !('text' in message) || !message.text) return
    const threadTs = 'thread_ts' in message && typeof message.thread_ts === 'string' ? message.thread_ts : ''
    await ingest({
      user: message.user,
      channel: message.channel,
      ...(threadTs ? { threadTs } : {}),
      text: message.text,
      id: message.ts,
    })
  })
  app.event('app_mention', async ({ event }) => {
    if (!('user' in event) || !event.user || !event.text) return
    await ingest({
      user: event.user,
      channel: event.channel,
      ...(event.thread_ts ? { threadTs: event.thread_ts } : {}),
      text: event.text,
      id: event.ts,
      mentioned: true,
    })
  })
  app.command(/.*/, async ({ command, ack }) => {
    await ack()
    await ingest({
      user: command.user_id,
      channel: command.channel_id,
      ...(command.thread_ts ? { threadTs: command.thread_ts } : {}),
      text: `${command.command} ${command.text}`,
      id: `slash-${command.trigger_id}`,
    })
  })
  await app.start()
  for (const session of Object.values(runtime.state.sessions)) {
    if (session.identity.platform !== SLACK) continue
    void pinTitle(session.identity, String(session.identity.chatId)).catch(() => {})
  }
  return async () => {
    unwatch()
    await app.stop()
  }
}
