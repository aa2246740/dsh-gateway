import { isOpaquePeerLabel } from '../gateway/title.ts'

export type AccessRow = {
  platform: string
  bound: boolean
  owner: string | null
}

export type GroupRow = {
  platform: string
  rows: readonly unknown[]
}

export function platformBind(args: {
  platform: string
  settingsOwner?: string
  access?: readonly AccessRow[]
  groups?: readonly GroupRow[]
}): { bound: boolean; owner: string | null } {
  const row = args.access?.find(item => item.platform === args.platform)
  if (row?.bound === true) return { bound: true, owner: row.owner }
  const settingsOwner = args.settingsOwner?.trim() ?? ''
  if (settingsOwner.length > 0) return { bound: true, owner: settingsOwner }
  const group = args.groups?.find(item => item.platform === args.platform)
  if (group) return { bound: true, owner: null }
  return { bound: false, owner: null }
}

export function bindLabel(name: string, bound: boolean, owner: string | null): string {
  if (!bound) return `${name} 未绑定`
  if (owner && !isOpaquePeerLabel(owner)) return `${name} 已绑定 ${owner}`
  return `${name} 已绑定`
}

export function saveActionLabel(args: { bound: boolean; dirty: boolean; writing: boolean }): string {
  if (args.writing) return '正在保存…'
  if (!args.bound) return '保存并连接'
  if (!args.dirty) return '已连接'
  return '保存'
}
