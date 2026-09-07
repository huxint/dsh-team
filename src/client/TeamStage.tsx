import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TeamBoardEntryView, TeamMemberView, TeamMessageView, TeamTaskStatus, TeamTaskView } from '../contract.ts'
import { IconTeamMailbox16, IconTeamMessage16, IconTeamSend16, IconTeamTask16, IconTeamWorkspace16 } from './icons.tsx'
import { MemberAvatar } from './MemberAvatar.tsx'
import { WorldScene } from './world/WorldScene.tsx'
import type { WorldMember } from './world/simulation.ts'
import css from './TeamStage.module.css'

/** The host’s projected team state; the client does not fold session events. */
export interface TeamPanelState {
  readonly leaderId?: string
  readonly currentId?: string
  readonly members: readonly TeamMemberView[]
  readonly tasks: readonly TeamTaskView[]
  readonly messages: readonly TeamMessageView[]
  readonly board: readonly TeamBoardEntryView[]
  /** Time of the leader’s last workspace snapshot. */
  readonly boardAt?: number
}

export interface TeamInjected {
  readonly openMember: (leaderId: string, memberId: string) => void
  readonly openLeader: (leaderId: string) => void
  /** Returns a disposer that restores the composer when this view unmounts. */
  readonly holdComposer?: () => () => void
}

export type TeamStageProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<'team'>
  & TeamInjected
  & { readonly useTeam: SnapshotSelectorHook<TeamPanelState> }

type Translate = PropsLocale<'team'>['t']

const LOG_CHARS = 110
const CREW_CHARS = 40
const SHORT_ID = 6
const COLUMNS: readonly TeamTaskStatus[] = ['pending', 'active', 'done']
type PanelId = 'feed' | 'workspace' | 'tasks'

