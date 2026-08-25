import type { SessionIdentity } from './types.ts'

export type ChatLabels = {
  readonly chatName?: string
  readonly peerName?: string
}

export function platformLabel(platform: string): string {
  if (platform.length === 0) return 'Chat'
  return `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`
}

/** Feishu open_id / chat_id are not a name. Do not put them in the Computer list. */
export function isOpaquePeerLabel(value: string): boolean {
  return /^(ou_|oc_|on_)[A-Za-z0-9_-]{8,}$/.test(value.trim())
}

export function displayTitle(identity: SessionIdentity, labels: ChatLabels = {}): string {
  const platform = platformLabel(identity.platform)
  if (identity.kind === 'dm') {
    const who = labels.peerName?.trim() || String(identity.chatId)
    if (who.length === 0 || isOpaquePeerLabel(who)) return `${platform} DM`
    return `${platform} DM · ${who}`
  }
  const raw = labels.chatName?.trim() || String(identity.chatId)
  if (isOpaquePeerLabel(raw)) {
    return identity.threadId ? `${platform} · 帖` : platform
  }
  const channel = raw.startsWith('#') ? raw : `#${raw}`
  if (identity.threadId) return `${channel} · 帖`
  return channel
}

export function looksLikePromptTitle(title: string, identity: SessionIdentity): boolean {
  const trimmed = title.trim()
  if (trimmed.length === 0 || trimmed === 'session') return true
  if (trimmed.includes('<@')) return true
  if (identity.kind === 'dm') {
    const prefix = `${platformLabel(identity.platform)} DM`
    if (!trimmed.startsWith(prefix)) return true
    const rest = trimmed.slice(prefix.length).replace(/^ · /, '').trim()
    return rest.length > 0 && isOpaquePeerLabel(rest)
  }
  return !trimmed.startsWith('#')
}
