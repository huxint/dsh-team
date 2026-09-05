/**
 * The browser half's plugin body: which session's team is on screen, when the
 * view ring grows an agent-team tab, and what the stage asks the session
 * domain to open.
 *
 * The fold itself is the host's (tests/fold.spec.ts) — this file only covers
 * following, holding, contributing, and navigating.
 *
 * @module dsh-team/tests/client
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { TeamMemberView, TeamView } from '../src/contract.ts'
import { apply, type TeamPanelState } from '../src/client/index.ts'

/** A minimal observable value with the store contract the plugin reads. */
class Observable<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private value: T) {}

  getSnapshot(): T {
    return this.value
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  set(next: T): void {
    this.value = next
    for (const fn of [...this.listeners]) fn()
  }

  /** Live subscriber count, so teardown can be observed. */
  get watchers(): number {
    return this.listeners.size
  }
}

const alice: TeamMemberView = { memberId: 'child-1', name: 'Alice', relation: 'peer', joinedAt: 1 }

/** One team value as a leader session folds it. */
function teamOf(members: readonly TeamMemberView[]): TeamView {
  return { active: members.length > 0, members, tasks: [], messages: [], board: [] }
}

/** The session domain double: bindings, navigation, and the subagent catalog. */
class FakeSessions {
  readonly list = new Observable<{ current: string | undefined }>({ current: undefined })
  readonly faces = new Map<string, Observable<TeamView | undefined>>()
  readonly opened: string[] = []
  readonly openedSubagents: Array<{ parentSessionId: string; childSessionId: string; mode: string }> = []
  readonly refreshed: string[] = []
  /** Addresses the catalog already retains. */
  readonly addresses = new Map<string, { parentSessionId: string; childSessionId: string; mode: string }>()
  /** Sessions with a live binding; a published id may arrive before one. */
  readonly bound = new Set<string>()
  /** Child ids `openSubagent` refuses until the parent catalog is refreshed. */
  readonly unknownChildren = new Set<string>()

  /** Publish one session with a team value and a live binding. */
  seed(id: string, team?: TeamView): void {
    this.faces.set(id, new Observable<TeamView | undefined>(team))
    this.bound.add(id)
  }

  binding(id: string): { session: { projections: { faceOf: (key: string) => Observable<TeamView | undefined> } } } | undefined {
    if (!this.bound.has(id)) return undefined
    const face = this.faces.get(id) ?? new Observable<TeamView | undefined>(undefined)
    this.faces.set(id, face)
    return { session: { projections: { faceOf: () => face } } }
  }

  open(id: string): void {
    this.opened.push(id)
  }

  subagentAddress(id: string): { parentSessionId: string; childSessionId: string; mode: string } | undefined {
    return this.addresses.get(id)
  }

  openSubagent(address: { parentSessionId: string; childSessionId: string; mode: string }): void {
    if (this.unknownChildren.has(address.childSessionId)) throw new Error('not a healthy catalog child')
    this.openedSubagents.push(address)
  }

  async refreshSubagents(parentId: string): Promise<void> {
    this.refreshed.push(parentId)
    for (const id of [...this.unknownChildren]) this.unknownChildren.delete(id)
    await Promise.resolve()
  }
}

/** What the slot registration handed to the entry component. */
interface Injected {
  readonly hooks: { readonly team: { getSnapshot(): TeamPanelState } }
  readonly openMember: (leaderId: string, memberId: string) => void
  readonly openLeader: (leaderId: string) => void
  readonly holdComposer: () => () => void
}

/** One live `conversation.view` contribution, as the slot ledger holds it. */
interface Tab {
  readonly id: string
  readonly order: number
  readonly label: () => string
  readonly face: Injected
}

/** One live `conversation.composer` contribution: the chain entry and its rank. */
interface Seat {
  readonly priority: number
  readonly select: () => unknown
}

let sessions: FakeSessions
/** The view-ring contributions currently registered. */
let tabs: Tab[]
/** The composer-chain contributions currently registered. */
let seats: Seat[]
let teardown: () => void

/** Mount the plugin body over the doubles and watch what it contributes. */
function mount(): void {
  sessions = new FakeSessions()
  tabs = []
  seats = []
  const disposers: Array<() => void> = []
  const ctx = {
    effect: (run: () => unknown, _label: string) => {
      const disposer = run()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
    },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    sessions,
    slots: {
      inject: (_name: string, install: () => () => void) => {
        const dispose = install()
        disposers.push(dispose)
        return dispose
      },
      register: (spec: {
        name: string
        id?: string
        order?: number
        priority?: number
        label?: () => string
        select?: () => unknown
        inject?: () => Injected
      }) => {
        if (spec.name === 'conversation.composer') {
          const seat: Seat = { priority: spec.priority ?? 0, select: spec.select ?? (() => null) }
          seats.push(seat)
          return () => {
            const at = seats.indexOf(seat)
            if (at >= 0) seats.splice(at, 1)
          }
        }
        const tab: Tab = {
          id: spec.id ?? '',
          order: spec.order ?? 0,
          label: spec.label ?? (() => ''),
          face: spec.inject?.() as Injected,
        }
        tabs.push(tab)
        return () => {
          const at = tabs.indexOf(tab)
          if (at >= 0) tabs.splice(at, 1)
        }
      },
    },
  } as unknown as ClientContext

  apply(ctx)
  teardown = () => { for (const dispose of disposers.reverse()) dispose() }
}

