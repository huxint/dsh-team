import { useEffect, useId, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MemberAvatar } from './MemberAvatar.tsx'
import type { TeamInjected, TeamPanelState } from './TeamStage.tsx'
import { IconTeam16 } from './icons.tsx'
import theme from './TeamStage.module.css'
import css from './TeamChat.module.css'

export type TeamPresenceProps = PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'team'>
  & TeamInjected
  & {
    readonly useTeam: SnapshotSelectorHook<TeamPanelState>
  }

export function TeamPresence(props: TeamPresenceProps) {
  const state = props.useTeam(snapshot => snapshot)
  if (state.leaderId === undefined || state.members.length === 0) return null
  return <PresenceRoster key={state.leaderId} {...props} state={state as TeamPanelState & { leaderId: string }} />
}

function PresenceRoster(props: TeamPresenceProps & { readonly state: TeamPanelState & { leaderId: string } }) {
  const { state, useSessions, openLeader, openMember, t } = props
  const sessions = useSessions(snapshot => snapshot.byId)
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const { leaderId, currentId, members, tasks, messages } = state
  const roster = [
    { id: leaderId, name: t('member.leader'), role: '', seat: -1 },
    ...members.map((member, seat) => ({ id: member.memberId, name: member.name, role: member.role ?? '', seat })),
  ]
  const running = (id: string): boolean => sessions[id as SessionId]?.running === true
  const busy = roster.filter(member => running(member.id)).length
  const done = tasks.filter(task => task.status === 'done').length

  useEffect(() => {
    if (!expanded) return
    close.current?.focus({ preventScroll: true })
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setExpanded(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('pointerdown', outside) }
  }, [expanded])

  const dismiss = (): void => {
    setExpanded(false)
    toggle.current?.focus({ preventScroll: true })
  }
  const open = (id: string): void => {
    setExpanded(false)
    if (id === leaderId) openLeader(leaderId)
    else openMember(leaderId, id)
  }
  const workOf = (id: string): string => {
    const active = tasks.find(task => task.assigneeId === id && task.status === 'active')
      ?? tasks.find(task => task.assigneeId === id && task.status === 'pending')
    if (active !== undefined) return active.title
    const latest = messages.findLast(message => (message.from ?? leaderId) === id)
    return latest?.text ?? t(running(id) ? 'status.running' : 'presence.ready')
  }

  return (
    <div ref={root} className={`${theme.theme} ${css.presence}`} data-team-presence onKeyDown={event => {
      if (event.key !== 'Escape' || !expanded) return
      event.stopPropagation()
      dismiss()
    }} onBlur={event => {
      if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) setExpanded(false)
    }}>
      <div className={css.avatarStack} role="group" aria-label={t('presence.title')}>
        {roster.slice(0, 4).map(member => (
          <button
            key={member.id}
            type="button"
            className={css.stackMember}
            data-team-avatar={member.id}
            data-running={running(member.id)}
            aria-label={member.seat < 0 ? t('member.openLeader') : t('member.open', { name: member.name })}
            title={[member.name, member.role, t(running(member.id) ? 'status.running' : 'status.idle')].filter(Boolean).join(' · ')}
            onClick={() => { open(member.id) }}
          >
            <MemberAvatar seat={member.seat} name={member.name} />
            <span className={css.presenceDot} aria-hidden />
          </button>
        ))}
      </div>
      <button
        ref={toggle}
        type="button"
        className={css.presenceToggle}
        aria-label={t('presence.show', { count: roster.length })}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span>{t('presence.count', { count: roster.length })}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {expanded && (
        <section id={panelId} className={css.presencePanel} role="dialog" aria-label={t('presence.title')}>
          <header className={css.presenceHead}>
            <div>
              <strong><IconTeam16 size={16} />{t('presence.title')}</strong>
              <p>{t('stage.members', { count: roster.length })} · {busy > 0 ? t('stage.running', { count: busy }) : t('stage.idle')}</p>
            </div>
            <button ref={close} type="button" className={css.iconButton} aria-label={t('presence.close')} onClick={dismiss}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m4 4 8 8M12 4l-8 8" /></svg>
            </button>
          </header>
          <ul className={css.memberList}>
            {roster.map(member => (
              <li key={member.id}>
                <button
                  type="button"
                  className={css.memberRow}
                  data-team-member={member.id}
                  aria-current={member.id === currentId}
                  aria-label={member.seat < 0 ? t('member.openLeader') : t('member.open', { name: member.name })}
                  onClick={() => { open(member.id) }}
                >
                  <span className={css.memberPortrait}><MemberAvatar seat={member.seat} name={member.name} /></span>
                  <span className={css.memberCopy}>
                    <span className={css.memberHeading}><strong>{member.name}</strong><span>{member.role}</span></span>
                    <span className={css.memberWork} title={workOf(member.id)}>{workOf(member.id)}</span>
                  </span>
                  <span className={css.memberStatus} data-running={running(member.id)}>{t(running(member.id) ? 'status.running' : 'status.idle')}</span>
                </button>
              </li>
            ))}
          </ul>
          {tasks.length > 0 && (
            <footer className={css.presenceProgress}>
              <span>{t('presence.progress')}</span>
              <strong>{done} / {tasks.length}</strong>
              <progress value={done} max={tasks.length} aria-label={t('presence.progress')} />
            </footer>
          )}
        </section>
      )}
    </div>
  )
}
