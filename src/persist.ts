import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { emptyState, type GatewayState } from './gateway/index.ts'

/** `$DSH_HOME` is already the `.dsh` root. Do not join `.dsh` again. */
export function gatewayStatePath(): string {
  const override = process.env.MESSAGING_GATEWAY_STATE
  if (override && override.length > 0) return override
  const home = process.env.DSH_HOME?.trim()
  if (home) return join(home, 'messaging-gateway', 'state.json')
  return join(homedir(), '.dsh', 'messaging-gateway', 'state.json')
}

export function loadState(path: string): GatewayState {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isGatewayState(raw)) throw new Error(`Invalid messaging Gateway state: ${path}`)
    return raw as GatewayState
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return emptyState()
    throw error
  }
}

export function saveState(path: string, state: GatewayState): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(state), 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, path)
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
    throw error
  }
}

function isGatewayState(raw: unknown): raw is GatewayState {
  if (!isRecord(raw)) return false
  const state = raw
  const access = state.access
  const catalog = state.catalog
  if (!isRecord(access) || !isRecord(access.byPlatform)) return false
  if (!Object.values(access.byPlatform).every(isPlatformAccess)) return false
  if (!isRecord(state.sessions) || !Object.values(state.sessions).every(isMessagingSession)) return false
  if (!isRecord(catalog) || !Array.isArray(catalog.commands) || typeof catalog.catchAllPrefix !== 'string') return false
  return state.version === 1
    && Array.isArray(state.seen) && state.seen.every(value => typeof value === 'string')
    && typeof state.pairingSeq === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isPlatformAccess(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.kind === 'unbound') return true
  return value.kind === 'bound'
    && typeof value.owner === 'string'
    && Array.isArray(value.allowlist)
    && Array.isArray(value.guests)
    && Array.isArray(value.pending)
}

function isMessagingSession(value: unknown): boolean {
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.title !== 'string') return false
  if (!isRecord(value.identity) || typeof value.identity.platform !== 'string' || typeof value.identity.kind !== 'string') return false
  if (!isRecord(value.host) || (value.host.kind !== 'unbound' && value.host.kind !== 'bound')) return false
  if (value.host.kind === 'bound' && typeof value.host.hostSessionId !== 'string') return false
  return isRecord(value.turn) && typeof value.turn.kind === 'string'
    && Array.isArray(value.queued) && typeof value.lastActivityAt === 'number'
}