/** The one live view tab; the plugin never contributes two. */
function tab(): Tab {
  const [only, ...rest] = tabs
  if (only === undefined) throw new Error('no agent-team view tab is registered')
  if (rest.length > 0) throw new Error(`${tabs.length} agent-team view tabs are registered`)
  return only
}

/** The panel state currently published to the entry. */
function panel(): TeamPanelState {
  return tab().face.hooks.team.getSnapshot()
}

/** Seed a leader with a team and bring it into view, so the tab exists. */
function seedTeam(): void {
  sessions.seed('leader-1', teamOf([alice]))
  sessions.list.set({ current: 'leader-1' })
}

beforeEach(() => { mount() })

describe('following the current session', () => {
  it('contributes no view tab while no session is current', () => {
    expect(tabs).toEqual([])
  })

  it('publishes the team of the session that comes into view', () => {
    sessions.seed('leader-1', teamOf([alice]))
    sessions.list.set({ current: 'leader-1' })
    expect(panel())
      .toEqual({ leaderId: 'leader-1', currentId: 'leader-1', members: [alice], tasks: [], messages: [], board: [] })
  })

  it('follows later pushes for the session on screen', () => {
    sessions.seed('leader-1', teamOf([]))
    sessions.list.set({ current: 'leader-1' })
    expect(tabs).toEqual([])

    sessions.faces.get('leader-1')!.set(teamOf([alice]))
    expect(panel().members).toEqual([alice])
  })

  it('holds the team while you read one of its teammates, moving the marker', () => {
    sessions.seed('leader-1', teamOf([alice]))
    sessions.seed('child-1', teamOf([]))
    sessions.list.set({ current: 'leader-1' })
    sessions.list.set({ current: 'child-1' })

    expect(panel()).toMatchObject({ leaderId: 'leader-1', currentId: 'child-1', members: [alice] })
  })

  it('clears when an unrelated session comes into view', () => {
    sessions.seed('leader-1', teamOf([alice]))
    sessions.seed('other', teamOf([]))
    sessions.list.set({ current: 'leader-1' })
    sessions.list.set({ current: 'other' })

    expect(tabs).toEqual([])
  })

  it('attaches later when the current id arrives before its binding', () => {
    sessions.faces.set('leader-1', new Observable<TeamView | undefined>(teamOf([alice])))
    sessions.list.set({ current: 'leader-1' })
    expect(tabs).toEqual([])

    sessions.bound.add('leader-1')
    sessions.list.set({ current: 'leader-1' })
    expect(panel().members).toEqual([alice])
  })

  it('drops every subscription and the tab when the row unloads', () => {
    seedTeam()
    expect(sessions.faces.get('leader-1')!.watchers).toBe(1)

    teardown()
    expect(sessions.list.watchers).toBe(0)
    expect(sessions.faces.get('leader-1')!.watchers).toBe(0)
    expect(tabs).toEqual([])
  })
})

describe('following the leader from inside a teammate', () => {
  const bob: TeamMemberView = { memberId: 'child-2', name: 'Bob', relation: 'managed', joinedAt: 2 }

  /** Seed a leader with a team, then go read one of its teammates. */
  function readTeammate(): void {
    seedTeam()
    sessions.seed('child-1', teamOf([]))
    sessions.list.set({ current: 'child-1' })
  }

  it('keeps the roster live: the leader is folding, the teammate is on screen', () => {
    readTeammate()
    sessions.faces.get('leader-1')!.set(teamOf([alice, bob]))
    expect(panel()).toMatchObject({ leaderId: 'leader-1', currentId: 'child-1', members: [alice, bob] })
  })

  it('closes the room, and its tab, when the leader disbands the team', () => {
    readTeammate()
    expect(panel().members).toEqual([alice])

    sessions.faces.get('leader-1')!.set(teamOf([]))
    expect(tabs).toEqual([])
  })

  it('holds what it last saw while the leader itself is unloaded', () => {
    seedTeam()
    sessions.seed('child-1', teamOf([]))
    sessions.bound.delete('leader-1')
    sessions.list.set({ current: 'child-1' })

    expect(panel()).toMatchObject({ leaderId: 'leader-1', currentId: 'child-1', members: [alice] })
  })

  it('watches the leader once, and lets go on the way back to it', () => {
    readTeammate()
    expect(sessions.faces.get('leader-1')!.watchers).toBe(1)

    sessions.list.set({ current: 'leader-1' })
    expect(sessions.faces.get('leader-1')!.watchers).toBe(1)
    expect(sessions.faces.get('child-1')!.watchers).toBe(0)
  })

  it('drops both subscriptions when the row unloads under a teammate', () => {
    readTeammate()

    teardown()
    expect(sessions.faces.get('leader-1')!.watchers).toBe(0)
    expect(sessions.faces.get('child-1')!.watchers).toBe(0)
    expect(tabs).toEqual([])
  })
})

