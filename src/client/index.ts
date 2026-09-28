/**
 * The host's team projection drives the world, chat cards, and live roster.
 * Following the leader while a teammate transcript is open keeps all three
 * surfaces current without folding session events again in the browser.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TeamView } from '../contract.ts'
import { TeamStage, type TeamInjected, type TeamPanelState } from './TeamStage.tsx'
import { ComposerAway } from './composer.tsx'
import { TeamPresence } from './TeamPresence.tsx'
import { TEAM_TOOLS, TeamToolCard } from './TeamToolCard.tsx'
import { en, NS, zh, type TeamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent-team stage copy. */
    team: TeamKey
  }
}

/** Required services: slots, session data, locale, and UI navigation. */
export const inject = ['slots', 'sessions', 'locale', 'uiWorkspace']

/** No session in view, or a session with no team. */
const EMPTY: TeamPanelState = { members: [], tasks: [], messages: [], board: [] }

/** View-ring position: after the shipped chat and trajectory tabs. */
const VIEW_ORDER = 20

/**
 * Chain position of the empty composer: tried after everything else, so a
 * pending approval — or any other takeover — keeps the seat and the blocked
 * agent can still be answered from this tab.
 */
const COMPOSER_LAST = 100

/** Project one session's folded team value into the stage state. */
function panelState(leaderId: SessionId, currentId: SessionId, team: TeamView): TeamPanelState {
  return {
    leaderId,
    currentId,
    members: team.members,
    tasks: team.tasks,
    messages: team.messages,
    board: team.board,
    ...team.boardAt !== undefined ? { boardAt: team.boardAt } : {},
  }
}

/** Whether the state on screen names a team worth a tab of its own. */
function present(state: TeamPanelState): boolean {
  return state.leaderId !== undefined && state.members.length > 0
}

