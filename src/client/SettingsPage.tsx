import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { FEISHU_OPEN_APP_URL, SLACK_CREATE_APP_URL, type Config } from '../config.ts'
import { bindLabel, platformBind, saveActionLabel, type AccessRow, type GroupRow } from './bind-status.ts'
import css from './SettingsPage.module.css'

export type MessagingSettingsProps = PropsRuntime<'settings.section'> & {
  scope?: SettingsScope<Config>
}

export function MessagingSettings(props: MessagingSettingsProps): ReactNode {
  if (props.scope === undefined) return null
  return <LoadedPage scope={props.scope} />
}

function LoadedPage({ scope }: { scope: SettingsScope<Config> }): ReactNode {
  const snapshot = useSyncExternalStore(
    listener => scope.subscribe(listener),
    () => scope.getSnapshot(),
    () => scope.getSnapshot(),
  )
  const [writing, setWriting] = useState(false)
  const [bot, setBot] = useState('')
  const [app, setApp] = useState('')
  const [owner, setOwner] = useState('')
  const [feishuAppId, setFeishuAppId] = useState('')
  const [feishuSecret, setFeishuSecret] = useState('')
  const [feishuOwner, setFeishuOwner] = useState('')
  const [copied, setCopied] = useState(false)
  const [live, setLive] = useState<{ access?: AccessRow[]; groups?: GroupRow[] }>({})
  const settings = snapshot.value

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      void fetch('/plugins/dsh-messaging-gateway/list')
        .then(r => r.json())
        .then((body: { access?: AccessRow[]; groups?: GroupRow[] }) => {
          if (!cancelled) setLive(body)
        })
        .catch(() => {})
    }
    tick()
    const id = window.setInterval(tick, 4000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  if (snapshot.status === 'loading' || settings === undefined) {
    return <p className={css.warn}>正在读取 Messaging 设置…</p>
  }
  if (snapshot.status === 'unavailable') {
    return <p className={css.warn}>当前连接写不了 Host 设置。用本机 DSH Web 打开设置。</p>
  }

  const slack = platformBind({
    platform: 'slack',
    ...(settings.slackOwner ? { settingsOwner: settings.slackOwner } : {}),
    ...(live.access ? { access: live.access } : {}),
    ...(live.groups ? { groups: live.groups } : {}),
  })
  const feishu = platformBind({
    platform: 'feishu',
    ...(settings.feishuOwner ? { settingsOwner: settings.feishuOwner } : {}),
    ...(live.access ? { access: live.access } : {}),
    ...(live.groups ? { groups: live.groups } : {}),
  })
  const writable = snapshot.writable && !writing
  const slackDirty = owner.length > 0 || bot.length > 0 || app.length > 0
  const feishuDirty = feishuOwner.length > 0 || feishuAppId.length > 0 || feishuSecret.length > 0
  const save = (patch: Partial<Config>) => {
    setWriting(true)
    const jobs: Promise<unknown>[] = []
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === 'string' && value.length === 0) continue
      jobs.push(scope.set(key as keyof Config, value as never))
    }
    void Promise.all(jobs).finally(() => setWriting(false))
  }

  return (
    <section className={css.page} data-mgw="settings" aria-busy={writing}>
      <h2 className={css.heading}>消息</h2>
      <p className={css.intro}>
        Slack 和飞书绑在这台 DSH 上。Computer 只挂主私信；频道 @ 在后台分房间，不进 Recents。
      </p>
      <div className={css.status}>
        <span className={css.badge} data-mgw="bind-status">
          <span className={`${css.dot}${slack.bound ? ` ${css.dotOn}` : ''}`} />
          {bindLabel('Slack', slack.bound, slack.owner)}
        </span>
        <span className={css.badge} data-mgw="feishu-bind-status">
          <span className={`${css.dot}${feishu.bound ? ` ${css.dotOn}` : ''}`} />
          {bindLabel('飞书', feishu.bound, feishu.owner)}
        </span>
      </div>

      <div className={css.block}>
        <h3 className={css.blockTitle}>Slack</h3>
        <p className={css.blockHint}>没有官方共用 bot。在你自己的 workspace 建 Socket Mode 应用，把 token 贴回来。</p>
        <details className={css.howto}>
          <summary>怎么创建 Slack 应用</summary>
          <ol className={css.steps}>
            <li>
              打开{' '}
              <a href={SLACK_CREATE_APP_URL} target="_blank" rel="noreferrer">
                Slack 创建应用（从 Manifest）
              </a>
            </li>
            <li>粘贴清单，Create，再 Install to workspace。</li>
            <li>Basic Information 复制 Bot Token（xoxb-）和 App-Level Token（xapp-，scope 含 connections:write）。</li>
            <li>点自己的头像 → Copy member ID。</li>
          </ol>
        </details>
        <label className={css.field}>
          <span className={css.label}>Member ID</span>
          <input
            className={css.input}
            data-mgw="field-owner"
            value={owner || settings.slackOwner || ''}
            onChange={event => setOwner(event.target.value)}
            placeholder="U0123456789"
            autoComplete="off"
          />
          <span className={css.hint}>你自己的 U…，不是 bot 的。</span>
        </label>
        <label className={css.field}>
          <span className={css.label}>Bot token</span>
          <input
            className={css.input}
            data-mgw="field-bot"
            type="password"
            value={bot}
            onChange={event => setBot(event.target.value)}
            placeholder="xoxb-…"
            autoComplete="off"
          />
          <span className={css.hint}>密钥不会回显。留空则保留已保存的值。</span>
        </label>
        <label className={css.field}>
          <span className={css.label}>App token</span>
          <input
            className={css.input}
            data-mgw="field-app"
            type="password"
            value={app}
            onChange={event => setApp(event.target.value)}
            placeholder="xapp-…"
            autoComplete="off"
          />
          <span className={css.hint}>Socket Mode 的 xapp- token。</span>
        </label>
        <div className={css.actions}>
          <button
            type="button"
            className={css.ghost}
            onClick={() => {
              void fetch('/plugins/dsh-messaging-gateway/slack-manifest')
                .then(r => r.text())
                .then(text => navigator.clipboard.writeText(text))
                .then(() => setCopied(true))
            }}
          >
            {copied ? '已复制 Manifest' : '复制 Manifest'}
          </button>
          <button
            type="button"
            className={css.primary}
            data-mgw="save-bind"
            disabled={!writable || (slack.bound && !slackDirty)}
            onClick={() => {
              const patch: Partial<Config> = { enabled: true }
              const nextOwner = owner || settings.slackOwner
              if (nextOwner) patch.slackOwner = nextOwner
              if (bot) patch.slackBotToken = bot
              if (app) patch.slackAppToken = app
              save(patch)
            }}
          >
            {saveActionLabel({ bound: slack.bound, dirty: slackDirty, writing })}
          </button>
        </div>
      </div>

      <div className={css.block}>
        <h3 className={css.blockTitle}>飞书</h3>
        <p className={css.blockHint}>输入 / 弹出的指令来自同一份 DSH 命令目录，注册到你自己的企业自建应用。</p>
        <details className={css.howto}>
          <summary>怎么创建飞书应用</summary>
          <ol className={css.steps}>
            <li>
              打开{' '}
              <a href={FEISHU_OPEN_APP_URL} target="_blank" rel="noreferrer">
                飞书开放平台
              </a>
              ，建企业自建应用，启用机器人。
            </li>
            <li>
              权限：application:app_slash_command:write / read、im:message.p2p_msg:readonly、im:message.group_at_msg:readonly、im:message:send_as_bot。发布一个新版本。
            </li>
            <li>事件订阅选「使用长连接接收事件」，订阅「接收消息 v2.0」。</li>
            <li>复制 App ID、App Secret，以及自己的 open_id。</li>
          </ol>
        </details>
        <label className={css.field}>
          <span className={css.label}>open_id</span>
          <input
            className={css.input}
            data-mgw="field-feishu-owner"
            value={feishuOwner || settings.feishuOwner || feishu.owner || ''}
            onChange={event => setFeishuOwner(event.target.value)}
            placeholder="ou_…"
            autoComplete="off"
          />
          <span className={css.hint}>你自己的 ou_…，不是机器人的。</span>
        </label>
        <label className={css.field}>
          <span className={css.label}>App ID</span>
          <input
            className={css.input}
            data-mgw="field-feishu-appid"
            value={feishuAppId || settings.feishuAppId || ''}
            onChange={event => setFeishuAppId(event.target.value)}
            placeholder="cli_…"
            autoComplete="off"
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>App Secret</span>
          <input
            className={css.input}
            data-mgw="field-feishu-secret"
            type="password"
            value={feishuSecret}
            onChange={event => setFeishuSecret(event.target.value)}
            placeholder="…"
            autoComplete="off"
          />
          <span className={css.hint}>密钥不会回显。留空则保留已保存的值。</span>
        </label>
        <div className={css.actions}>
          <button
            type="button"
            className={css.primary}
            data-mgw="save-feishu"
            disabled={!writable || (feishu.bound && !feishuDirty)}
            onClick={() => {
              const patch: Partial<Config> = { enabled: true }
              const nextOwner = feishuOwner || settings.feishuOwner || feishu.owner
              const nextId = feishuAppId || settings.feishuAppId
              if (nextOwner) patch.feishuOwner = nextOwner
              if (nextId) patch.feishuAppId = nextId
              if (feishuSecret) patch.feishuAppSecret = feishuSecret
              save(patch)
            }}
          >
            {saveActionLabel({ bound: feishu.bound, dirty: feishuDirty, writing })}
          </button>
        </div>
        <p className={css.note}>
          {feishu.bound
            ? '飞书已经在回消息。指令面板大约 5 分钟后出现，可重启飞书客户端加速。'
            : '保存后会拉长连接，并把 /help /model /new 等写进指令面板。'}
        </p>
      </div>
    </section>
  )
}
