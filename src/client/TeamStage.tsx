/**
 * The agent-team stage: a conversation view tab that draws the team as a room
 * you can look into — every member has a desk of its own with its own computer
 * on it, stands where its live state puts it, and walks the floor to say
 * something to somebody else. The room is the whole tab: while the stage is on
 * screen it holds the composer seat, so nothing is left over the floor; the
 * mailbox, the shared workspace and the task board wait behind a dock of doors
 * on the right edge and open as a glass drawer over the room.
 *
 * Every value it renders is the host's own `team` projection, delivered
 * through the injected store: the browser folds nothing. Geometry comes from
 * the roster alone (no DOM measurement), so the picture is a function of the
 * durable state and nothing else.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  TeamBoardEntryView, TeamMemberView, TeamMessageView, TeamTaskStatus, TeamTaskView,
} from '../contract.ts'
import {
  IconTeam16, IconTeamLeader16, IconTeamMailbox16, IconTeamMessage16,
  IconTeamPeer16, IconTeamSend16, IconTeamTask16, IconTeamWorkspace16,
} from './icons.tsx'
import {
  breakAt, deskOf, obstaclesOf, poseFor, spread, stationFor, visitAt,
  type Desk, type Point, type Pose, type Post, type Rect, type Touch,
} from './room.ts'
import { RoomScene } from './scene/RoomScene.tsx'
import { project } from './stagecraft.ts'
import type { StationSpec } from './scene/workstation.ts'
import type { AppKind } from './scene/textures.ts'
import { useIdleErrand, useWalk, type Facing } from './walk.ts'
import {
  Crew, accentOf, gearOf, hairOf, maskOf, outfitOf, shoeOf, skinOf, toneOf,
} from './crew.tsx'
import css from './TeamStage.module.css'

/** What the plugin's session follower publishes to this entry. */
export interface TeamPanelState {
  /** The session whose log owns the team; absent while no team is in view. */
  readonly leaderId?: string
  /** The session currently open, so the stage can mark the one you are reading. */
  readonly currentId?: string
  readonly members: readonly TeamMemberView[]
  readonly tasks: readonly TeamTaskView[]
  readonly messages: readonly TeamMessageView[]
  /** The shared workspace as the leader's log last recorded it. */
  readonly board: readonly TeamBoardEntryView[]
  /** When that snapshot was taken; absent while the leader has never looked. */
  readonly boardAt?: number
}

/** Navigation and chrome the plugin body owns (it holds the client services). */
export interface TeamInjected {
  /** Open one teammate's transcript through its durable parent address. */
  readonly openMember: (leaderId: string, memberId: string) => void
  /** Return to the leader's own conversation. */
  readonly openLeader: (leaderId: string) => void
  /**
   * Take the composer seat for as long as the room is on screen; the returned
   * disposer hands it back. The room is a picture, not a place you type into,
   * and the tab is worth more than the strip of window the input card takes.
   */
  readonly holdComposer?: () => () => void
}

/** Complete view-tab props: the root kit, the locale, and the inject face. */
export type TeamStageProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<'team'>
  & TeamInjected
  & { readonly useTeam: SnapshotSelectorHook<TeamPanelState> }

type Translate = PropsLocale<'team'>['t']

/** How far back the mailbox counts as "this is what the member is doing now". */
const LIVE_MESSAGES = 4

/** How much of a message one member says out loud while it delivers it. */
const SPEECH_CHARS = 44

/** How much of a message one log row carries. */
const LOG_CHARS = 110

/** How much of a message one crew line in the feed carries. */
const CREW_CHARS = 40

/** How much text one workstation screen carries. */
const SCREEN_CHARS = 34

/** How much of an unknown session id a ledger shows. */
const SHORT_ID = 6

/** How long one delivery keeps its carrier away from its own desk. */
const ERRAND_MS = 9_000

/** The board's columns, left to right. */
const COLUMNS: readonly TeamTaskStatus[] = ['pending', 'active', 'done']

