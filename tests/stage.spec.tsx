/**
 * The agent-team stage: the room it seats, the walk one member takes to
 * deliver a message, the ledgers behind the dock, and what it asks the plugin
 * body to open — and to hold.
 *
 * @vitest-environment jsdom
 * @module dsh-team/tests/stage
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TeamBoardEntryView, TeamMemberView, TeamMessageView, TeamTaskView } from '../src/contract.ts'
import { TeamStage, type TeamStageProps, type TeamPanelState } from '../src/client/TeamStage.tsx'
import { en, type TeamKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** The dictionary lookup the slot framework injects, over the real copy. */
function translate(key: TeamKey, params?: Record<string, string | number>): string {
  const text = en[key]
  return params === undefined
    ? text
    : Object.entries(params).reduce((line, [name, value]) => line.replaceAll(`{${name}}`, String(value)), text)
}

/** A session-list snapshot with the named sessions marked running. */
function sessions(running: readonly string[] = []): SessionListState {
  const byId = Object.fromEntries(running.map(id => [id, { id, running: true }]))
  return { ids: [], byId, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {} } as unknown as SessionListState
}

const alice: TeamMemberView = {
  memberId: 'child-1', name: 'Alice', role: 'reviewer', relation: 'peer',
  model: 'reasoner', effort: 'high', joinedAt: 1,
}
const bob: TeamMemberView = { memberId: 'child-2', name: 'Bob', relation: 'managed', joinedAt: 2 }
const carol: TeamMemberView = { memberId: 'child-3', name: 'Carol', relation: 'peer', joinedAt: 3 }

interface MountOptions {
  readonly running?: readonly string[]
  readonly openMember?: (leaderId: string, memberId: string) => void
  readonly openLeader?: (leaderId: string) => void
  readonly holdComposer?: () => () => void
}

/** Build the stage element over one panel state; kept apart so a test can rerender. */
function element(state: Partial<TeamPanelState>, options: MountOptions = {}) {
  const panel: TeamPanelState = { members: [], tasks: [], messages: [], board: [], ...state } as TeamPanelState
  const props = {
    useTeam: (select: (snapshot: TeamPanelState) => unknown) => select(panel),
    useSessions: (select: (snapshot: SessionListState) => unknown) => select(sessions(options.running)),
    openMember: options.openMember ?? (() => {}),
    openLeader: options.openLeader ?? (() => {}),
    ...options.holdComposer === undefined ? {} : { holdComposer: options.holdComposer },
    t: translate,
  } as unknown as TeamStageProps
  return <TeamStage {...props} />
}

/** Mount the stage over one panel state. */
function mount(state: Partial<TeamPanelState>, options: MountOptions = {}) {
  return render(element(state, options))
}

/** Mount a full two-teammate team. */
function stage(state: Partial<TeamPanelState> = {}, options: MountOptions = {}) {
  return mount({ leaderId: 'leader-1', currentId: 'leader-1', members: [alice, bob], ...state }, options)
}