/**
 * Register the locale dictionary and the view tab, and keep the stage store
 * pointed at the right session.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-team: dictionaries')
  const t = ctx.locale.bind(NS)

  // The host `dsh-session` merge types ctx.sessions as the SessionStore; the
  // browser service is the client ISessions face (same value, other shape).
  const sessions = ctx.sessions as unknown as ISessions
  const store = createSnapshotStore<TeamPanelState>(EMPTY)

  let followed: SessionId | undefined
  let active = true
  const requested = new Set<SessionId>()

  // Projection snapshots survive released conversation bindings in dsh 0.1.7.
  // Reading them keeps the leader live without retaining its history or Agent scope.
  const readTeam = (id: SessionId): TeamView | undefined => {
    const list = sessions.list.getSnapshot()
    const snapshot = list.projectionsBySession[id]
    return (snapshot ? snapshot.values.team : list.byId[id]?.projectionValues?.team) as TeamView | undefined
  }
  const requestTeam = (id: SessionId): void => {
    if (readTeam(id) !== undefined || requested.has(id)) return
    requested.add(id)
    void sessions.refreshProjections(id).then(() => { if (active) follow() }, () => {})
  }
  const follow = (): void => {
    const list = sessions.list.getSnapshot()
    // During a navigation the new reference is acquired before the old one is
    // released. Keep the previous main view until its ownership ends.
    const current = followed !== undefined && (list.byId[followed]?.retainedBy.mainView ?? 0) > 0
      ? followed
      : Object.values(list.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
    if (followed !== current) requested.clear()
    followed = current
    if (current === undefined) { store.set(EMPTY); return }
    const team = readTeam(current)
    if (team !== undefined && team.members.length > 0) {
      const previous = store.getSnapshot()
      if (previous.currentId !== current || previous.leaderId !== current || previous.members !== team.members
        || previous.tasks !== team.tasks || previous.messages !== team.messages || previous.board !== team.board || previous.boardAt !== team.boardAt) {
        store.set(panelState(current, current, team))
      }
      return
    }
    const held = store.getSnapshot()
    const leaderId = (held.members.some(member => member.memberId === current) ? held.leaderId : undefined) as SessionId | undefined
      ?? sessions.subagentAddress(current)?.parentSessionId ?? list.byId[current]?.parentId
    const leader = leaderId === undefined ? undefined : readTeam(leaderId)
    if (leaderId !== undefined && leader?.members.some(member => member.memberId === current)) {
      if (held.currentId !== current || held.leaderId !== leaderId || held.members !== leader.members
        || held.tasks !== leader.tasks || held.messages !== leader.messages || held.board !== leader.board || held.boardAt !== leader.boardAt) {
        store.set(panelState(leaderId, current, leader))
      }
    } else if (leaderId !== undefined && leader === undefined && held.leaderId === leaderId
      && list.projectionsBySession[leaderId]?.state !== 'ready') {
      if (held.currentId !== current) store.set({ ...held, currentId: current })
    } else {
      store.set(EMPTY)
    }
    requestTeam(current)
    if (leaderId !== undefined) requestTeam(leaderId)
  }

  const disposeList = sessions.list.subscribe(follow)
  follow()
  ctx.effect(() => () => {
    active = false
    disposeList()
    requested.clear()
    store.set(EMPTY)
  }, 'dsh-team: session follower')

  /** Navigate through the UI owner; it handles reference lifetime and failures. */
  const openMember = (leaderId: string, memberId: string): void => {
    const address: SubagentAddress = sessions.subagentAddress(memberId as SessionId)
      ?? { parentSessionId: leaderId as SessionId, childSessionId: memberId as SessionId, mode: 'continuable' }
    ctx.uiWorkspace.openSession(address)
  }

  /**
   * How many stages are on screen. A view tab renders once, but the seat is
   * keyed on the count: a re-mount that overlaps its own teardown must not
   * hand the composer back under a live world.
   */
  const worlds = createSnapshotStore<number>(0)

  /** Take the composer seat for one mounted stage; the disposer gives it back. */
  const holdComposer = (): (() => void) => {
    worlds.set(worlds.getSnapshot() + 1)
    let held = true
    return () => {
      if (!held) return
      held = false
      worlds.set(Math.max(0, worlds.getSnapshot() - 1))
    }
  }

  const injectFace = (): TeamInjected & { readonly hooks: { readonly team: typeof store } } => ({
    hooks: { team: store },
    openMember,
    openLeader: (leaderId: string) => { ctx.uiWorkspace.openSession(leaderId as SessionId) },
    holdComposer,
  })

  ctx.slots.inject('tool.call.toolview', () => TEAM_TOOLS.map(tool => ctx.slots.register({
    name: 'tool.call.toolview',
    key: tool,
    locale: NS,
    inject: injectFace,
  }, TeamToolCard)))

  ctx.slots.inject('conversation.session.header.utilities', () => {
    let disposePresence: (() => void) | null = null
    const sync = (): void => {
      const wanted = present(store.getSnapshot()) && worlds.getSnapshot() === 0
      if (wanted === (disposePresence !== null)) return
      disposePresence?.()
      disposePresence = wanted ? ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'team-presence',
        order: VIEW_ORDER,
        locale: NS,
        inject: injectFace,
      }, TeamPresence) : null
    }
    sync()
    const disposeTeam = store.subscribe(sync)
    const disposeWorlds = worlds.subscribe(sync)
    return () => {
      disposeTeam()
      disposeWorlds()
      disposePresence?.()
    }
  })

  /**
   * The composer chain entry that empties the composer seat while a world is on
   * screen. Registering and withdrawing it is what re-runs the election — the
   * selector itself cannot see the active view — so the seat follows the tab
   * without the stage ever touching a node it does not own.
   */
  ctx.slots.inject('conversation.composer', () => {
    let disposeSeat: (() => void) | null = null
    const sync = (): void => {
      const wanted = worlds.getSnapshot() > 0
      if (wanted === (disposeSeat !== null)) return
      if (!wanted) {
        disposeSeat?.()
        disposeSeat = null
        return
      }
      disposeSeat = ctx.slots.register({
        name: 'conversation.composer',
        priority: COMPOSER_LAST,
        select: () => ({}),
      }, ComposerAway)
    }
    sync()
    const disposeStore = worlds.subscribe(sync)
    return () => {
      disposeStore()
      disposeSeat?.()
      disposeSeat = null
    }
  })

  /**
   * The tab follows the team, not the plugin: it is registered while a team is
   * on screen and withdrawn when the team ends, so the view ring shows an
   * agent-team tab exactly in the sessions that have one. An unknown active
   * view id falls back to chat, so withdrawing the tab under the reader is safe.
   */
  ctx.slots.inject('conversation.view', () => {
    let disposeTab: (() => void) | null = null
    const sync = (): void => {
      const wanted = present(store.getSnapshot())
      if (wanted === (disposeTab !== null)) return
      if (!wanted) {
        disposeTab?.()
        disposeTab = null
        return
      }
      disposeTab = ctx.slots.register({
        name: 'conversation.view',
        id: 'agent-team',
        order: VIEW_ORDER,
        locale: NS,
        label: () => t('view.title'),
        inject: injectFace,
      }, TeamStage)
    }
    sync()
    const disposeStore = store.subscribe(sync)
    return () => {
      disposeStore()
      disposeTab?.()
      disposeTab = null
    }
  })
}

export type { TeamPanelState }
