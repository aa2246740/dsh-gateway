import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { gatewayStatePath } from './persist.ts'

export type ProcessProbe = 'alive' | 'dead' | 'unknown'

interface LeaseOwner {
  version: 1
  token: string
  pid: number
  createdAt: string
  heartbeatAt: string
}

export interface GatewayInstanceLease {
  path: string
  pid: number
  release: () => void
}

export type GatewayLeaseResult =
  | { acquired: true; lease: GatewayInstanceLease }
  | { acquired: false; path: string; ownerPid?: number; reason: 'active' | 'inaccessible' }

export interface GatewayLeaseDependencies {
  now?: () => number
  probePid?: (pid: number) => ProcessProbe
  heartbeatMs?: number
  staleMs?: number
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && typeof (error as NodeJS.ErrnoException).code === 'string'
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

function probeProcess(pid: number): ProcessProbe {
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    return errorCode(error) === 'ESRCH' ? 'dead' : 'unknown'
  }
}

function ownerPath(lockPath: string): string {
  return join(lockPath, 'owner.json')
}

function readOwner(lockPath: string): LeaseOwner | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(ownerPath(lockPath), 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const row = value as Partial<LeaseOwner>
    if (row.version !== 1 || typeof row.token !== 'string' || typeof row.pid !== 'number'
      || typeof row.createdAt !== 'string' || typeof row.heartbeatAt !== 'string') return undefined
    return row as LeaseOwner
  } catch {
    return undefined
  }
}

function writeOwner(lockPath: string, owner: LeaseOwner): void {
  const temporary = join(lockPath, `.${owner.token}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(owner)}\n`, { mode: 0o600 })
    renameSync(temporary, ownerPath(lockPath))
  } finally {
    rmSync(temporary, { force: true })
  }
}

function removeStaleLock(lockPath: string): boolean {
  const stale = `${lockPath}.stale-${randomUUID()}`
  try {
    renameSync(lockPath, stale)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
  rmSync(stale, { recursive: true, force: true })
  return true
}

/** The lease sits beside state.json so every Host that shares gateway state competes for one owner. */
export function gatewayInstanceLeasePath(statePath = gatewayStatePath()): string {
  return join(dirname(statePath), 'instance.lock')
}

/** Acquire the single active Gateway slot before loading state or resuming sessions. */
export function acquireGatewayInstanceLease(
  statePath = gatewayStatePath(),
  dependencies: GatewayLeaseDependencies = {},
): GatewayLeaseResult {
  const lockPath = gatewayInstanceLeasePath(statePath)
  const now = dependencies.now ?? Date.now
  const probePid = dependencies.probePid ?? probeProcess
  const heartbeatMs = dependencies.heartbeatMs ?? 2_000
  const staleMs = dependencies.staleMs ?? 10_000
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 })
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const owner = readOwner(lockPath)
      if (owner) {
        const state = probePid(owner.pid)
        if (state !== 'dead') {
          return { acquired: false, path: lockPath, ownerPid: owner.pid, reason: state === 'alive' ? 'active' : 'inaccessible' }
        }
        if (!removeStaleLock(lockPath)) continue
        continue
      }
      let age: number
      try {
        age = now() - statSync(lockPath).mtimeMs
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue
        throw error
      }
      if (age < staleMs) return { acquired: false, path: lockPath, reason: 'inaccessible' }
      if (!removeStaleLock(lockPath)) continue
      continue
    }

    const token = randomUUID()
    const started = new Date(now()).toISOString()
    let owner: LeaseOwner = {
      version: 1,
      token,
      pid: process.pid,
      createdAt: started,
      heartbeatAt: started,
    }
    try {
      writeOwner(lockPath, owner)
    } catch (error) {
      rmSync(lockPath, { recursive: true, force: true })
      throw error
    }
    const timer = setInterval(() => {
      const current = readOwner(lockPath)
      if (current?.token !== token) return
      owner = { ...owner, heartbeatAt: new Date(now()).toISOString() }
      writeOwner(lockPath, owner)
    }, heartbeatMs)
    timer.unref()
    let released = false
    return {
      acquired: true,
      lease: {
        path: lockPath,
        pid: process.pid,
        release: () => {
          if (released) return
          released = true
          clearInterval(timer)
          if (readOwner(lockPath)?.token === token) rmSync(lockPath, { recursive: true, force: true })
        },
      },
    }
  }
  return { acquired: false, path: lockPath, reason: 'inaccessible' }
}