/** Open one ledger from the dock on the right edge of the room. */
function openPanel(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

/** One member of the crew, wherever it is standing. */
function person(container: HTMLElement, memberId: string): HTMLElement | null {
  return container.querySelector(`[data-member="${memberId}"]`)
}

/** One member's own workstation. */
function desk(container: HTMLElement, memberId: string): HTMLElement | null {
  return container.querySelector(`[data-desk="${memberId}"]`)
}

describe('presence', () => {
  it('says the session has no team rather than drawing an empty one', () => {
    mount({})
    expect(screen.getByText(en['stage.noTeam'])).toBeTruthy()
    expect(screen.queryByLabelText(en['member.openLeader'])).toBeNull()
  })

  it('treats a leader with an empty roster as no team', () => {
    mount({ leaderId: 'leader-1', members: [] })
    expect(screen.getByText(en['stage.noTeam'])).toBeTruthy()
  })

  it('counts the leader into the roster and reports an all-idle team', () => {
    stage()
    expect(screen.getByText('3 members')).toBeTruthy()
    expect(screen.getByText(en['stage.idle'])).toBeTruthy()
  })

  it('reports the members that are mid-turn', () => {
    stage({}, { running: ['child-1'] })
    expect(screen.getByText('1 working')).toBeTruthy()
  })

  it('includes a working leader in the working-member count', () => {
    stage({}, { running: ['leader-1', 'child-1'] })
    expect(screen.getByText('2 working').textContent).toBe('2 working')
  })

  it('counts the open tasks against the whole list', () => {
    stage({ tasks: [{ taskId: 't1', title: 'a', status: 'done' }, { taskId: 't2', title: 'b', status: 'active' }] })
    expect(screen.getByText('1/2 tasks')).toBeTruthy()
  })
})

describe('the composer seat', () => {
  it('holds the composer for as long as the room is on screen, then hands it back', () => {
    const release = vi.fn()
    const holdComposer = vi.fn(() => release)
    const view = stage({}, { holdComposer })
    expect(holdComposer).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()

    view.unmount()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('renders without one: the seat belongs to the plugin body, not to the stage', () => {
    expect(() => stage()).not.toThrow()
  })
})

describe('the room', () => {
  it('seats the leader and every teammate on the floor', () => {
    stage()
    expect(screen.getByLabelText(en['member.openLeader'])).toBeTruthy()
    expect(screen.getByLabelText('Open the session of Alice')).toBeTruthy()
    expect(screen.getByLabelText('Open the session of Bob')).toBeTruthy()
  })

  it('describes each member’s current work through its accessible screen text', () => {
    const { container } = stage({
      tasks: [{ taskId: 't1', title: 'Review the authentication boundary', assigneeId: 'child-1', status: 'active' }],
    })
    const member = screen.getByLabelText('Open the session of Alice')
    const description = container.querySelector(`[id="${member.getAttribute('aria-describedby')}"]`)
    expect(description?.textContent).toBe('Review the authentication boundary')
  })

  it('puts a preset picture on a screen, and switches an idle one off', () => {
    const { container } = stage({}, { running: ['child-1'] })
    const busy = desk(container, 'child-1')
    expect(busy?.getAttribute('data-screen')).toBe('working')
    expect(busy?.querySelector('[data-app]')).toBeTruthy()
    expect(desk(container, 'child-2')?.getAttribute('data-screen')).toBe('off')
  })

  it('gives neighbouring seats different pictures to work from', () => {
    const { container } = stage(
      { members: [alice, bob, carol] },
      { running: ['child-1', 'child-2', 'child-3'] },
    )
    const apps = ['child-1', 'child-2', 'child-3']
      .map(id => desk(container, id)?.querySelector('[data-app]')?.getAttribute('data-app'))
    expect(new Set(apps).size).toBe(3)
  })

  it('puts what a member was asked on its own screen', () => {
    const { container } = stage({
      messages: [{ messageId: 'm1', to: 'child-1', kind: 'message', text: 'review the diff', time: 1 }],
    })
    expect(desk(container, 'child-1')?.textContent).toContain('review the diff')
  })

  it('reads the pose of every member off its own live state', () => {
    const { container } = stage({
      tasks: [{ taskId: 't1', title: 'review', assigneeId: 'child-2', status: 'active' }],
    }, { running: ['child-1'] })
    expect(person(container, 'child-1')?.getAttribute('data-pose')).toBe('working')
    expect(person(container, 'child-2')?.getAttribute('data-pose')).toBe('reading')
    expect(person(container, 'leader-1')?.getAttribute('data-pose')).toBe('idle')
  })

  it('sits every member down facing its own screen, back to the room', () => {
    const { container } = stage()
    for (const id of ['leader-1', 'child-1', 'child-2']) {
      const seated = person(container, id)
      expect(seated?.getAttribute('data-facing'), id).toBe('back')
      expect(seated?.querySelector('[data-back="true"]'), id).toBeTruthy()
    }
  })

  it('turns a member around once it is off its own chair', () => {
    vi.useFakeTimers()
    try {
      const { container } = stage({
        messages: [{ messageId: 'm1', from: 'child-1', kind: 'report', text: 'done', time: 1 }],
      })
      // On its feet it faces the room even mid-walk; the figure shows a face,
      // never a back of head.
      const away = person(container, 'child-1')
      expect(away?.getAttribute('data-walk')).toBe('true')
      expect(away?.querySelector('[data-back="true"]')).toBeNull()

      // Once it arrives it turns to face the leader it is reporting to.
      act(() => { vi.advanceTimersByTime(4_000) })
      expect(away?.getAttribute('data-walk')).toBeNull()
      expect(['left', 'right']).toContain(away?.getAttribute('data-facing'))
      expect(away?.getAttribute('data-talking')).toBe('from')
      // The one still at its desk keeps its back to you.
      expect(person(container, 'child-2')?.getAttribute('data-facing')).toBe('back')
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a member that has delivered and owns nothing leave its desk', () => {
    const { container } = stage({
      messages: [{ messageId: 'm1', from: 'child-1', kind: 'report', text: 'done', time: 1 }],
    })
    expect(person(container, 'child-1')?.getAttribute('data-away')).toBe('true')
    expect(person(container, 'child-2')?.getAttribute('data-away')).toBeNull()
    // Its own desk keeps standing there, with its own computer on it.
    expect(desk(container, 'child-1')?.getAttribute('data-empty')).toBe('true')
  })

  it('keeps a member that still owns open work at its desk', () => {
    const { container } = stage({
      messages: [{ messageId: 'm1', from: 'child-1', kind: 'report', text: 'done', time: 1 }],
      tasks: [{ taskId: 't1', title: 'review', assigneeId: 'child-1', status: 'active' }],
    })
    expect(person(container, 'child-1')?.getAttribute('data-away')).toBeNull()
  })

  it('gives every seat its own mask', () => {
    const { container } = stage({ members: [alice, bob, carol] })
    const masks = ['leader-1', 'child-1', 'child-2', 'child-3']
      .map(id => person(container, id)?.getAttribute('data-species'))
    expect(masks.every(mask => mask !== null && mask !== undefined)).toBe(true)
    expect(new Set(masks).size).toBe(4)
  })

  it('carries each relation on the member itself', () => {
    const { container } = stage()
    expect(person(container, 'leader-1')?.getAttribute('data-relation')).toBe('lead')
    expect(person(container, 'child-1')?.getAttribute('data-relation')).toBe('peer')
    expect(person(container, 'child-2')?.getAttribute('data-relation')).toBe('managed')
  })

  it('names the peer channel only once two members can use it', () => {
    stage()
    expect(screen.getByText(en['stage.roomHint'])).toBeTruthy()
    expect(screen.queryByText(en['stage.peerRing'])).toBeNull()

    cleanup()
    stage({ members: [alice, bob, carol] })
    expect(screen.getByText(en['stage.peerRing'])).toBeTruthy()
  })

  it('shows the route a teammate was spawned with, and its role beside it', () => {
    stage()
    expect(screen.getByText('reviewer · Peer')).toBeTruthy()
    expect(screen.getByLabelText('Open the session of Alice').getAttribute('title'))
      .toBe('Alice · reviewer · reasoner · high · Peer')
  })

  it('carries the open work of one member on its own tile', () => {
    stage({
      tasks: [
        { taskId: 't1', title: 'review', assigneeId: 'child-1', status: 'active' },
        { taskId: 't2', title: 'ship', assigneeId: 'child-1', status: 'done' },
      ],
    })
    expect(screen.getByLabelText('Open the session of Alice').textContent).toContain('1')
  })

  it('marks the transcript you are reading', () => {
    stage({ currentId: 'child-1' })
    expect(screen.getByLabelText('Open the session of Alice').getAttribute('aria-current')).toBe('true')
    expect(screen.getByLabelText(en['member.openLeader']).getAttribute('aria-current')).toBe('false')
  })

  it('opens a teammate transcript and returns to the leader', () => {
    const openMember = vi.fn()
    const openLeader = vi.fn()
    stage({}, { openMember, openLeader })
    fireEvent.click(screen.getByLabelText('Open the session of Alice'))
    expect(openMember).toHaveBeenCalledWith('leader-1', 'child-1')
    fireEvent.click(screen.getByLabelText(en['member.openLeader']))
    expect(openLeader).toHaveBeenCalledWith('leader-1')
  })
})

describe('the delivery', () => {
  const carried: readonly TeamMessageView[] = [
    { messageId: 'm1', to: 'child-1', kind: 'message', text: 'first', time: 1 },
    { messageId: 'm2', from: 'child-1', to: 'child-2', kind: 'message', text: 'take the second half', time: 2 },
  ]

  /** Where one member is standing, as the style the room places it with. */
  function spot(container: HTMLElement, memberId: string): string {
    const node = person(container, memberId)
    return `${node?.style.left ?? ''},${node?.style.top ?? ''}`
  }

  it('walks the sender itself over: there is one of each member, never a copy', () => {
    const { container } = stage({ messages: carried })
    expect(container.querySelectorAll('[data-member="child-1"]')).toHaveLength(1)
    expect(person(container, 'child-1')?.getAttribute('data-talking')).toBe('from')
    expect(person(container, 'child-2')?.getAttribute('data-talking')).toBe('to')
  })

  it('leaves the sender its own desk to come back to', () => {
    vi.useFakeTimers()
    try {
      const { container } = stage({ messages: carried })
      const home = spot(container, 'child-1')
      act(() => { vi.advanceTimersByTime(3_000) })
      const visiting = spot(container, 'child-1')
      expect(visiting).not.toBe(home)
      expect(person(container, 'child-1')?.getAttribute('data-walk')).toBeNull()

      // The errand ends, and the member walks back to the desk it came from.
      act(() => { vi.advanceTimersByTime(12_000) })
      act(() => { vi.advanceTimersByTime(3_000) })
      expect(spot(container, 'child-1')).toBe(home)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says its piece once it gets there, short enough to read', () => {
    vi.useFakeTimers()
    try {
      const { container } = stage({ messages: carried })
      expect(container.querySelector('[data-speech]')).toBeNull()

      act(() => { vi.advanceTimersByTime(3_000) })
      const said = container.querySelector('[data-speech="child-1"]')
      expect(said?.textContent).toContain('take the second half')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows you the face of everyone on their feet, and only theirs', () => {
    vi.useFakeTimers()
    try {
      const { container } = stage({ messages: carried })
      const walker = person(container, 'child-1')
      expect(walker?.getAttribute('data-walk')).toBe('true')
      expect(walker?.querySelector('[data-back="true"]')).toBeNull()

      act(() => { vi.advanceTimersByTime(3_000) })
      for (const id of ['child-1', 'child-2']) {
        const node = person(container, id)
        expect(node?.getAttribute('data-walk'), id).toBeNull()
        // Turned toward each other to talk: sideways, never away from you.
        expect(['left', 'right'], id).toContain(node?.getAttribute('data-facing'))
        expect(node?.querySelector('[data-back="true"]'), id).toBeNull()
      }
      // Nobody else looks up: the leader goes on working at its own screen.
      expect(person(container, 'leader-1')?.getAttribute('data-facing')).toBe('back')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays out of the room when the sender is no longer on the roster', () => {
    const { container } = stage({
      messages: [{ messageId: 'm9', from: 'child-9', kind: 'message', text: 'stale', time: 1 }],
    })
    expect(container.querySelector('[data-talking]')).toBeNull()
  })

  it('sends nobody walking for the runtime own account of an activation ending', () => {
    const { container } = stage({
      messages: [{ messageId: 'm1', from: 'child-1', kind: 'settled', text: 'Alice finished', time: 1 }],
    })
    expect(container.querySelector('[data-talking]')).toBeNull()
  })
})

describe('the drawer', () => {
  const messages: readonly TeamMessageView[] = [
    { messageId: 'm1', to: 'child-1', kind: 'message', text: 'please review', time: 1 },
    { messageId: 'm2', from: 'child-1', kind: 'report', text: 'the review is done', time: 2 },
  ]
  const tasks: readonly TeamTaskView[] = [
    { taskId: 't1', title: 'review the diff', assigneeId: 'child-1', status: 'active' },
    { taskId: 't2', title: 'write the note', status: 'done' },
  ]
  const board: readonly TeamBoardEntryView[] = [
    { key: 'api decision', authorId: 'child-1', authorName: 'Alice', updatedAt: 3, preview: 'keep v1' },
  ]

  it('keeps every ledger tucked behind the dock until asked', () => {
    const { container } = stage({ messages, tasks, board })
    expect(container.querySelector('[data-message-kind]')).toBeNull()
    expect(container.querySelector('[data-column]')).toBeNull()
    expect(container.querySelector('[data-note-key]')).toBeNull()
  })

  it('opens a ledger from its door and closes it from the same door', () => {
    const { container } = stage({ messages })
    openPanel(en['stage.feed'])
    expect(container.querySelector('[data-message-kind]')).toBeTruthy()
    openPanel(en['stage.feed'])
    expect(container.querySelector('[data-message-kind]')).toBeNull()
  })

  it('switches ledgers instead of stacking them', () => {
    const { container } = stage({ messages, tasks })
    openPanel(en['stage.feed'])
    openPanel(en['stage.board'])
    expect(container.querySelector('[data-message-kind]')).toBeNull()
    expect(container.querySelector('[data-column="active"]')?.textContent).toContain('review the diff')
  })

  it('closes from the drawer\'s own close affordance', () => {
    const { container } = stage({ tasks })
    openPanel(en['stage.board'])
    fireEvent.click(screen.getByLabelText(en['drawer.close']))
    expect(container.querySelector('[data-column]')).toBeNull()
  })

  it('clears the member highlight when its hovered ledger closes', () => {
    const { container } = stage({ messages })
    openPanel(en['stage.feed'])
    fireEvent.mouseEnter(container.querySelector('[data-message-kind="report"]')!)
    expect(person(container, 'child-1')?.getAttribute('data-focus')).toBe('true')

    fireEvent.keyDown(screen.getByLabelText(en['drawer.close']), { key: 'Escape' })
    expect(person(container, 'child-1')?.getAttribute('data-focus')).toBeNull()
  })

  it('returns keyboard focus to the drawer’s dock button on Escape', () => {
    stage({ tasks })
    const button = screen.getByRole('button', { name: en['stage.board'] })
    fireEvent.click(button)
    expect(document.activeElement).toBe(screen.getByLabelText(en['drawer.close']))

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByLabelText(en['drawer.close'])).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('returns focus to the active dock button after using the close button', () => {
    stage({ board })
    const button = screen.getByRole('button', { name: en['stage.workspace'] })
    fireEvent.click(button)
    fireEvent.click(screen.getByLabelText(en['drawer.close']))
    expect(document.activeElement).toBe(button)
  })

  it('counts what waits behind each door', () => {
    stage({ messages, tasks, board })
    expect(screen.getByRole('button', { name: en['stage.feed'] }).textContent).toContain('2')
    expect(screen.getByRole('button', { name: en['stage.workspace'] }).textContent).toContain('1')
    // One of the two tasks is still open; the door counts work, not history.
    expect(screen.getByRole('button', { name: en['stage.board'] }).textContent).toContain('1')
  })

  it('flags the mailbox door while a delivery waits behind it, until it is opened', () => {
    const view = mount({ leaderId: 'leader-1', currentId: 'leader-1', members: [alice, bob], messages })
    const door = () => screen.getByRole('button', { name: en['stage.feed'] })
    expect(door().getAttribute('data-fresh')).toBeNull()

    view.rerender(element({
      leaderId: 'leader-1',
      currentId: 'leader-1',
      members: [alice, bob],
      messages: [...messages, { messageId: 'm3', to: 'child-2', kind: 'message', text: 'next', time: 3 }],
    }))
    expect(door().getAttribute('data-fresh')).toBe('true')

    fireEvent.click(door())
    expect(door().getAttribute('data-fresh')).toBeNull()
  })

  it('flags the mailbox door even once the feed is full and replacing its oldest row', () => {
    // A bounded feed stops growing exactly when it is full: the row count the
    // door used to key on freezes there, while the mail keeps coming.
    const full = Array.from({ length: 50 }, (_, index) => ({
      messageId: `m${index}`, to: 'child-1' as const, kind: 'message' as const,
      text: `note ${index}`, time: index,
    }))
    const view = mount({ leaderId: 'leader-1', currentId: 'leader-1', members: [alice, bob], messages: full })
    const door = () => screen.getByRole('button', { name: en['stage.feed'] })
    expect(door().getAttribute('data-fresh')).toBeNull()

    view.rerender(element({
      leaderId: 'leader-1',
      currentId: 'leader-1',
      members: [alice, bob],
      messages: [...full.slice(1), { messageId: 'm50', to: 'child-2', kind: 'message', text: 'next', time: 50 }],
    }))
    expect(door().getAttribute('data-fresh')).toBe('true')
  })
})

describe('mailbox', () => {
  const long = 'the review is done, and here is every last thing I looked at while I was doing it, '
    + 'because a teammate that reports has a great deal to say and says all of it at once'
  const messages: readonly TeamMessageView[] = [
    { messageId: 'm1', to: 'child-1', kind: 'message', text: 'please review', time: 1_700_000_000_000 },
    { messageId: 'm2', from: 'child-1', kind: 'report', text: long, time: 1_700_000_060_000 },
    { messageId: 'm3', from: 'child-2', kind: 'settled', text: 'Bob finished', time: 1_700_000_120_000 },
  ]

  it('keeps one refreshed line per member: what it is doing, and its latest word', () => {
    const { container } = stage({ messages }, { running: ['child-1'] })
    openPanel(en['stage.feed'])
    const row = container.querySelector('[data-crew-row="child-1"]')
    expect(row?.textContent).toContain('Alice')
    expect(row?.textContent).toContain(en['status.running'])
    expect(row?.textContent).toContain('the review is done')
    expect(container.querySelector('[data-crew-row="child-2"]')?.textContent).toContain('Bob finished')
    expect(container.querySelectorAll('[data-crew-row]')).toHaveLength(3)
  })

  it('says so on a member nobody has spoken to yet', () => {
    stage()
    openPanel(en['stage.feed'])
    expect(screen.getAllByText(en['feed.quiet']).length).toBe(3)
  })

  it('puts every member of the team on the same side of the log', () => {
    const { container } = stage({ messages })
    openPanel(en['stage.feed'])
    expect(container.querySelectorAll('[data-message-kind]')).toHaveLength(3)
    expect(container.querySelector('[data-outbound]')).toBeNull()
  })

  it('cuts a long row down to a line, and keeps the whole of it in the row', () => {
    const { container } = stage({ messages })
    openPanel(en['stage.feed'])
    const row = container.querySelector('[data-message-kind="report"]')
    const text = row?.querySelector('[title]')
    expect(text?.getAttribute('title')).toBe(long)
    expect((text?.textContent ?? '').length).toBeLessThan(long.length)
    expect(text?.textContent).toMatch(/…$/u)
  })

  it('names both ends of every row', () => {
    const { container } = stage({ messages })
    openPanel(en['stage.feed'])
    const first = container.querySelector('[data-message-kind="message"]')
    expect(first?.textContent).toContain(en['member.leader'])
    expect(first?.textContent).toContain('Alice')
  })

  it('labels a report and a settlement, but not an ordinary message', () => {
    stage({ messages })
    openPanel(en['stage.feed'])
    expect(screen.getByText(en['message.report'])).toBeTruthy()
    expect(screen.getByText(en['message.settled'])).toBeTruthy()
  })

  it('links a row to its member: hovering one focuses the other', () => {
    const { container } = stage({ messages })
    openPanel(en['stage.feed'])
    const row = container.querySelector('[data-message-kind="message"]')
    expect(row).toBeTruthy()
    fireEvent.mouseEnter(row as HTMLElement)
    expect(person(container, 'child-1')?.getAttribute('data-focus')).toBe('true')

    fireEvent.mouseLeave(row as HTMLElement)
    expect(person(container, 'child-1')?.getAttribute('data-focus')).toBeNull()
  })

  it('gives every row the author own mask as its portrait', () => {
    const { container } = stage({ messages })
    openPanel(en['stage.feed'])
    expect(container.querySelector('[data-message-kind="message"] [data-cameo-species="blue"]')).toBeTruthy()
    expect(container.querySelector('[data-message-kind="report"] [data-cameo-species="orca"]')).toBeTruthy()
  })

  it('falls back to a short id for a sender the roster no longer knows', () => {
    const { container } = stage({ messages: [{ messageId: 'm9', from: 'child-9-long-id', kind: 'message', text: 'stale', time: 1 }] })
    openPanel(en['stage.feed'])
    expect(container.querySelector('[data-message-kind]')?.textContent).toContain('child-')
  })

  it('says so when there is no traffic yet', () => {
    stage()
    openPanel(en['stage.feed'])
    expect(screen.getByText(en['stage.noMessages'])).toBeTruthy()
  })
})

describe('task board', () => {
  const tasks: readonly TeamTaskView[] = [
    { taskId: 't1', title: 'review the diff', assigneeId: 'child-1', status: 'active' },
    { taskId: 't2', title: 'write the note', status: 'done', note: 'shipped' },
    { taskId: 't3', title: 'ship it', status: 'pending' },
  ]

  it('sorts every task into its own column', () => {
    const { container } = stage({ tasks })
    openPanel(en['stage.board'])
    const column = (status: string): HTMLElement | null => container.querySelector(`[data-column="${status}"]`)
    expect(column('pending')?.textContent).toContain('ship it')
    expect(column('active')?.textContent).toContain('review the diff')
    expect(column('done')?.textContent).toContain('write the note')
  })

  it('names the assignee from the roster and marks an unassigned row', () => {
    const { container } = stage({ tasks })
    openPanel(en['stage.board'])
    expect(container.querySelector('[data-task-status="active"]')?.textContent).toContain('Alice')
    expect(container.querySelector('[data-task-status="pending"]')?.textContent)
      .toContain(en['task.unassigned'])
  })

  it('carries the status on the card itself, so a done task reads as done', () => {
    stage({ tasks })
    openPanel(en['stage.board'])
    expect(screen.getByText('write the note').closest('[data-task-status]')?.getAttribute('data-task-status'))
      .toBe('done')
  })

  it('keeps the closing note beside the card', () => {
    stage({ tasks })
    openPanel(en['stage.board'])
    expect(screen.getByText('shipped')).toBeTruthy()
  })

  it('says so when there is no task yet', () => {
    stage()
    openPanel(en['stage.board'])
    expect(screen.getByText(en['stage.noTasks'])).toBeTruthy()
  })
})

describe('shared workspace', () => {
  const board: readonly TeamBoardEntryView[] = [
    {
      key: 'api decision', authorId: 'child-1', authorName: 'Alice',
      updatedAt: 1_700_000_000_000, preview: 'we keep v1 of the route',
    },
    {
      key: 'migration list', authorId: 'child-2', authorName: 'Bob',
      updatedAt: 1_700_000_060_000, preview: 'four call sites left',
    },
  ]

  it('shows every note with its author', () => {
    const { container } = stage({ board })
    openPanel(en['stage.workspace'])
    const note = container.querySelector('[data-note-key="api decision"]')
    expect(note?.textContent).toContain('we keep v1 of the route')
    expect(note?.textContent).toContain('Alice')
    expect(container.querySelector('[data-note-key="migration list"]')?.textContent).toContain('Bob')
  })

  it('says when the snapshot was taken, because a teammate write does not reach it', () => {
    const { container } = stage({ board, boardAt: 1_700_000_120_000 })
    openPanel(en['stage.workspace'])
    expect(container.querySelector('[data-note-key]')).toBeTruthy()
    expect(screen.getByTitle(en['stage.boardStale'])).toBeTruthy()
  })

  it('links a note to its author: hovering one focuses the member', () => {
    const { container } = stage({ board })
    openPanel(en['stage.workspace'])
    const note = container.querySelector('[data-note-key="api decision"]')
    fireEvent.mouseEnter(note as HTMLElement)
    expect(person(container, 'child-1')?.getAttribute('data-focus')).toBe('true')
  })

  it('says so, and why it matters, when nothing is written yet', () => {
    stage()
    openPanel(en['stage.workspace'])
    expect(screen.getByText(en['stage.noNotes'])).toBeTruthy()
    expect(screen.getByText(en['stage.noNotesHint'])).toBeTruthy()
  })
})
