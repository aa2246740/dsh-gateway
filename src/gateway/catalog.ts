import type { CommandCatalog, CommandLine, CommandSpec } from './types.ts'

export const DEFAULT_COMMANDS: readonly CommandSpec[] = [
  { name: 'model', description: 'Show or switch this session model', ownerOnly: false, source: 'command' },
  { name: 'help', description: 'List DSH commands', ownerOnly: false, source: 'command' },
  { name: 'goal', description: 'Observe or change the current goal', ownerOnly: false, source: 'command' },
  { name: 'plan', description: 'Enter plan mode', ownerOnly: false, source: 'command' },
  { name: 'export', description: 'Export this session', ownerOnly: true, source: 'command' },
  { name: 'compact', description: 'Compact this session', ownerOnly: false, source: 'command' },
  { name: 'new', description: 'Start a fresh session in this chat', ownerOnly: false, source: 'command' },
  { name: 'reset', description: 'Start a fresh session in this chat', ownerOnly: false, source: 'command' },
  { name: 'feedback', description: 'Send feedback', ownerOnly: false, source: 'command' },
]

export function isFreshSessionCommand(name: string): boolean {
  return name === 'new' || name === 'reset'
}

export const DEFAULT_CATALOG: CommandCatalog = {
  catchAllPrefix: 'dsh',
  commands: DEFAULT_COMMANDS,
}

export function matchCommand(
  catalog: CommandCatalog,
  line: CommandLine,
): { kind: 'ok'; spec: CommandSpec; args: string } | { kind: 'unknown' } {
  const trimmed = line.text.trim()
  if (trimmed.length === 0) return { kind: 'unknown' }
  const parts = trimmed.split(/\s+/)
  let name = parts[0] ?? ''
  let restStart = 1
  if (name === catalog.catchAllPrefix && parts[1]) {
    name = parts[1]
    restStart = 2
  }
  const spec = catalog.commands.find(c => c.name === name)
  if (!spec) return { kind: 'unknown' }
  const args = parts.slice(restStart).join(' ')
  return { kind: 'ok', spec, args }
}
