import { DEFAULT_COMMANDS, type CommandCatalog, type CommandSpec } from './gateway/index.ts'

export type CatalogPiece = {
  name: string
  description: string
  ownerOnly?: boolean
}

/** Host commands first, then built-in fallbacks, then user-invocable skills. Command names win. */
export function buildCatalog(commands: readonly CatalogPiece[], skills: readonly CatalogPiece[]): CommandCatalog {
  const seen = new Set<string>()
  const out: CommandSpec[] = []
  const add = (piece: CatalogPiece, source: 'command' | 'skill') => {
    if (piece.name.length === 0 || seen.has(piece.name)) return
    seen.add(piece.name)
    out.push({
      name: piece.name,
      description: piece.description,
      ownerOnly: piece.ownerOnly === true,
      source,
    })
  }
  for (const command of commands) add(command, 'command')
  for (const command of DEFAULT_COMMANDS) add(command, 'command')
  for (const skill of skills) add(skill, 'skill')
  return { catchAllPrefix: 'dsh', commands: out }
}

export function formatHelp(catalog: CommandCatalog): string {
  const commands = catalog.commands.filter(spec => spec.source !== 'skill')
  const skills = catalog.commands.filter(spec => spec.source === 'skill')
  const commandBlock = commands.map(spec => `/${spec.name}  ${spec.description}`).join('\n')
  if (skills.length === 0) return commandBlock || '/help'
  return `${commandBlock}\n\nSkills:\n${skills.map(spec => `/${spec.name}  ${spec.description}`).join('\n')}`
}

const SLACK_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const SLACK_SLASH_CAP = 48

const FEISHU_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const FEISHU_SLASH_CAP = 100
const FEISHU_DESC_CAP = 100

export function feishuSlashesFromCatalog(catalog: CommandCatalog): { command: string; description: string }[] {
  const out: { command: string; description: string }[] = [
    { command: 'dsh', description: 'Run a DSH command or talk to the agent' },
  ]
  for (const spec of catalog.commands) {
    if (out.length >= FEISHU_SLASH_CAP) break
    if (!FEISHU_NAME.test(spec.name) || spec.name === 'dsh') continue
    out.push({
      command: spec.name.toLowerCase(),
      description: spec.description.slice(0, FEISHU_DESC_CAP),
    })
  }
  return out
}

export type ListedSkill = {
  name: string
  description: string
  invocation?: { userInvocable?: boolean }
}

/** Keep user-invocable skills; first listing of a name wins. */
export function mergeUserSkills(batches: readonly (readonly ListedSkill[])[]): { name: string; description: string }[] {
  const byName = new Map<string, { name: string; description: string }>()
  for (const batch of batches) {
    for (const skill of batch) {
      if (skill.invocation?.userInvocable === false) continue
      if (skill.name.length === 0 || byName.has(skill.name)) continue
      byName.set(skill.name, { name: skill.name, description: skill.description })
    }
  }
  return [...byName.values()]
}

export function skillListViews(hostSessionIds: readonly string[]): { scope?: { session: { id: string } } }[] {
  const views: { scope?: { session: { id: string } } }[] = [{}]
  const seen = new Set<string>()
  for (const id of hostSessionIds) {
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    views.push({ scope: { session: { id } } })
  }
  return views
}

export function slashesFromCatalog(catalog: CommandCatalog): { command: string; description: string; should_escape: false; url: string; usage_hint?: string }[] {
  const url = 'https://dsh.local/slack/commands'
  const out: { command: string; description: string; should_escape: false; url: string; usage_hint?: string }[] = [
    { command: '/dsh', description: 'Run a DSH command or talk to the agent', should_escape: false, url, usage_hint: '[command] [args]' },
  ]
  for (const spec of catalog.commands) {
    if (out.length >= SLACK_SLASH_CAP) break
    if (!SLACK_NAME.test(spec.name) || spec.name === 'dsh') continue
    out.push({
      command: `/${spec.name}`,
      description: spec.description.slice(0, 140),
      should_escape: false,
      url,
    })
  }
  return out
}