describe('navigation', () => {
  beforeEach(() => { seedTeam() })

  it('returns to the leader conversation', () => {
    tab().face.openLeader('leader-1')
    expect(sessions.opened).toEqual(['leader-1'])
  })

  it('opens a teammate through the durable address the catalog retains', () => {
    sessions.addresses.set('child-1', { parentSessionId: 'leader-1', childSessionId: 'child-1', mode: 'continuable' })
    tab().face.openMember('leader-1', 'child-1')
    expect(sessions.openedSubagents).toEqual([
      { parentSessionId: 'leader-1', childSessionId: 'child-1', mode: 'continuable' },
    ])
  })

  it('falls back to the direct-parent address when the catalog knows none', () => {
    tab().face.openMember('leader-1', 'child-2')
    expect(sessions.openedSubagents).toEqual([
      { parentSessionId: 'leader-1', childSessionId: 'child-2', mode: 'continuable' },
    ])
  })

  it('refreshes the catalog once and retries when the child is not retained yet', async () => {
    sessions.unknownChildren.add('child-3')
    tab().face.openMember('leader-1', 'child-3')
    expect(sessions.openedSubagents).toEqual([])

    await vi.waitFor(() => { expect(sessions.openedSubagents).toHaveLength(1) })
    expect(sessions.refreshed).toEqual(['leader-1'])
  })

  it('stays put when the child is absent even after the refresh', async () => {
    sessions.unknownChildren.add('child-4')
    sessions.refreshSubagents = async (parentId: string) => {
      sessions.refreshed.push(parentId)
      await Promise.resolve()
    }
    tab().face.openMember('leader-1', 'child-4')

    await vi.waitFor(() => { expect(sessions.refreshed).toEqual(['leader-1']) })
    expect(sessions.openedSubagents).toEqual([])
  })
})

describe('the view tab', () => {
  it('appears only once the session on screen has a team', () => {
    expect(tabs).toEqual([])
    seedTeam()
    expect(tab().id).toBe('agent-team')
  })

  it('sits after the shipped views and takes its label from the dictionary', () => {
    seedTeam()
    expect(tab().order).toBeGreaterThan(10)
    expect(tab().label()).toBe('view.title')
  })

  it('withdraws itself when the team is disbanded', () => {
    seedTeam()
    sessions.faces.get('leader-1')!.set(teamOf([]))
    expect(tabs).toEqual([])
  })

  it('stays a single contribution while the team keeps changing', () => {
    seedTeam()
    sessions.faces.get('leader-1')!.set(teamOf([alice, { ...alice, memberId: 'child-2', name: 'Bob' }]))
    expect(tab().face.hooks.team.getSnapshot().members).toHaveLength(2)
  })

  it('keeps the tab while you read one of the teammates', () => {
    seedTeam()
    sessions.seed('child-1', teamOf([]))
    sessions.list.set({ current: 'child-1' })
    expect(tab().face.hooks.team.getSnapshot().currentId).toBe('child-1')
  })
})

describe('the composer seat', () => {
  beforeEach(() => { seedTeam() })

  it('leaves the composer alone until a room says it is on screen', () => {
    expect(seats).toEqual([])
  })

  it('empties the composer seat while a room holds it, and gives it back after', () => {
    const release = tab().face.holdComposer()
    expect(seats).toHaveLength(1)
    expect(seats[0]!.select()).not.toBeNull()

    release()
    expect(seats).toEqual([])
  })

  it('is tried last, so a pending takeover keeps the seat', () => {
    tab().face.holdComposer()
    expect(seats[0]!.priority).toBeGreaterThan(0)
  })

  it('holds one seat for two overlapping rooms and frees it with the last', () => {
    const first = tab().face.holdComposer()
    const second = tab().face.holdComposer()
    expect(seats).toHaveLength(1)

    first()
    expect(seats).toHaveLength(1)
    second()
    expect(seats).toEqual([])
  })

  it('ignores a disposer called twice, so the seat is not freed under a live room', () => {
    const release = tab().face.holdComposer()
    tab().face.holdComposer()
    release()
    release()
    expect(seats).toHaveLength(1)
  })

  it('gives the composer back when the row unloads', () => {
    tab().face.holdComposer()
    teardown()
    expect(seats).toEqual([])
  })
})
