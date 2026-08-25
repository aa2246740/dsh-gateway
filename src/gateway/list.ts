import { platformLabel } from './title.ts'
import { platformId, type GatewayState, type HostSessionId, type ListDelta, type MessagingList, type MessagingRow, type PlatformBind, type PlatformId, type SessionIdentity } from './types.ts'

/** Computer Recents and the overlay list the DM, not channel or thread rows. */
export function isMainConversation(identity: SessionIdentity): boolean {
  return identity.kind === 'dm' && identity.threadId === null
}

function rowOf(session: GatewayState['sessions'][string]): MessagingRow {
  const hostSessionId: HostSessionId | null = session.host.kind === 'bound' ? session.host.hostSessionId : null
  return {
    sessionKey: session.key,
    hostSessionId,
    identity: session.identity,
    title: session.title,
    turn: session.turn.kind,
    lastActivityAt: session.lastActivityAt,
  }
}

export function list(state: GatewayState): MessagingList {
  const platforms = new Set<string>()
  for (const [id, access] of Object.entries(state.access.byPlatform)) {
    if (access.kind === 'bound') platforms.add(id)
  }
  for (const session of Object.values(state.sessions)) {
    platforms.add(session.identity.platform)
  }

  const groups = [...platforms].sort().map(id => {
    const platform: PlatformId = platformId(id)
    const rows = Object.values(state.sessions)
      .filter(s => s.identity.platform === platform && isMainConversation(s.identity))
      .map(rowOf)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    return { platform, label: platformLabel(platform), collapsedByDefault: true as const, rows }
  }).filter(g => {
    const access = state.access.byPlatform[g.platform]
    if (g.rows.length > 0) return true
    return access?.kind === 'bound'
  })

  const access: PlatformBind[] = Object.entries(state.access.byPlatform)
    .map(([id, row]) => ({
      platform: platformId(id),
      bound: row.kind === 'bound',
      owner: row.kind === 'bound' ? String(row.owner) : null,
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform))

  return { groups, access }
}

export function projectDelta(before: GatewayState, after: GatewayState): ListDelta {
  const a = JSON.stringify(list(before))
  const b = JSON.stringify(list(after))
  if (a === b) return { kind: 'none' }
  return { kind: 'rebuild' }
}
