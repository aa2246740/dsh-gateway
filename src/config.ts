export interface Config {
  enabled?: boolean
  workspaceDir?: string
  slackBotToken?: string
  slackAppToken?: string
  slackOwner?: string
  feishuAppId?: string
  feishuAppSecret?: string
  feishuOwner?: string
}

export const SETTINGS_NAMESPACE = 'dsh-messaging-gateway'

export const SLACK_CREATE_APP_URL = 'https://api.slack.com/apps?new_app=1'
export const SLACK_APPS_URL = 'https://api.slack.com/apps'
export const FEISHU_OPEN_APP_URL = 'https://open.feishu.cn/app'
