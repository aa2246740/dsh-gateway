export type LiveSessionCwd = {
  id?: unknown
  header?: { cwd?: string }
}

export type WorkspacePath = {
  path: string
}

function isUnder(child: string, parent: string): boolean {
  if (child === parent) return true
  const prefix = parent.endsWith('/') ? parent : `${parent}/`
  return child.startsWith(prefix)
}

/** Pick a Host workspace the Computer already lists, never the Host process cwd. */
export function pickMessagingCwd(input: {
  skipIds: ReadonlySet<string>
  live?: readonly LiveSessionCwd[]
  workspaces?: readonly WorkspacePath[]
  fallback: string
}): string {
  const paths = (input.workspaces ?? [])
    .map(item => item.path)
    .filter(path => path.length > 0)
  if (paths.length > 0) {
    const roots = paths.filter(path => !paths.some(other => other !== path && isUnder(path, other)))
    roots.sort((a, b) => a.length - b.length)
    return roots[0] ?? paths[0] ?? input.fallback
  }
  for (const session of input.live ?? []) {
    if (input.skipIds.has(String(session.id))) continue
    const cwd = session.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) return cwd
  }
  return input.fallback
}
