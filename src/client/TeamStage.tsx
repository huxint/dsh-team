import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { } from '@deepseek-ai/dsh-client-ui-session/client'
import type { } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  TeamBoardEntryView, TeamMemberView, TeamMessageView, TeamTaskStatus, TeamTaskView,
} from '../contract.ts'
import {
  IconTeam16, IconTeamLeader16, IconTeamMailbox16, IconTeamMessage16,
  IconTeamPeer16, IconTeamSend16, IconTeamTask16, IconTeamWorkspace16,
} from './icons.tsx'
import {
  breakAt, deskOf, obstaclesOf, poseFor, spread, stationFor, visitAt,
  type Desk, type Point, type Pose, type Post, type Touch,
} from './room.ts'
import { RoomScene } from './scene/RoomScene.tsx'
import type { StationSpec } from './scene/workstation.ts'
import { appOf } from './scene/textures.ts'
import { useIdleErrand, useWalk, type Facing } from './walk.ts'
import {
  Crew, accentOf, gearOf, hairOf, maskOf, outfitOf, shoeOf, skinOf, toneOf,
} from './crew.tsx'
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

const LIVE_MESSAGES = 4

const SPEECH_CHARS = 44

const LOG_CHARS = 110

const CREW_CHARS = 40

const SCREEN_CHARS = 34

const SHORT_ID = 6

const ERRAND_MS = 9_000

const COLUMNS: readonly TeamTaskStatus[] = ['pending', 'active', 'done']

