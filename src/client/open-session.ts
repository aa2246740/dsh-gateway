export type SessionListSnap = {
  ids?: readonly string[]
  byId?: Record<string, unknown>
  current?: string
}

export type SessionsFace = {
  open: (id: string) => void
  list?: { getSnapshot?: () => SessionListSnap }
  refresh?: () => Promise<void>
}

export function sessionIsListed(list: SessionListSnap | undefined, id: string): boolean {
  if (!list) return false
  if (list.ids?.some(item => item === id)) return true
  if (list.byId !== undefined && Object.prototype.hasOwnProperty.call(list.byId, id)) return true
  return false
}

export async function openListedSession(sessions: SessionsFace, id: string): Promise<'opened' | 'missing'> {
  const attempt = (): 'opened' | 'threw' => {
    try {
      sessions.open(id)
      return 'opened'
    } catch {
      return 'threw'
    }
  }
  if (attempt() === 'opened') return 'opened'
  if (sessions.refresh) {
    try { await sessions.refresh() } catch { /* refresh is best-effort */ }
  }
  return attempt() === 'opened' ? 'opened' : 'missing'
}
