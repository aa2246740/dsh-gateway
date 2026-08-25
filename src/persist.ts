import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    if (!raw || typeof raw !== 'object') return emptyState()
    const version = (raw as { version?: unknown }).version
    if (version !== 1) return emptyState()
    return raw as GatewayState
  } catch {
    return emptyState()
  }
}

export function saveState(path: string, state: GatewayState): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state), 'utf8')
}
