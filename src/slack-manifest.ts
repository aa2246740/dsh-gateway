import { buildCatalog, slashesFromCatalog } from './host-catalog.ts'

export type SlackSlash = {
  command: string
  description: string
  should_escape: false
  url: string
  usage_hint?: string
}

export function slackManifest(slashes?: SlackSlash[]): Record<string, unknown> {
  const commands = slashes && slashes.length > 0
    ? slashes
    : slashesFromCatalog(buildCatalog([], []))
  return {
    display_information: {
      name: 'DSH',
      description: 'DeepSeek Harness on Slack. Socket Mode. Your tokens stay on your machine.',
      background_color: '#111111',
    },
    features: {
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      bot_user: {
        display_name: 'DSH',
        always_online: true,
      },
      slash_commands: commands,
    },
    oauth_config: {
      scopes: {
        bot: [
          'app_mentions:read',
          'channels:history',
          'channels:read',
          'chat:write',
          'commands',
          'files:read',
          'files:write',
          'groups:history',
          'groups:read',
          'im:history',
          'im:read',
          'im:write',
          'mpim:history',
          'mpim:read',
          'reactions:read',
          'users:read',
        ],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: [
          'app_mention',
          'message.channels',
          'message.groups',
          'message.im',
          'message.mpim',
        ],
      },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  }
}