/** Join the non-empty parts of a meta line. */
function meta(...parts: (string | undefined)[]): string {
  return parts.filter(part => part !== undefined && part !== '').join(' · ')
}

/** Wall-clock hh:mm for one mailbox row. */
function clock(time: number): string {
  try {
    return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    // Swallows only a RangeError from an out-of-range logged timestamp: a
    // mailbox row must render even when its clock cannot.
    return ''
  }
}

/** The glyph one small avatar carries: the member's first character. */
function initial(name: string): string {
  return [...name][0]?.toUpperCase() ?? '?'
}

/** One line of a message, short enough to read where it is shown. */
function short(text: string, limit: number): string {
  const line = text.replace(/\s+/gu, ' ').trim()
  return [...line].length <= limit ? line : `${[...line].slice(0, limit).join('')}…`
}

/** Stagger the entry animation of a list without hard-coding per-row CSS. */
function stagger(index: number): CSSProperties {
  return { animationDelay: `${Math.min(index, 10) * 30}ms` }
}

/** The three ledgers waiting behind the dock on the right edge of the room. */
type PanelId = 'feed' | 'workspace' | 'tasks'

const APPS: readonly AppKind[] = ['code', 'chart', 'doc', 'mail', 'grid', 'term']

function appOf(seat: number): AppKind {
  return seat < 0 ? 'chart' : APPS[seat % APPS.length] ?? 'code'
}

/** A member as a tiny portrait: its own mask in its own accent. Memoized: one
 *  feed renders dozens of these, and every prop is a primitive. */
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

/**
 * The delivery currently being carried across the room. One message keeps its
 * carrier away from its own desk for a while and then lets it walk back: the
 * room shows what just happened, not the whole history at once.
 * @param latest - the newest mailbox row.
 * @returns the row while its errand is running.
 */
function useVisit(latest: TeamMessageView | undefined): TeamMessageView | undefined {
  const [live, setLive] = useState<string | undefined>(undefined)
  // A settlement is the runtime's own account of an activation ending; nobody
  // walks across the room to deliver it.
  const id = latest !== undefined && latest.kind !== 'settled' ? latest.messageId : undefined
  useEffect(() => {
    if (id === undefined) return undefined
    setLive(id)
    const timer = setTimeout(() => { setLive(undefined) }, ERRAND_MS)
    return () => { clearTimeout(timer) }
  }, [id])
  return live !== undefined && live === id ? latest : undefined
}