function clock(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function short(text: string, limit: number): string {
  const line = text.replace(/\s+/gu, ' ').trim()
  return [...line].length <= limit ? line : `${[...line].slice(0, limit).join('')}…`
}

export function TeamStage(props: TeamStageProps) {
  const state = props.useTeam(snapshot => snapshot)
  const { leaderId, members } = state
  const { t, holdComposer } = props
  useEffect(() => holdComposer?.(), [holdComposer])
  if (leaderId === undefined || members.length === 0) {
    return <div className={`${css.theme} ${css.stage}`} data-agent-team-stage><p className={css.blankTitle}>{t('stage.noTeam')}</p><p className={css.blankHint}>{t('stage.noTeamHint')}</p></div>
  }
  return <TeamWorld key={leaderId} {...props} state={{ ...state, leaderId }} />
}

function TeamWorld(props: TeamStageProps & { readonly state: TeamPanelState & { leaderId: string } }) {
  const { state, useSessions, openMember, openLeader, t } = props
  const { leaderId, currentId, members, tasks, messages, board, boardAt } = state
  const drawerId = useId()
  const dock = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const sessionsById = useSessions((snapshot: SessionListState) => snapshot.byId)
  const [focus, setFocus] = useState<string>()
  const [panel, setPanel] = useState<PanelId>()
  const lastId = messages.at(-1)?.messageId
  const seen = useRef<{ leader: string | undefined; id: string | undefined }>({ leader: undefined, id: undefined })
  useEffect(() => {
    if (seen.current.leader !== leaderId || panel === 'feed') seen.current = { leader: leaderId, id: lastId }
  }, [panel, leaderId, lastId])
  const freshMail = panel !== 'feed' && seen.current.leader === leaderId && lastId !== undefined && lastId !== seen.current.id

  const plan = useMemo(() => {
    const names = new Map<string, string>([[leaderId, t('member.leader')]])
    const seats = new Map<string, number>([[leaderId, -1]])
    members.forEach((member, index) => { names.set(member.memberId, member.name); seats.set(member.memberId, index) })
    const roster = [leaderId, ...members.map(member => member.memberId)]
    const running = new Set(roster.filter(id => sessionsById[id as SessionId]?.running === true))
    const openCounts = new Map<string, number>()
    for (const task of tasks) {
      if (task.status !== 'done' && task.assigneeId) openCounts.set(task.assigneeId, (openCounts.get(task.assigneeId) ?? 0) + 1)
    }
    const openOf = (id: string): number => openCounts.get(id) ?? 0
    const worldMembers: WorldMember[] = roster.map((id, index) => {
      const member = members[index - 1]
      const task = tasks.find(task => task.assigneeId === id && task.status === 'active')
        ?? tasks.find(task => task.assigneeId === id && task.status !== 'done')
      const request = messages.findLast(message => message.to === id)
      return {
        id, name: names.get(id)!, seat: index - 1, running: running.has(id),
        task: task?.title ?? request?.text ?? t(running.has(id) ? 'screen.working' : 'world.freeTime'),
        role: member ? [member.role, member.model, member.effort, t(member.relation === 'peer' ? 'relation.peer' : 'relation.managed')].filter(Boolean).join(' · ') : t('member.leader'),
      }
    })
    return { names, seats, roster, running, openOf, worldMembers }
  }, [leaderId, members, tasks, messages, sessionsById, t])
  const { names, seats, roster, running, openOf, worldMembers } = plan
  const openTasks = tasks.filter(task => task.status !== 'done').length
  const leaderRunning = running.has(leaderId)
  const closePanel = (): void => {
    dock.current?.querySelector<HTMLButtonElement>(`[data-panel-id="${panel}"]`)?.focus()
    setFocus(undefined)
    setPanel(undefined)
  }
  const toggle = (id: PanelId): void => { setFocus(undefined); setPanel(current => current === id ? undefined : id) }
  useEffect(() => { if (panel !== undefined) closeButton.current?.focus({ preventScroll: true }) }, [panel])
  const titleOf = (id: PanelId): string => t(id === 'feed' ? 'stage.feed' : id === 'workspace' ? 'stage.workspace' : 'stage.board')
  const open = useCallback((id: string): void => {
    if (id === leaderId) openLeader(leaderId)
    else openMember(leaderId, id)
  }, [leaderId, openLeader, openMember])

  return (<div className={`${css.theme} ${css.stage}`} data-agent-team-stage onKeyDown={event => {
    if (event.key === 'Escape' && panel !== undefined) closePanel()
  }}>
    <div className={css.scene}>
      <WorldScene members={worldMembers} currentId={currentId} leaderId={leaderId} focus={focus} message={messages.at(-1)} onOpen={open} onFocus={setFocus} t={t} controls={
        <nav ref={dock} className={css.dock} aria-label={t('stage.dock')}>
          <DockButton controls={drawerId} id="feed" label={t('stage.feed')} count={messages.length} active={panel === 'feed'} fresh={freshMail} onToggle={toggle}><IconTeamMailbox16 size={15} /></DockButton>
          <DockButton controls={drawerId} id="workspace" label={t('stage.workspace')} count={board.length} active={panel === 'workspace'} fresh={false} onToggle={toggle}><IconTeamWorkspace16 size={15} /></DockButton>
          <DockButton controls={drawerId} id="tasks" label={t('stage.board')} count={openTasks} active={panel === 'tasks'} fresh={false} onToggle={toggle}><IconTeamTask16 size={15} /></DockButton>
        </nav>
      } />
        {panel !== undefined && (
          <aside id={drawerId} className={css.drawer} data-panel={panel} aria-label={titleOf(panel)}>
            <header className={css.drawerHead}>
              <div className={css.drawerHeading}>
                <h3 className={css.paneTitle}>
                  {panel === 'feed' && <IconTeamMailbox16 size={13} />}
                  {panel === 'workspace' && <IconTeamWorkspace16 size={13} />}
                  {panel === 'tasks' && <IconTeamTask16 size={13} />}
                  {titleOf(panel)}
                  {panel === 'workspace' && boardAt !== undefined && (
                    <span className={css.paneNote} title={t('stage.boardStale')}>
                      {t('stage.boardAt', { time: clock(boardAt) })}
                    </span>
                  )}
                </h3>
                <p className={css.paneHint}>{t(panel === 'feed' ? 'drawer.feedHint' : panel === 'workspace' ? 'drawer.workspaceHint' : 'drawer.tasksHint')}</p>
              </div>
              <button
                ref={closeButton}
                type="button"
                className={css.drawerClose}
                onClick={closePanel}
                aria-label={t('drawer.close')}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m4 4 8 8M12 4l-8 8" /></svg>
              </button>
            </header>
            <div className={css.drawerBody}>
              {panel === 'feed' && (
                <MessageFeed
                  roster={roster.map((id, index) => ({
                    id,
                    name: names.get(id) ?? id,
                    seat: index - 1,
                    running: index === 0 ? leaderRunning : running.has(id),
                    open: openOf(id),
                  }))}
                  messages={messages}
                  names={names}
                  seats={seats}
                  leaderLabel={t('member.leader')}
                  focus={focus}
                  onFocus={setFocus}
                  t={t}
                />
              )}
              {panel === 'workspace' && (
                board.length === 0
                  ? (
                    <>
                      <p className={css.empty}>{t('stage.noNotes')}</p>
                      <p className={css.emptyHint}>{t('stage.noNotesHint')}</p>
                    </>
                  )
                  : (
                    <div className={css.notes}>
                      {board.map(entry => (
                        <NoteCard
                          key={entry.key}
                          entry={entry}
                          seats={seats}
                          focused={focus === entry.authorId}
                          onFocus={setFocus}
                        />
                      ))}
                    </div>
                  )
              )}
              {panel === 'tasks' && (
                tasks.length === 0
                  ? <p className={css.empty}>{t('stage.noTasks')}</p>
                  : (
                    <div className={css.columns}>
                      {COLUMNS.map(status => (
                        <TaskColumn
                          key={status}
                          status={status}
                          tasks={tasks.filter(task => task.status === status)}
                          names={names}
                          seats={seats}
                          focus={focus}
                          onFocus={setFocus}
                          t={t}
                        />
                      ))}
                    </div>
                  )
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

function DockButton(props: {
  readonly id: PanelId
  readonly controls: string
  readonly label: string
  readonly count: number
  readonly active: boolean
  readonly fresh: boolean
  readonly onToggle: (id: PanelId) => void
  readonly children: ReactNode
}) {
  const { id, controls, label, count, active, fresh, onToggle, children } = props
  return (
    <button
      type="button"
      className={css.dockButton}
      aria-label={label}
      aria-pressed={active}
      aria-expanded={active}
      aria-controls={active ? controls : undefined}
      data-panel-id={id}
      data-fresh={fresh ? 'true' : undefined}
      onClick={() => { onToggle(id) }}
    >
      <span className={css.dockIcon}>{children}</span>
      <span className={css.dockLabel}>{label}</span>
      {count > 0 && <span className={css.dockCount}>{count > 99 ? '99+' : count}</span>}
    </button>
  )
}

interface CrewRow {
  readonly id: string
  readonly name: string
  readonly seat: number
  readonly running: boolean
  readonly open: number
}

function MessageFeed(props: {
  readonly roster: readonly CrewRow[]
  readonly messages: readonly TeamMessageView[]
  readonly names: ReadonlyMap<string, string>
  readonly seats: ReadonlyMap<string, number>
  readonly leaderLabel: string
  readonly focus: string | undefined
  readonly onFocus: (memberId: string | undefined) => void
  readonly t: Translate
}) {
  const { roster, messages, names, seats, leaderLabel, focus, onFocus, t } = props
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = messages.length > 0 ? messages[messages.length - 1]!.messageId : undefined

  const latestOf = useMemo(() => {
    const out = new Map<string, { readonly text: string, readonly way: 'got' | 'sent' }>()
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message === undefined) continue
      if (message.from !== undefined && !out.has(message.from)) {
        out.set(message.from, { text: message.text, way: 'sent' })
      }
      if (message.to !== undefined && !out.has(message.to)) {
        out.set(message.to, { text: message.text, way: 'got' })
      }
    }
    return out
  }, [messages])

  // Identity changes even when a full mailbox replaces a row without growing.
  useEffect(() => {
    const node = scroller.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [lastId])

  return (
    <div className={css.feed}>
      <h4 className={css.feedTitle}>{t('feed.crew')}<span>{roster.length}</span></h4>
      <div className={css.crewList} aria-label={t('feed.crew')}>
        {roster.map(row => {
          const latest = latestOf.get(row.id)
          return (
            <div
              key={row.id}
              className={css.crewRow}
              data-crew-row={row.id}
              data-focus={focus === row.id ? 'true' : undefined}
              onMouseEnter={() => { onFocus(row.id) }}
              onMouseLeave={() => { onFocus(undefined) }}
            >
              <span className={css.cameoDot} aria-hidden>
                <MemberAvatar seat={row.seat} name={row.name} />
              </span>
              <span className={css.crewName}>{row.name}</span>
              <span className={css.crewState} data-state={row.running ? 'running' : 'idle'}>
                {t(row.running ? 'status.running' : 'status.idle')}
              </span>
              {row.open > 0 && <span className={css.crewOpen}>{t('feed.open', { count: row.open })}</span>}
              <span className={css.crewLine} title={latest?.text}>
                {latest === undefined
                  ? t('feed.quiet')
                  : `${latest.way === 'got' ? '←' : '→'} ${short(latest.text, CREW_CHARS)}`}
              </span>
            </div>
          )
        })}
      </div>

      <h4 className={css.feedTitle}>{t('feed.log')}</h4>
      {messages.length === 0
        ? <p className={css.empty}>{t('stage.noMessages')}</p>
        : (
          <div className={css.log} ref={scroller}>
            {messages.map(message => {
              const partner = message.from ?? message.to
              return (
                <LogRow
                  key={message.messageId}
                  message={message}
                  names={names}
                  seats={seats}
                  leaderLabel={leaderLabel}
                  focused={partner !== undefined && focus === partner}
                  onFocus={onFocus}
                  t={t}
                />
              )
            })}
          </div>
        )}
    </div>
  )
}

const LogRow = memo(function LogRow(props: {
  readonly message: TeamMessageView
    readonly names: ReadonlyMap<string, string>
  readonly seats: ReadonlyMap<string, number>
  readonly leaderLabel: string
  readonly focused: boolean
  readonly onFocus: (memberId: string | undefined) => void
  readonly t: Translate
}) {
  const { message, names, seats, leaderLabel, focused, onFocus, t } = props
  const label = (id: string | undefined): string =>
    id === undefined ? leaderLabel : names.get(id) ?? id.slice(0, SHORT_ID)
  const partner = message.from ?? message.to
  const author = label(message.from)
  return (
    <div
      className={css.logRow}
      data-message-kind={message.kind}
      data-hop={message.hop === undefined ? undefined : String(message.hop)}
      data-focus={focused ? 'true' : undefined}
      onMouseEnter={() => { onFocus(partner) }}
      onMouseLeave={() => { onFocus(undefined) }}
    >
      <span className={css.logAvatar} aria-hidden>
        <MemberAvatar seat={message.from === undefined ? -1 : seats.get(message.from)} name={author} />
      </span>
      <div className={css.logBody}>
        <span className={css.logHead}>
          <span className={css.logAuthor}>{author}</span>
          <span className={css.logArrow}>→</span>
          <span className={css.logTo}>{label(message.to)}</span>
          {message.kind !== 'message' && (
            <span className={css.logKind}>
              {message.kind === 'report' ? t('message.report') : t('message.settled')}
            </span>
          )}
          {message.hop !== undefined && message.hop > 0 && (
            <span className={css.logHop} title={t('message.hopHint')}>
              {t('message.hop', { hop: message.hop })}
            </span>
          )}
          <span className={css.logTime}>{clock(message.time)}</span>
        </span>
        <span className={css.logText} title={message.text}>{short(message.text, LOG_CHARS)}</span>
      </div>
      <span className={css.logTail} aria-hidden>
        {message.from === undefined ? <IconTeamSend16 size={12} /> : <IconTeamMessage16 size={12} />}
      </span>
    </div>
  )
})

const NoteCard = memo(function NoteCard(props: {
  readonly entry: TeamBoardEntryView
    readonly seats: ReadonlyMap<string, number>
  readonly focused: boolean
  readonly onFocus: (memberId: string | undefined) => void
}) {
  const { entry, seats, focused, onFocus } = props
  return (
    <div
      className={css.note}
      data-note-key={entry.key}
      data-focus={focused ? 'true' : undefined}
      onMouseEnter={() => { onFocus(entry.authorId) }}
      onMouseLeave={() => { onFocus(undefined) }}
    >
      <span className={css.noteKey} title={entry.key}>{entry.key}</span>
      <span className={css.notePreview} title={entry.preview}>{entry.preview}</span>
      <span className={css.noteFoot}>
        <span className={css.noteAuthor}>
          <span className={css.cameoDot} aria-hidden>
            <MemberAvatar seat={seats.get(entry.authorId)} name={entry.authorName} />
          </span>
          {entry.authorName}
        </span>
        <span className={css.noteTime}>{clock(entry.updatedAt)}</span>
      </span>
    </div>
  )
})

function TaskColumn(props: {
  readonly status: TeamTaskStatus
  readonly tasks: readonly TeamTaskView[]
  readonly names: ReadonlyMap<string, string>
  readonly seats: ReadonlyMap<string, number>
  readonly focus: string | undefined
  readonly onFocus: (memberId: string | undefined) => void
  readonly t: Translate
}) {
  const { status, tasks, names, seats, focus, onFocus, t } = props
  const title = status === 'done' ? t('task.done') : status === 'active' ? t('task.active') : t('task.pending')
  return (
    <div className={css.column} data-column={status}>
      <h4 className={css.columnTitle}>
        {title}
        <span className={css.columnCount}>{tasks.length}</span>
      </h4>
      {tasks.map(task => (
        <div
          key={task.taskId}
          className={css.card}
          data-task-status={task.status}
          data-focus={task.assigneeId !== undefined && focus === task.assigneeId ? 'true' : undefined}
              onMouseEnter={() => { onFocus(task.assigneeId) }}
          onMouseLeave={() => { onFocus(undefined) }}
        >
          <span className={css.cardTitle} title={task.title}>{task.title}</span>
          <span className={css.cardFoot}>
            <span className={css.cardWho}>
              {task.assigneeId !== undefined && (
                <span className={css.cameoDot} aria-hidden>
                  <MemberAvatar
                    seat={seats.get(task.assigneeId)}
                    name={names.get(task.assigneeId) ?? task.assigneeId}
                  />
                </span>
              )}
              {task.assigneeId === undefined
                ? t('task.unassigned')
                : names.get(task.assigneeId) ?? task.assigneeId.slice(0, SHORT_ID)}
            </span>
            {task.note !== undefined && <span className={css.cardNote} title={task.note}>{task.note}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
