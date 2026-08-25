import type { SessionIdentity, SessionKey } from './types.ts'

export function sessionKey(identity: SessionIdentity): SessionKey {
  const thread = identity.threadId ?? ''
  const encoded = `${identity.platform}|${identity.kind}|${identity.chatId}|${thread}`
  return encoded as SessionKey
}
