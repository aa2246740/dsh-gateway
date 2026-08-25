export type FeishuSlash = {
  command: string
  description: string
}

const FEISHU_DESC_CAP = 100

export function clampFeishuDescription(text: string): string {
  return text.slice(0, FEISHU_DESC_CAP)
}

export type FeishuRemoteSlash = {
  command_id: string
  command: string
  description?: { default_value?: string }
}

export type FeishuHttp = {
  getToken: () => Promise<string>
  list: (token: string) => Promise<FeishuRemoteSlash[]>
  create: (token: string, slash: FeishuSlash) => Promise<void>
  update: (token: string, id: string, description: string) => Promise<void>
  remove: (token: string, id: string) => Promise<void>
}

export type SlashSyncPlan = {
  create: FeishuSlash[]
  update: { id: string; description: string }[]
  remove: string[]
}

export function planFeishuSlashSync(
  desired: readonly FeishuSlash[],
  remote: readonly FeishuRemoteSlash[],
): SlashSyncPlan {
  const want = new Map(desired.map(item => [item.command, item]))
  const have = new Map(remote.map(item => [item.command, item]))
  const create: FeishuSlash[] = []
  const update: { id: string; description: string }[] = []
  const remove: string[] = []
  for (const [name, slash] of want) {
    const existing = have.get(name)
    if (!existing) {
      create.push(slash)
      continue
    }
    const current = existing.description?.default_value ?? ''
    if (current !== slash.description) update.push({ id: existing.command_id, description: slash.description })
  }
  for (const [name, item] of have) {
    if (!want.has(name)) remove.push(item.command_id)
  }
  return { create, update, remove }
}

export async function syncFeishuSlashes(
  http: FeishuHttp,
  desired: readonly FeishuSlash[],
): Promise<SlashSyncPlan> {
  const token = await http.getToken()
  const remote = await http.list(token)
  const plan = planFeishuSlashSync(desired, remote)
  for (const slash of plan.create) await http.create(token, slash)
  for (const row of plan.update) await http.update(token, row.id, row.description)
  for (const id of plan.remove) await http.remove(token, id)
  return plan
}

type FeishuJson = {
  code?: number
  msg?: string
  tenant_access_token?: string
  data?: { items?: FeishuRemoteSlash[]; command_id?: string }
}

async function feishuJson(url: string, init: RequestInit): Promise<FeishuJson> {
  const response = await fetch(url, init)
  const body = await response.json() as FeishuJson
  if (body.code !== 0 && body.code !== undefined) {
    throw new Error(body.msg || `feishu ${url} failed`)
  }
  return body
}

export function feishuSlashHttp(appId: string, appSecret: string): FeishuHttp {
  const headers = (token: string): HeadersInit => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  })
  return {
    getToken: async () => {
      const body = await feishuJson('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      })
      if (!body.tenant_access_token) throw new Error('feishu token missing')
      return body.tenant_access_token
    },
    list: async token => {
      const body = await feishuJson('https://open.feishu.cn/open-apis/application/v7/app_slash_commands', {
        method: 'GET',
        headers: headers(token),
      })
      return body.data?.items ?? []
    },
    create: async (token, slash) => {
      try {
        await feishuJson('https://open.feishu.cn/open-apis/application/v7/app_slash_commands', {
          method: 'POST',
          headers: headers(token),
          body: JSON.stringify({
            command: slash.command,
            description: {
              default_value: clampFeishuDescription(slash.description),
              i18n: {
                zh_cn: clampFeishuDescription(slash.description),
                en_us: clampFeishuDescription(slash.description),
              },
            },
            icon: { icon_key: 'skill_outlined' },
          }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/already exists/i.test(message)) throw error
      }
    },
    update: async (token, id, description) => {
      const clipped = clampFeishuDescription(description)
      await feishuJson(`https://open.feishu.cn/open-apis/application/v7/app_slash_commands/${id}`, {
        method: 'PATCH',
        headers: headers(token),
        body: JSON.stringify({
          description: {
            default_value: clipped,
            i18n: { zh_cn: clipped, en_us: clipped },
          },
        }),
      })
    },
    remove: async (token, id) => {
      await feishuJson(`https://open.feishu.cn/open-apis/application/v7/app_slash_commands/${id}`, {
        method: 'DELETE',
        headers: headers(token),
      })
    },
  }
}