function meta(...parts: (string | undefined)[]): string {
  return parts.filter(part => part !== undefined && part !== '').join(' · ')
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function initial(name: string): string {
  return [...name][0]?.toUpperCase() ?? '?'
}

function short(text: string, limit: number): string {
  const line = text.replace(/\s+/gu, ' ').trim()
  return [...line].length <= limit ? line : `${[...line].slice(0, limit).join('')}…`
}

type PanelId = 'feed' | 'workspace' | 'tasks'

const Cameo = memo(function Cameo(props: { readonly seat: number | undefined, readonly name: string }) {
  const { seat, name } = props
  if (seat === undefined) return <span className={css.discGlyph}>{initial(name)}</span>
  return (
    <span className={css.cameo} data-cameo-species={maskOf(seat)} style={accentOf(seat)}>
      <Crew
        kind={maskOf(seat)}
        className={css.cameoCrew}
        portrait
        hair={hairOf(seat)}
        gear={gearOf(seat)}
        tone={toneOf(seat)}
        skin={skinOf(seat)}
      />
    </span>
  )
})

function useVisit(latest: TeamMessageView | undefined): TeamMessageView | undefined {
  const [live, setLive] = useState<string | undefined>(undefined)
  // Settlements describe runtime completion, so they do not start a delivery.
  const id = latest !== undefined && latest.kind !== 'settled' ? latest.messageId : undefined
  useEffect(() => {
    if (id === undefined) return undefined
    setLive(id)
    const timer = setTimeout(() => { setLive(undefined) }, ERRAND_MS)
    return () => { clearTimeout(timer) }
  }, [id])
  return live !== undefined && live === id ? latest : undefined
}

export function TeamStage(props: TeamStageProps) {
  const state = props.useTeam(snapshot => snapshot)
  const { leaderId, members } = state
  const { t, holdComposer } = props
  useEffect(() => holdComposer?.(), [holdComposer])
  if (leaderId === undefined || members.length === 0) {
    return (
      <div className={css.stage} data-agent-team-stage>
        <p className={css.blankTitle}>{t('stage.noTeam')}</p>
        <p className={css.blankHint}>{t('stage.noTeamHint')}</p>
      </div>
    )
  }

  return <TeamRoom key={leaderId} {...props} state={state as TeamPanelState & { leaderId: string }} />
}

function TeamRoom(props: TeamStageProps & { readonly state: TeamPanelState & { leaderId: string } }) {
  const { state, useSessions, openMember, openLeader, t } = props
  const screenPrefix = useId()
  const drawerId = useId()
  const dock = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const sessionsById = useSessions((snapshot: SessionListState) => snapshot.byId)
  const [focus, setFocus] = useState<string | undefined>(undefined)
  const [panel, setPanel] = useState<PanelId | undefined>(undefined)

  const { leaderId, currentId, members, tasks, messages, board, boardAt } = state
  const visit = useVisit(messages[messages.length - 1])
  const lastId = messages.length > 0 ? messages[messages.length - 1]!.messageId : undefined

  const running = useMemo(
    () => new Set(members
      .filter(member => sessionsById[member.memberId as SessionId]?.running === true)
      .map(member => member.memberId)),
    [members, sessionsById],
  )

  const touched = useMemo(() => {
    const out = new Map<string, Touch>()
    for (const message of messages.slice(-LIVE_MESSAGES)) {
      if (message.from !== undefined) out.set(message.from, message.kind === 'message' ? 'sent' : 'reported')
      if (message.to !== undefined) out.set(message.to, 'got')
    }
    return out
  }, [messages])

  // Bounded feeds replace old rows; the newest message ID remains a reliable unread marker.
  const seen = useRef<{ readonly leader: string | undefined; readonly id: string | undefined }>(
    { leader: undefined, id: undefined },
  )
  useEffect(() => {
    if (seen.current.leader !== leaderId || panel === 'feed') {
      seen.current = { leader: leaderId, id: lastId }
    }
  }, [panel, leaderId, lastId])
  const freshMail = panel !== 'feed'
    && seen.current.leader === leaderId
    && lastId !== undefined
    && lastId !== seen.current.id

  // Hover changes focus frequently; keep roster geometry and task lookups stable.
  const plan = useMemo(() => {
    const names = new Map<string, string>([[leaderId, t('member.leader')]])
    for (const member of members) names.set(member.memberId, member.name)
    const seats = new Map<string, number>([[leaderId, -1]])
    members.forEach((member, index) => seats.set(member.memberId, index))

    const openCounts = new Map<string, number>()
    for (const task of tasks) {
      if (task.status === 'done' || task.assigneeId === undefined) continue
      openCounts.set(task.assigneeId, (openCounts.get(task.assigneeId) ?? 0) + 1)
    }
    const openOf = (memberId: string): number => openCounts.get(memberId) ?? 0

    const roster = [leaderId, ...members.map(member => member.memberId)]
    const desks = new Map<string, Desk>(roster.map((id, index) => [id, deskOf(index, roster.length)]))

    const homes = new Map<string, Post>()
    const away = new Set<string>()
    const stations: Post[] = []
    let breaks = 0
    for (const id of roster) {
      const desk = desks.get(id) ?? deskOf(0, roster.length)
      const station = id === leaderId
        ? 'desk'
        : stationFor(running.has(id), touched.get(id), openOf(id))
      if (station === 'break') away.add(id)
      stations.push(station === 'break' ? breakAt(breaks++) : desk)
    }
    const parted = spread(stations)
    roster.forEach((id, index) => {
      const post = stations[index]!
      homes.set(id, { ...post, ...parted[index]! })
    })

    const lines = new Map<string, string>()
    for (const id of roster) {
      const active = tasks.find(task => task.assigneeId === id && task.status === 'active')
        ?? tasks.find(task => task.assigneeId === id && task.status !== 'done')
      if (active !== undefined) {
        lines.set(id, short(active.title, SCREEN_CHARS))
        continue
      }
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (message?.to === id) {
          lines.set(id, short(message.text, SCREEN_CHARS))
          break
        }
      }
    }
    return { names, seats, openOf, roster, desks, homes, away, lines }
  }, [leaderId, members, tasks, messages, running, touched, t])

  const { names, seats, openOf, roster, desks, homes, away, lines } = plan

  const peers = members.filter(member => member.relation === 'peer')
  const openTasks = tasks.filter(task => task.status !== 'done').length
  const leaderRunning = sessionsById[leaderId as SessionId]?.running === true

  const errand = useMemo(() => errandOf(visit, leaderId, homes), [visit, leaderId, homes])
  const visitOf = (id: string): Point | undefined =>
    errand !== undefined && errand.fromId === id ? errand.meet : undefined
  const turnOf = (id: string): Facing | undefined => {
    if (errand === undefined) return undefined
    if (errand.fromId === id) return errand.meet.x < errand.host.x ? 'right' : 'left'
    if (errand.toId === id) return errand.meet.x < errand.host.x ? 'left' : 'right'
    return undefined
  }

  const closePanel = (): void => {
    dock.current?.querySelector<HTMLButtonElement>(`[data-panel-id="${panel}"]`)?.focus()
    setFocus(undefined)
    setPanel(undefined)
  }
  const toggle = (id: PanelId): void => {
    setFocus(undefined)
    setPanel(current => current === id ? undefined : id)
  }
  useEffect(() => {
    if (panel !== undefined) closeButton.current?.focus({ preventScroll: true })
  }, [panel])
  const titleOf = (id: PanelId): string =>
    id === 'feed' ? t('stage.feed') : id === 'workspace' ? t('stage.workspace') : t('stage.board')

  const open = useCallback((id: string): void => {
    if (id === leaderId) openLeader(leaderId)
    else openMember(leaderId, id)
  }, [leaderId, openLeader, openMember])

  const stations = useMemo<readonly StationSpec[]>(() => roster.map((id, index) => {
    const seat = index - 1
    const live = seat < 0 ? leaderRunning : running.has(id)
    const pose = poseFor(live, touched.get(id), openOf(id))
    return {
      id, seat,
      desk: desks.get(id)!,
      app: appOf(seat),
      screen: pose === 'working' ? 'working' : lines.has(id) ? 'reading' : 'off',
      empty: away.has(id) || errand?.fromId === id,
    }
  }), [roster, desks, leaderRunning, running, touched, openOf, lines, away, errand?.fromId])

  const tileOf = (id: string, seat: number, member?: TeamMemberView) => {
    const desk = desks.get(id) ?? deskOf(0, roster.length)
    const home = homes.get(id) ?? desk
    const live = seat < 0 ? leaderRunning : running.has(id)
    const name = member?.name ?? t('member.leader')
    return (
      <MemberTile
        key={id}
        id={id}
        name={name}
        screenId={`${screenPrefix}-${id}`}
        seat={seat}
        home={home}
        errand={visitOf(id)}
        count={roster.length}
        scale={home.scale}
        relation={member?.relation ?? 'lead'}
        role={member?.role}
        current={currentId === id}
        running={live}
        pose={poseFor(live, touched.get(id), openOf(id))}
        away={away.has(id)}
        focused={focus === id}
        talking={errand === undefined ? undefined : errand.fromId === id ? 'from' : errand.toId === id ? 'to' : undefined}
        turn={turnOf(id)}
        speech={errand !== undefined && errand.fromId === id ? short(errand.message.text, SPEECH_CHARS) : undefined}
        tasks={openOf(id)}
        label={member === undefined ? t('member.openLeader') : t('member.open', { name })}
        title={member === undefined
          ? t('member.leader')
          : meta(
            member.name,
            member.role,
            member.model,
            member.effort,
            member.relation === 'peer' ? t('relation.peer') : t('relation.managed'),
          )}
        onOpen={open}
        onFocus={setFocus}
        t={t}
      />
    )
  }

  return (
    <div className={css.stage} data-agent-team-stage onKeyDown={event => {
      if (event.key !== 'Escape' || panel === undefined) return
      closePanel()
    }}>
      <header className={css.bar}>
        <div className={css.brand}>
          <span className={css.brandMark} aria-hidden><IconTeam16 size={22} /></span>
          <div>
            <span className={css.eyebrow}>{t('stage.eyebrow')}</span>
            <h2 className={css.barTitle}>{t('stage.title')}</h2>
          </div>
        </div>
        <span className={css.barHint} title={peers.length > 1 ? t('stage.peerRing') : t('stage.roomHint')}>
          <IconTeamPeer16 size={14} />
          <span>{peers.length > 1 ? t('stage.peerRing') : t('stage.roomHint')}</span>
        </span>
        <div className={css.barStats}>
          <span className={css.stat}><IconTeam16 size={13} />{t('stage.members', { count: members.length + 1 })}</span>
          <span className={`${css.stat} ${running.size > 0 || leaderRunning ? css.statLive : ''}`}>
            <span className={css.statDot} aria-hidden />
            {running.size > 0 || leaderRunning ? t('stage.running', { count: running.size + Number(leaderRunning) }) : t('stage.idle')}
          </span>
          {tasks.length > 0 && (
            <span className={css.stat}><IconTeamTask16 size={13} />{t('stage.tasks', { open: openTasks, total: tasks.length })}</span>
          )}
        </div>
      </header>

      <div className={css.scene}>
        <RoomScene label={t('stage.room')} hint={t('stage.sceneHint')} fallbackLabel={t('stage.rosterView')} stations={stations}>
          <div className={css.screenDescriptions}>
            {stations.map(station => (
              <span key={station.id} data-desk={station.id} data-screen={station.screen} data-empty={station.empty ? 'true' : undefined}>
                <span id={`${screenPrefix}-${station.id}`} data-app={station.app}>
                  {lines.get(station.id) ?? t(station.screen === 'working' ? 'screen.working' : 'status.idle')}
                </span>
              </span>
            ))}
          </div>
          {roster.map((id, index) => tileOf(id, index - 1, members[index - 1]))}
        </RoomScene>

        <nav ref={dock} className={css.dock} aria-label={t('stage.dock')}>
          <DockButton
            controls={drawerId}
            id="feed"
            label={t('stage.feed')}
            count={messages.length}
            active={panel === 'feed'}
            fresh={freshMail}
            onToggle={toggle}
          >
            <IconTeamMailbox16 size={15} />
          </DockButton>
          <DockButton
            controls={drawerId}
            id="workspace"
            label={t('stage.workspace')}
            count={board.length}
            active={panel === 'workspace'}
            fresh={false}
            onToggle={toggle}
          >
            <IconTeamWorkspace16 size={15} />
          </DockButton>
          <DockButton
            controls={drawerId}
            id="tasks"
            label={t('stage.board')}
            count={openTasks}
            active={panel === 'tasks'}
            fresh={false}
            onToggle={toggle}
          >
            <IconTeamTask16 size={15} />
          </DockButton>
        </nav>

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
      title={label}
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

interface Errand {
  readonly message: TeamMessageView
  readonly fromId: string
  readonly toId: string
  readonly host: Post
  readonly meet: Point
}

function errandOf(
  message: TeamMessageView | undefined,
  leaderId: string,
  homes: ReadonlyMap<string, Post>,
): Errand | undefined {
  if (message === undefined) return undefined
  const fromId = message.from ?? leaderId
  const toId = message.to ?? leaderId
  const from = homes.get(fromId)
  const host = homes.get(toId)
  if (from === undefined || host === undefined || fromId === toId) return undefined
  return { message, fromId, toId, host, meet: visitAt(host, from.x) }
}

const MemberTile = memo(function MemberTile(props: {
  readonly id: string
  readonly name: string
  readonly screenId: string
  readonly seat: number
  readonly home: Post
  readonly errand: Point | undefined
  readonly count: number
  readonly scale: number
  readonly relation: 'peer' | 'managed' | 'lead'
  readonly role: string | undefined
  readonly current: boolean
  readonly running: boolean
  readonly pose: Pose
  readonly away: boolean
  readonly focused: boolean
  readonly talking: 'from' | 'to' | undefined
  readonly turn: Facing | undefined
  readonly speech: string | undefined
  readonly tasks: number
  readonly label: string
  readonly title: string
  readonly onOpen: (id: string) => void
  readonly onFocus: (memberId: string | undefined) => void
  readonly t: Translate
}) {
  const {
    id, name, screenId, seat, home, errand, count, scale, relation, role, current, running, pose, away,
    focused, talking, turn, speech, tasks, label, title, onOpen, onFocus, t,
  } = props
  const obstacles = useMemo(
    () => obstaclesOf(Array.from({ length: count }, (_, index) => deskOf(index, count))),
    [count],
  )
  // The leader stays at its desk so deliveries have a stationary destination.
  const loose = seat >= 0 && pose === 'idle' && errand === undefined && talking === undefined
  const wander = useIdleErrand(seat, loose)
  const spot: Point = errand ?? (loose ? wander ?? home : home)
  const walk = useWalk(home, spot, obstacles, scale, id)
  const mask = maskOf(seat)
  const outfit = outfitOf(seat)
  const shoes = shoeOf(seat)
  const seated = !walk.walking && !away && talking === undefined && wander === undefined
  const facing = walk.walking ? walk.facing : turn ?? (seated ? 'back' : 'front')
  const relationLabel = relation === 'lead'
    ? undefined
    : relation === 'peer' ? t('relation.peer') : t('relation.managed')
  return (
    <button
      type="button"
      ref={walk.ref}
      className={css.person}
      style={accentOf(seat)}
      onClick={() => { onOpen(id) }}
      onMouseEnter={() => { onFocus(id) }}
      onMouseLeave={() => { onFocus(undefined) }}
      onFocus={() => { onFocus(id) }}
      onBlur={() => { onFocus(undefined) }}
      aria-label={label}
      aria-current={current}
      aria-describedby={screenId}
      title={title}
      data-member={id}
      data-relation={relation}
      data-species={mask}
      data-pose={pose}
      data-away={away ? 'true' : undefined}
      data-walk={walk.walking ? 'true' : undefined}
      data-facing={facing}
      data-running={running ? 'true' : undefined}
      data-focus={focused ? 'true' : undefined}
      data-talking={talking}
    >
      {speech !== undefined && !walk.walking && (
        <span className={css.speech} data-speech={id}>{speech}</span>
      )}
      {talking === 'to' && !walk.walking && <span className={css.listening} aria-hidden>···</span>}
      {pose === 'idle' && !away && talking === undefined && <span className={css.doze} aria-hidden>zZ</span>}

      <span className={css.body}>
        <Crew
          kind={mask}
          back={facing === 'back' || facing === 'away'}
          outfit={outfit}
          shoes={shoes}
          hair={hairOf(seat)}
          gear={gearOf(seat)}
          tone={toneOf(seat)}
          skin={skinOf(seat)}
          className={css.figure}
        />
        {relation === 'lead' && (
          <span className={css.crown} aria-hidden>
            <IconTeamLeader16 size={12} />
          </span>
        )}
        {tasks > 0 && <span className={css.load} title={t('feed.open', { count: tasks })}>{tasks}</span>}
      </span>

      <span className={css.plate}>
        <span className={css.plateName}>
          <span className={css.state} title={t(running ? 'status.running' : 'status.idle')}>
            <StateDot state={running ? 'ongoing' : 'done'} size={7} />
          </span>
          <span className={css.plateText}>{name}</span>
        </span>
        {(role !== undefined || relationLabel !== undefined) && (
          <span className={css.plateMeta}>{meta(role, relationLabel)}</span>
        )}
      </span>
    </button>
  )
})

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
                <Cameo seat={row.seat} name={row.name} />
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
        <Cameo seat={message.from === undefined ? -1 : seats.get(message.from)} name={author} />
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
            <Cameo seat={seats.get(entry.authorId)} name={entry.authorName} />
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
                  <Cameo
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
