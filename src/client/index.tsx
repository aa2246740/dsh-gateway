import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SETTINGS_NAMESPACE, type Config } from '../config.ts'
import { MessagingSection } from './MessagingSection.tsx'
import { openListedSession, type SessionsFace } from './open-session.ts'
import { watchMessagingNavIcon } from './nav-icon.ts'
import { MessagingSettings } from './SettingsPage.tsx'

export const name = 'dsh-messaging-gateway-client'
export const inject = ['slots', 'settingsScope', 'sessions']

type ClientContext = Omit<Context, 'sessions'> & { readonly sessions: ISessions }

function sessionsFace(ctx: ClientContext): SessionsFace {
  return {
    open: id => { ctx.sessions.open(SessionId(id)) },
    list: ctx.sessions.list,
    refresh: () => ctx.sessions.refresh(),
  }
}

function openSessionOf(ctx: ClientContext): (id: string) => void {
  const sessions = sessionsFace(ctx)
  return (id: string) => {
    void openListedSession(sessions, id).then(result => {
      if (result === 'missing') {
        console.warn('[dsh-messaging-gateway] Computer has no session', id)
      }
    })
  }
}

export function apply(ctx: ClientContext) {
  const scope = ctx.settingsScope.bind<Config>({ namespace: SETTINGS_NAMESPACE })
  const openSession = openSessionOf(ctx)

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-messaging-gateway',
    order: 20,
    label: 'Messaging',
    inject: () => ({ openSession }),
  }, MessagingSection))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'messaging',
    order: 14,
    label: '消息',
    inject: () => ({ scope }),
  }, MessagingSettings))

  ctx.effect(() => watchMessagingNavIcon(), 'dsh-messaging-gateway: nav icon')
}
