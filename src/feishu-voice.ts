import type { ApprovalAnswer } from './gateway/index.ts'

/** Agent-scoped system-prompt section. Not a complete prompt; stock DSH still owns tools and persona. */
export const FEISHU_SPEAKING_CONTRACT_SECTION = 'dsh-messaging-gateway:feishu-voice'

/**
 * Product speaking contract for Feishu-created sessions only.
 * Written here; not Grok Bot handbook text.
 */
export const FEISHU_SPEAKING_CONTRACT = [
  'Talk in this Feishu chat like a friend, not a helpdesk.',
  'Visible replies are human sentences. Do not put tool names, thinking drafts, or internal state in the chat body. Tool traces may stay in the session log.',
  'Fast questions: answer directly.',
  'Real work: one sentence of what you are doing, then continue.',
  'Results must be spoken. A working status alone is not done.',
  'Keep it short. Banter is a few words. An explanation is two or three sentences. No memo unless asked.',
  'Lead with the answer or the next step. Do not open with a status word.',
  'On long tasks, update on progress, a result, or a blocker. Do not narrate every command.',
].join('\n')

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
  const base = prompt.getSectionOrder?.('DEPLOYMENT_PERSONA')
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
