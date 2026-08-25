import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { platformLabel } from '../gateway/title.ts'
import css from './MessagingSection.module.css'

type Row = {
  sessionKey: string
  hostSessionId: string | null
  title: string
  turn: string
}

type Group = {
  platform: string
  label?: string
  rows: Row[]
}

export type MessagingSectionProps = PropsRuntime<'sidebar.footer.action'> & {
  openSession: (id: string) => void
}

const STORAGE_KEY = 'dsh-messaging-gateway.platforms-open'

function readOpen(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as Record<string, boolean>
  } catch {
    return {}
  }
}

function writeOpen(open: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(open))
  } catch {
    /* ignore quota */
  }
}

export function MessagingSection({ wide, openSession }: MessagingSectionProps) {
  const [groups, setGroups] = useState<Group[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen)

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      void fetch('/plugins/dsh-messaging-gateway/list')
        .then(r => r.json())
        .then((body: { groups?: Group[] }) => {
          if (!cancelled && Array.isArray(body.groups)) setGroups(body.groups)
        })
        .catch(() => {})
    }
    tick()
    const id = window.setInterval(tick, 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => { writeOpen(open) }, [open])

  if (groups.length === 0) return null

  return (
    <div className={`${css.root}${wide ? '' : ` ${css.rail}`}`} data-mgw="dock">
      {groups.map(group => {
        const expanded = open[group.platform] === true
        const letter = group.platform.slice(0, 1).toUpperCase()
        return (
          <div key={group.platform}>
            <button
              type="button"
              className={css.header}
              data-mgw="group"
              data-platform={group.platform}
              aria-expanded={expanded}
              aria-label={group.label ?? platformLabel(group.platform)}
              onClick={() => { setOpen(s => ({ ...s, [group.platform]: !expanded })) }}
            >
              <span className={css.mark} aria-hidden>{letter}</span>
              {wide ? (
                <>
                  {expanded ? '▾' : '▸'} {group.label ?? platformLabel(group.platform)}
                </>
              ) : null}
            </button>
            {wide && expanded ? (
              <div className={css.rows}>
                {group.rows.length === 0 ? (
                  <div className={css.empty} data-mgw="empty">还没有对话</div>
                ) : group.rows.map(row => (
                  <button
                    key={row.sessionKey}
                    type="button"
                    className={css.row}
                    data-mgw="row"
                    data-session-key={row.sessionKey}
                    onClick={() => {
                      if (row.hostSessionId) openSession(row.hostSessionId)
                    }}
                  >
                    {row.title}{row.turn === 'inFlight' ? ' …' : ''}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
