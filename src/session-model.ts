import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ModelPick } from './model-command.ts'

/** Read the same durable projection used by the desktop model picker. */
export function currentSessionModel(ctx: Context, id: string): ModelPick | undefined {
  const session = ctx.get('sessions')?.get(SessionId(id))
  if (!session) return undefined
  const projections = ctx.get('sessionProjections') as { stateOf(session: unknown, name: string): { pending?: ModelPick | null; lastUsed?: ModelPick | null } | undefined } | undefined
  const state = projections?.stateOf(session, 'modelSelection')
  return state?.pending ?? state?.lastUsed ?? undefined
}

/** Gateway agents can run before the desktop has opened them. No private cache. */
export function installSessionModel(ctx: Context, agent: { readonly id: unknown }): void {
  if (agent.id === undefined || agent.id === null) throw new Error('Messaging model selection requires an Agent scope')
  installModelSelection(ctx, {
    get current() {
      const pick = currentSessionModel(ctx, String(agent.id))
        ?? ctx.get('agentDefaultModel')?.currentSelection()
      return pick && { provider: pick.provider, model: pick.model,
        ...(pick.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(pick.reasoningEffort) }) }
    },
    assembled: undefined,
  })
}
