export type ModelPick = {
  provider: string
  model: string
  reasoningEffort?: string
}

export type LlmFace = {
  resolveCallConfig: (config: { provider: string; model: string }) => Promise<{
    provider: string
    model: string
    reasoningEffort?: string
  }>
  listProviders: () => { provider: string }[]
  listModels: (provider: string) => Promise<{ id: string; name?: string }[]>
}

export function parseModelLine(raw: string): { provider?: string; model: string } | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  const slash = trimmed.indexOf('/')
  if (slash > 0 && !trimmed.includes(' ')) {
    return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) }
  }
  return { model: trimmed }
}

export function formatModelStatus(pick: ModelPick | undefined): string {
  if (pick === undefined) {
    return 'This Slack session uses the DSH default model from Settings → 模型. Switch with /model provider/model'
  }
  return `This session: ${pick.provider}/${pick.model}\nSwitch with /model provider/model  (example: /model pi-openrouter/gpt-5.6)`
}

export async function resolveModelPick(
  llm: LlmFace,
  line: string,
  current: ModelPick | undefined,
): Promise<{ ok: true; pick: ModelPick } | { ok: false; text: string }> {
  const parsed = parseModelLine(line)
  if (parsed === undefined) {
    return { ok: false, text: formatModelStatus(current) }
  }
  const provider = parsed.provider ?? current?.provider
  if (provider !== undefined) {
    try {
      const resolved = await llm.resolveCallConfig({ provider, model: parsed.model })
      return { ok: true, pick: compactPick(resolved) }
    } catch (error) {
      if (parsed.provider !== undefined) {
        return { ok: false, text: error instanceof Error ? error.message : String(error) }
      }
    }
  }
  const matched = await findModel(llm, parsed.model)
  if (matched !== undefined) return { ok: true, pick: matched }
  return { ok: false, text: `Unknown model "${parsed.model}". Use /model provider/model` }
}

async function findModel(llm: LlmFace, needle: string): Promise<ModelPick | undefined> {
  const want = needle.toLowerCase()
  for (const route of llm.listProviders()) {
    let models: { id: string }[]
    try {
      models = await llm.listModels(route.provider)
    } catch {
      continue
    }
    const hit = models.find(model => model.id.toLowerCase() === want || model.id.toLowerCase().endsWith(`/${want}`))
    if (hit === undefined) continue
    try {
      const resolved = await llm.resolveCallConfig({ provider: route.provider, model: hit.id })
      return compactPick(resolved)
    } catch {
      continue
    }
  }
  return undefined
}

function compactPick(resolved: { provider: string; model: string; reasoningEffort?: string }): ModelPick {
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort },
  }
}