/**
 * The team stage. Rendered as one conversation view tab, so it exists only
 * while the surrounding session has a team — an ordinary conversation never
 * grows a tab it cannot fill.
 */
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
  // Only the per-session running bits are read, so only they are subscribed
  // to: a current-session switch elsewhere in the list re-renders nobody here.
  const sessionsById = useSessions((snapshot: SessionListState) => snapshot.byId)
  /** The member the pointer is over, anywhere on the stage. */
  const [focus, setFocus] = useState<string | undefined>(undefined)
  /** Which ledger the drawer is showing; the room stands alone by default. */
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

  /** The last thing the visible mailbox tail says about each member. */
  const touched = useMemo(() => {
    const out = new Map<string, Touch>()
    for (const message of messages.slice(-LIVE_MESSAGES)) {
      if (message.from !== undefined) out.set(message.from, message.kind === 'message' ? 'sent' : 'reported')
      if (message.to !== undefined) out.set(message.to, 'got')
    }
    return out
  }, [messages])

  /**
   * Mail counted as read: the newest delivery that had arrived when the feed
   * was last open — its identity, not the count, because a bounded feed stops
   * growing exactly when the mail keeps coming, and so does a team switch,
   * which starts the next team from a clean slate.
   */
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


  /**
   * The room's whole plan — cast, seating, standing places, and the per-member
   * reads the ledgers share — derived once per change of the facts it reads
   * instead of once per render: the stage re-renders on every hover, and every
   * consumer below holds one of these maps rather than recomputing them.
   */
  const plan = useMemo(() => {
    const names = new Map<string, string>([[leaderId, t('member.leader')]])
    for (const member of members) names.set(member.memberId, member.name)
    /** Roster seat per member id, so the ledgers can draw the same cast. */
    const seats = new Map<string, number>([[leaderId, -1]])
    members.forEach((member, index) => seats.set(member.memberId, index))

    // Open work per member, counted once: every tile, screen and crew line
    // reads this, and it used to be a full task scan per read.
    const openCounts = new Map<string, number>()
    for (const task of tasks) {
      if (task.status === 'done' || task.assigneeId === undefined) continue
      openCounts.set(task.assigneeId, (openCounts.get(task.assigneeId) ?? 0) + 1)
    }
    const openOf = (memberId: string): number => openCounts.get(memberId) ?? 0

    // The leader takes the first desk and every teammate the next, in roster
    // order — a member keeps the same desk for as long as it is on the team.
    const roster = [leaderId, ...members.map(member => member.memberId)]
    const desks = new Map<string, Desk>(roster.map((id, index) => [id, deskOf(index, roster.length)]))

    /** Where each member is standing right now: its own desk, or the break corner. */
    const homes = new Map<string, Post>()
    /** Who is away from its own desk, so the desk can be drawn empty. */
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
    // Four members on a break share three places to stand around the sofa; one
    // pass of separation keeps the fourth beside the first rather than inside it.
    const parted = spread(stations)
    roster.forEach((id, index) => {
      const post = stations[index]!
      homes.set(id, { ...post, ...parted[index]! })
    })

    /** What one member's monitor shows: its active task, or the last thing said to it. */
    const lines = new Map<string, string>()
    for (const id of roster) {
      const active = tasks.find(task => task.assigneeId === id && task.status === 'active')
        ?? tasks.find(task => task.assigneeId === id && task.status !== 'done')
      if (active !== undefined) {
        lines.set(id, short(active.title, SCREEN_CHARS))
        continue
      }
      // Scanned backwards in place: a copy-and-reverse per member is the one
      // cost this stage does not need to pay on every snapshot.
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

  /** The delivery on its feet: who carries it, to whom, and where they meet. */
  const errand = useMemo(() => errandOf(visit, leaderId, homes), [visit, leaderId, homes])
  const visitOf = (id: string): Point | undefined =>
    errand !== undefined && errand.fromId === id ? errand.meet : undefined
  /** Which way the two ends of a delivery turn while they talk. */
  const turnOf = (id: string): Facing | undefined => {
    if (errand === undefined) return undefined
    if (errand.fromId === id) return errand.meet.x < errand.host.x ? 'right' : 'left'
    if (errand.toId === id) return errand.meet.x < errand.host.x ? 'left' : 'right'
    return undefined
  }

  const toggle = (id: PanelId): void => { setPanel(current => current === id ? undefined : id) }
  const titleOf = (id: PanelId): string =>
    id === 'feed' ? t('stage.feed') : id === 'workspace' ? t('stage.workspace') : t('stage.board')

  /** One stable opener for every tile: the tiles are memoized on their props. */
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
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-panel-id="${panel}"]`)?.focus()
      setPanel(undefined)
    }}>
      <header className={css.bar}>
        <span className={css.barTitle}>
          <IconTeam16 size={15} className={css.barIcon} />
          {t('stage.title')}
        </span>
        <span className={css.barHint} title={peers.length > 1 ? t('stage.peerRing') : t('stage.roomHint')}>
          <IconTeamPeer16 size={13} />
          <span className={css.barHintText}>{peers.length > 1 ? t('stage.peerRing') : t('stage.roomHint')}</span>
        </span>
        <span className={css.barStats}>
          <span className={css.stat}>{t('stage.members', { count: members.length + 1 })}</span>
          <span className={`${css.stat} ${running.size > 0 ? css.statLive : ''}`}>
            {running.size > 0 ? t('stage.running', { count: running.size }) : t('stage.idle')}
          </span>
          {tasks.length > 0 && (
            <span className={css.stat}>{t('stage.tasks', { open: openTasks, total: tasks.length })}</span>
          )}
        </span>
      </header>

      <div className={css.scene}>
        <RoomScene label={t('stage.room')} stations={stations}>
          <div className={css.screenDescriptions}>
            {stations.map(station => (
              <span key={station.id} data-desk={station.id} data-screen={station.screen} data-empty={station.empty ? 'true' : undefined} style={{ left: `${project(station.desk).left}%`, top: `${project(station.desk).top}%` }}>
                <span data-prop="monitor" />
                <span data-prop="keyboard" />
                <span data-prop="mug" />
                <span id={`${screenPrefix}-${station.id}`} data-app={station.app}>
                  {lines.get(station.id) ?? t(station.screen === 'working' ? 'screen.working' : 'status.idle')}
                </span>
              </span>
            ))}
          </div>
          {roster.map((id, index) => tileOf(id, index - 1, members[index - 1]))}
          <div className={css.semanticFurniture} aria-hidden>
            {['window', 'whiteboard', 'clock', 'shelf', 'calendar', 'ac', 'sofa', 'table', 'plant', 'cooler', 'rug', 'treadmill', 'cabinet', 'printer', 'coffee', 'cat'].map(prop => (
              <span key={prop} data-prop={prop} />
            ))}
          </div>
        </RoomScene>

        <nav className={css.dock} aria-label={t('stage.dock')}>
          <DockButton
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
          <aside className={css.drawer} data-panel={panel} aria-label={titleOf(panel)}>
            <header className={css.drawerHead}>
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
              <button
                type="button"
                className={css.drawerClose}
                onClick={() => { setPanel(undefined) }}
                aria-label={t('drawer.close')}
              >
                ×
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
                      {board.map((entry, index) => (
                        <NoteCard
                          key={entry.key}
                          entry={entry}
                          index={index}
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

/** One door on the dock: an icon, a count of what waits behind it, a pulse for news. */
function DockButton(props: {
  readonly id: PanelId
  readonly label: string
  readonly count: number
  readonly active: boolean
  readonly fresh: boolean
  readonly onToggle: (id: PanelId) => void
  readonly children: ReactNode
}) {
  const { id, label, count, active, fresh, onToggle, children } = props
  return (
    <button
      type="button"
      className={css.dockButton}
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-expanded={active}
      data-panel-id={id}
      data-fresh={fresh ? 'true' : undefined}
      onClick={() => { onToggle(id) }}
    >
      {children}
      {count > 0 && <span className={css.dockCount}>{count > 99 ? '99+' : count}</span>}
    </button>
  )
}

/** One delivery being carried across the room. */
interface Errand {
  readonly message: TeamMessageView
  readonly fromId: string
  readonly toId: string
  /** Where the recipient is standing. */
  readonly host: Post
  /** Where the carrier stops to talk. */
  readonly meet: Point
}

/**
 * The delivery in flight as an errand between two members. Absent when either
 * end is off the roster (a dismissed sender) or when nobody had to move.
 */
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

/**
 * One member of the team, standing — or walking — where its own state puts it.
 * Memoized: the room re-renders whenever the pointer moves, and only the tile
 * under the pointer (or the one it left) has actually changed.
 */
const MemberTile = memo(function MemberTile(props: {
  readonly id: string
  readonly name: string
  readonly screenId: string
  readonly seat: number
  readonly home: Post
  /** Where a delivery has called it away to, while one is in flight. */
  readonly errand: Point | undefined
  /** How many members the room seats, so the tile knows the furniture. */
  readonly count: number
  readonly scale: number
  readonly relation: 'peer' | 'managed' | 'lead'
  readonly role: string | undefined
  readonly current: boolean
  readonly running: boolean
  readonly pose: Pose
  /** Whether the member is away from its own desk. */
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
  // The furniture only changes when the roster does, and the walk hook keys its
  // frame loop on this list: rebuilding it every render would restart the trip.
  const obstacles = useMemo(
    () => obstaclesOf(Array.from({ length: count }, (_, index) => deskOf(index, count))),
    [count],
  )
  // Somebody with nothing on their plate and nowhere to be drifts off now and
  // then. A delivery outranks a daydream, and the leader keeps its seat — the
  // first desk is the room's anchor, and a wandering host is a dropped mail.
  const loose = seat >= 0 && pose === 'idle' && errand === undefined && talking === undefined
  const wander = useIdleErrand(seat, loose)
  const spot: Point = errand ?? (loose ? wander ?? home : home)
  const walk = useWalk(home, spot, obstacles, scale, id)
  const mask = maskOf(seat)
  const outfit = outfitOf(seat)
  const shoes = shoeOf(seat)
  // At its own desk a member faces its own computer, so you see it from
  // behind; on its feet or away from its desk it turns back around.
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
      style={{
        ...accentOf(seat),
        ...stagger(seat + 1),
      }}
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
        {tasks > 0 && <span className={css.load}>{tasks}</span>}
      </span>

      <span className={css.plate}>
        <span className={css.plateName}>{name}</span>
        {(role !== undefined || relationLabel !== undefined) && (
          <span className={css.plateMeta}>{meta(role, relationLabel)}</span>
        )}
      </span>
      <span className={css.state} title={t(running ? 'status.running' : 'status.idle')}>
        <StateDot state={running ? 'ongoing' : 'done'} size={6} />
      </span>
    </button>
  )
})

/** One member's line in the roster strip: what it is doing, and its latest word. */
interface CrewRow {
  readonly id: string
  readonly name: string
  readonly seat: number
  readonly running: boolean
  readonly open: number
}

/**
 * The mailbox, as a log rather than a chat: a roster strip that keeps one
 * refreshed line per member — the newest thing it said or was told, truncated
 * so a long turn cannot push the room's cast off the pane — over the traffic
 * itself, newest last. Every member of the team writes on the same side; the
 * right-hand side belongs to the reader, and the reader does not post here.
 */
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

  // The newest traffic naming each member, and which way it went — scanned
  // once per mailbox change rather than once per crew row per render.
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

  // A new delivery is the point of the log: keep the newest row in view.
  // Keyed on the newest row's identity, not the count — a bounded feed
  // replaces its oldest row once full, and the count stops moving exactly
  // when the mail keeps coming.
  useEffect(() => {
    const node = scroller.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [lastId])

  return (
    <div className={css.feed}>
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
            {messages.map((message, index) => {
              const partner = message.from ?? message.to
              return (
                <LogRow
                  key={message.messageId}
                  message={message}
                  index={index}
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

/** One row of the log: who said what to whom, on one line, cut to fit. Memoized
 *  so a hover re-renders the row it lit and the row it unlit, nothing else. */
const LogRow = memo(function LogRow(props: {
  readonly message: TeamMessageView
  readonly index: number
  readonly names: ReadonlyMap<string, string>
  readonly seats: ReadonlyMap<string, number>
  readonly leaderLabel: string
  readonly focused: boolean
  readonly onFocus: (memberId: string | undefined) => void
  readonly t: Translate
}) {
  const { message, index, names, seats, leaderLabel, focused, onFocus, t } = props
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
      style={stagger(index)}
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

/** One note pinned to the shared workspace, as the leader last saw it. Memoized
 *  like the log rows: a hover re-renders only the note it lit. */
const NoteCard = memo(function NoteCard(props: {
  readonly entry: TeamBoardEntryView
  readonly index: number
  readonly seats: ReadonlyMap<string, number>
  readonly focused: boolean
  readonly onFocus: (memberId: string | undefined) => void
}) {
  const { entry, index, seats, focused, onFocus } = props
  return (
    <div
      className={css.note}
      data-note-key={entry.key}
      data-focus={focused ? 'true' : undefined}
      style={stagger(index)}
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

/** One lane of the shared task board. */
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
      {tasks.map((task, index) => (
        <div
          key={task.taskId}
          className={css.card}
          data-task-status={task.status}
          data-focus={task.assigneeId !== undefined && focus === task.assigneeId ? 'true' : undefined}
          style={stagger(index)}
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
