import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Resolve the only directory Gateway-created sessions may own. */
export function resolveMessagingWorkspaceDir(
  workspaceDir: string | undefined,
  dshHome: string = process.env.DSH_HOME ?? join(homedir(), '.dsh'),
): string {
  const selected = workspaceDir?.trim() || join(dshHome, 'messaging-gateway')
  if (!isAbsolute(selected)) throw new Error('dsh-messaging-gateway workspaceDir must be an absolute path')
  return resolve(selected)
}

/** Existing sessions remain in their own workspace unless their cwd is the Gateway directory. */
export function isMessagingWorkspaceCwd(cwd: string, workspaceDir: string): boolean {
  return resolve(cwd) === resolve(workspaceDir)
}
