import type { ApprovalAnswer } from './gateway/index.ts'

/** Agent-scoped system-prompt section. Not a complete prompt; stock DSH still owns tools and persona. */
export const FEISHU_SPEAKING_CONTRACT_SECTION = 'dsh-messaging-gateway:feishu-voice'

/**
 * Product speaking contract for gateway-created Feishu sessions.
 * Written here; not Grok Bot handbook text. Desktop agents.create and Slack do not get this.
 */
export const FEISHU_SPEAKING_CONTRACT = [
  'Talk in this chat like a friend, not a helpdesk.',
  'When the user just spoke, your first visible reply is one short human sentence, then stop that message. Do not weld the briefing into it.',
  'Do not open with a tool call. Do not put thinking drafts, tool names, or internal state in the chat body.',
  'Fast questions: answer in a few words.',
  'Real work: one sentence of what you are doing. The result is a second message.',
  'Keep it short. Banter is a few words. An explanation is two or three sentences.',
  'A news roundup is at most three items, one sentence each, in that second message. No memo, headers, or numbered essay unless they asked for detail.',
  'Lead with the answer or the next step. No status-word opening.',
  'Two beats are two messages, not one welded paragraph.',
  'Tool traces stay in the session log, not the chat body.',
].join('\n')

const CJK = /[\u4e00-\u9fff]/
const PLANNING = /^(the user |i should |let me |this is a simple|i'll |i will |the assistant )/i

/** Drop leading English planning so Feishu only sees the spoken sentence. */
export function visibleChatText(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').trimStart()
  const cjk = text.search(CJK)
  if (cjk <= 0) return text
  const before = text.slice(0, cjk).trim()
  if (before.length === 0) return text.slice(cjk).trimStart()
  if (PLANNING.test(before) || /^[A-Za-z][\s\S]*[.!?]$/.test(before)) {
    return text.slice(cjk).trimStart()
  }
  return text
}

/**
 * Take finished spoken sentences off the front of `text`.
 * Chinese `。！？` end a sentence. ASCII `.!?` only count when not a decimal or URL.
 */
export function takeCompleteSentences(text: string): { parts: string[]; consumed: number } {
  const parts: string[] = []
  let start = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (ch === '。' || ch === '！' || ch === '？') {
      const part = text.slice(start, i + 1).trim()
      if (part.length > 0) parts.push(part)
      i += 1
      while (i < text.length && /\s/.test(text[i] ?? '')) i += 1
      start = i
      continue
    }
    if ((ch === '.' || ch === '!' || ch === '?') && (i + 1 >= text.length || /\s/.test(text[i + 1] ?? ''))) {
      const before = text.slice(start, i)
      if (!/https?:\/\/\S*$/i.test(before) && !/\d$/.test(before)) {
        const part = text.slice(start, i + 1).trim()
        if (part.length > 0) parts.push(part)
        i += 1
        while (i < text.length && /\s/.test(text[i] ?? '')) i += 1
        start = i
        continue
      }
    }
    i += 1
  }
  return { parts, consumed: start }
}

/**
 * First spoken sentence vs the rest of the same text.
 * Feishu sends at most this first sentence early; the rest stays one bubble.
 */
export function splitFirstSpoken(text: string): { first: string; rest: string } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { first: '', rest: '' }
  let i = 0
  while (i < trimmed.length) {
    const ch = trimmed[i] ?? ''
    if (ch === '。' || ch === '！' || ch === '？') {
      return { first: trimmed.slice(0, i + 1).trim(), rest: trimmed.slice(i + 1).trim() }
    }
    if ((ch === '.' || ch === '!' || ch === '?') && (i + 1 >= trimmed.length || /\s/.test(trimmed[i + 1] ?? ''))) {
      const before = trimmed.slice(0, i)
      if (!/https?:\/\/\S*$/i.test(before) && !/\d$/.test(before)) {
        return { first: trimmed.slice(0, i + 1).trim(), rest: trimmed.slice(i + 1).trim() }
      }
    }
    i += 1
  }
  return { first: '', rest: trimmed }
}

export function assistantChunkTextFromEvent(event: { type: string; data?: unknown }): string {
  if (event.type !== 'assistant/chunk' || event.data === null || typeof event.data !== 'object') return ''
  const chunk = (event.data as { chunk?: { type?: unknown; text?: unknown } }).chunk
  if (!chunk || chunk.type !== 'text-delta' || typeof chunk.text !== 'string') return ''
  return chunk.text
}

type SystemPromptFace = {
  section: (section: { name: string; order: number; text: string }) => unknown
  getSectionOrder?: (name: string) => number
}

type HookCtx = {
  agent?: { id?: unknown }
  get?: (name: string) => unknown
  inject?: (deps: string[], fn: (ctx: HookCtx) => void) => unknown
  on?: (event: string, listener: (...args: never[]) => unknown) => unknown
  effect?: (fn: () => unknown, name?: string) => unknown
  systemPrompt?: SystemPromptFace
}

function asHook(agentCtx: object): HookCtx {
  return agentCtx as HookCtx
}

function promptOf(agentCtx: object): SystemPromptFace | undefined {
  const ctx = asHook(agentCtx)
  if (ctx.systemPrompt?.section) return ctx.systemPrompt
  const got = ctx.get?.('systemPrompt') as SystemPromptFace | undefined
  if (got?.section) return got
  return undefined
}

function attachContract(prompt: SystemPromptFace): void {
  const base = prompt.getSectionOrder?.('deployment:persona')
  const order = typeof base === 'number' && Number.isFinite(base) ? base + 50 : 50
  prompt.section({
    name: FEISHU_SPEAKING_CONTRACT_SECTION,
    order,
    text: FEISHU_SPEAKING_CONTRACT,
  })
}

/** Attach the Feishu speaking contract on this agent only. No-op when systemPrompt is missing. */
export function installFeishuSpeakingContract(agentCtx: object): void {
  const prompt = promptOf(agentCtx)
  if (prompt) {
    attachContract(prompt)
    return
  }
  asHook(agentCtx).inject?.(['systemPrompt'], scoped => {
    const inner = promptOf(scoped)
    if (inner) attachContract(inner)
  })
}

export type ApprovalHoldRequest = {
  readonly toolName?: string
  readonly callId?: string
  readonly reason?: string
  readonly signal?: AbortSignal
  readonly agent?: { readonly id?: unknown }
}

export type ApprovalHoldOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/**
 * Map this gateway's existing answers onto DSH's closed approval vocabulary.
 * Do not add allow-always or other states.
 */
export function outcomeFromAnswer(answer: ApprovalAnswer): ApprovalHoldOutcome {
  return answer === 'allow-once' ? 'allowed-once' : 'rejected'
}

/**
 * Hold one DSH approval/request until Feishu or the rest of the chain (desktop) answers.
 * First settled outcome wins.
 */
export function installFeishuApprovalHold(
  agentCtx: object,
  hold: (
    request: ApprovalHoldRequest,
    next: () => Promise<ApprovalHoldOutcome>,
  ) => Promise<ApprovalHoldOutcome>,
): void {
  const ctx = asHook(agentCtx)
  const listen = (): unknown => ctx.on?.(
    'approval/request',
    ((request: ApprovalHoldRequest, next: () => Promise<ApprovalHoldOutcome>) => hold(request, next)) as (...args: never[]) => unknown,
  )
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => listen() ?? (() => {}), 'dsh-messaging-gateway: feishu approval')
    return
  }
  listen()
}
