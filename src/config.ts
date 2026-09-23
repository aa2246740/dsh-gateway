import type { Volatile } from '@deepseek-ai/cordis'

/** Wire values the settings page reads. Secrets are redacted before they arrive. */
export interface Config {
  enabled?: boolean
  /** Legacy shared workspace. Kept so existing installations do not move. */
  workspaceDir?: string
  slackWorkspaceDir?: string
  slackModel?: string
  slackReasoningEffort?: string
  slackBotToken?: string
  slackAppToken?: string
  slackOwner?: string
  feishuWorkspaceDir?: string
  feishuModel?: string
  feishuReasoningEffort?: string
  feishuAppId?: string
  feishuAppSecret?: string
  feishuOwner?: string
}

/** Host Config. Each field is a live profile reference; read it with `.get()`. */
export interface LiveConfig {
  enabled: Volatile<boolean>
  workspaceDir: Volatile<string>
  slackWorkspaceDir: Volatile<string>
  slackModel: Volatile<string>
  slackReasoningEffort: Volatile<string>
  slackBotToken: Volatile<string>
  slackAppToken: Volatile<string>
  slackOwner: Volatile<string>
  feishuWorkspaceDir: Volatile<string>
  feishuModel: Volatile<string>
  feishuReasoningEffort: Volatile<string>
  feishuAppId: Volatile<string>
  feishuAppSecret: Volatile<string>
  feishuOwner: Volatile<string>
}

export const SETTINGS_NAMESPACE = 'dsh-messaging-gateway'

export const SLACK_CREATE_APP_URL = 'https://api.slack.com/apps?new_app=1'
export const SLACK_APPS_URL = 'https://api.slack.com/apps'
export const FEISHU_OPEN_APP_URL = 'https://open.feishu.cn/app'

export function parseConfiguredModel(value: string | undefined, reasoningEffort?: string): { provider: string; model: string; reasoningEffort?: string } | undefined {
  const selected = value?.trim()
  if (!selected) return undefined
  const slash = selected.indexOf('/')
  if (slash <= 0 || slash === selected.length - 1) return undefined
  return { provider: selected.slice(0, slash), model: selected.slice(slash + 1),
    ...(reasoningEffort?.trim() ? { reasoningEffort: reasoningEffort.trim() } : {}) }
}
