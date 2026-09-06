export type ModelPick = {
  provider: string
  model: string
  reasoningEffort?: string
}

export type LlmFace = {
  resolveCallConfig: (config: ModelPick) => Promise<{
    provider: string
    model: string
    reasoningEffort?: string
  }>
  listProviders: () => { id: string }[]
  listModels: (provider: string) => Promise<{ id: string; name?: string }[]>
}

export function parseModelLine(raw: string): { provider?: string; model: string; reasoningEffort?: string } | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  const [route = '', effort, ...extra] = trimmed.split(/\s+/)
  if (extra.length) return { model: trimmed }
  const reasoning = effort && effort !== 'default' ? { reasoningEffort: effort } : {}
  const slash = route.indexOf('/')
  if (slash > 0) {
    return { provider: route.slice(0, slash), model: route.slice(slash + 1), ...reasoning }
  }
  return { model: route, ...reasoning }
}

export function formatModelStatus(pick: ModelPick | undefined): string {
  if (pick === undefined) {
    return 'This session uses the DSH default model from Settings → 模型. Switch with /model provider/model [effort]'
  }
  return `This session: ${pick.provider}/${pick.model} · reasoning: ${pick.reasoningEffort ?? 'default'}\nSwitch: /model provider/model [effort]; effort only: /model effort <level|default>`
}

export async function resolveModelPick(
  llm: LlmFace,
  line: string,
  current: ModelPick | undefined,
): Promise<{ ok: true; pick: ModelPick } | { ok: false; text: string }> {
  const effortOnly = /^effort\s+(\S+)$/.exec(line.trim())
  if (effortOnly) {
    if (!current) return { ok: false, text: 'Select a model first: /model provider/model [effort]' }
    line = `${current.provider}/${current.model} ${effortOnly[1]}`
  }
  const parsed = parseModelLine(line)
  if (parsed === undefined) {
    return { ok: false, text: formatModelStatus(current) }
  }
  const provider = parsed.provider ?? current?.provider
  if (provider !== undefined) {
    try {
      const resolved = await llm.resolveCallConfig({ provider, model: parsed.model,
        ...(parsed.reasoningEffort === undefined ? {} : { reasoningEffort: parsed.reasoningEffort }) })
      return { ok: true, pick: compactPick(resolved) }
    } catch (error) {
      if (parsed.provider !== undefined) {
        return { ok: false, text: error instanceof Error ? error.message : String(error) }
      }
    }
  }
  const matched = await findModel(llm, parsed.model, parsed.reasoningEffort)
  if (matched !== undefined) return { ok: true, pick: matched }
  return { ok: false, text: `Unknown model "${parsed.model}". Use /model provider/model` }
}

async function findModel(llm: LlmFace, needle: string, reasoningEffort?: string): Promise<ModelPick | undefined> {
  const want = needle.toLowerCase()
  for (const route of llm.listProviders()) {
    let models: { id: string }[]
    try {
      models = await llm.listModels(route.id)
    } catch {
      continue
    }
    const hit = models.find(model => model.id.toLowerCase() === want || model.id.toLowerCase().endsWith(`/${want}`))
    if (hit === undefined) continue
    try {
      const resolved = await llm.resolveCallConfig({ provider: route.id, model: hit.id,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }) })
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
