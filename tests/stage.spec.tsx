/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

/** Open one ledger from the world toolbar. */
function openPanel(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

/** One member of the crew, wherever it is standing. */
function person(container: HTMLElement, memberId: string): HTMLElement | null {
  return container.querySelector(`[data-member="${memberId}"]`)
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

})

describe('the composer seat', () => {
  it('holds the composer for as long as the world is on screen, then hands it back', () => {
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

describe('the miniature world', () => {
  it('keeps the leader and every teammate reachable when WebGL is unavailable', () => {
    const { container } = stage()
    expect(container.querySelector('[data-renderer="fallback"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-member]')).toHaveLength(3)
    expect(screen.getByText(en['world.fallback'])).toBeTruthy()
    expect(screen.getByRole('button', { name: en['world.zoomIn'] }).hasAttribute('disabled')).toBe(true)
  })

  it('opens the exact member session and returns to the leader', () => {
    const openMember = vi.fn()
    const openLeader = vi.fn()
    stage({}, { openMember, openLeader })
    fireEvent.click(screen.getByRole('button', { name: 'Open the session of Alice' }))
    expect(openMember).toHaveBeenCalledWith('leader-1', 'child-1')
    fireEvent.click(screen.getByRole('button', { name: en['member.openLeader'] }))
    expect(openLeader).toHaveBeenCalledWith('leader-1')
  })

  it('describes live work without treating an idle teammate as busy', () => {
    const { container } = stage({ tasks: [{ taskId: 't1', title: 'Review authentication', assigneeId: 'child-1', status: 'active' }] }, { running: ['child-1'] })
    expect(person(container, 'child-1')?.getAttribute('data-running')).toBe('true')
    expect(person(container, 'child-2')?.getAttribute('data-running')).toBeNull()
    const description = document.getElementById(person(container, 'child-1')!.getAttribute('aria-describedby')!)
    expect(description?.textContent).toContain('Review authentication')
  })

  it('opens resident details and prevents a leisure command during real work', () => {
    stage({}, { running: ['child-1'] })
    fireEvent.click(screen.getByRole('button', { name: 'See what Alice is doing' }))
    const details = screen.getByLabelText(en['world.memberDetails'])
    expect(details.textContent).toContain(en['world.workingHint'])
    expect(details.querySelector('[data-activity-command="pool"]')?.hasAttribute('disabled')).toBe(true)
  })

  it('closes resident details and returns keyboard focus to the avatar', () => {
    stage()
    const avatar = screen.getByRole('button', { name: 'See what Alice is doing' })
    fireEvent.click(avatar)
    fireEvent.keyDown(screen.getByLabelText(en['world.closeDetails']), { key: 'Escape' })
    expect(screen.queryByLabelText(en['world.memberDetails'])).toBeNull()
    expect(document.activeElement).toBe(avatar)
  })

  it('withdraws the details of a resident who leaves the team', () => {
    const view = stage()
    fireEvent.click(screen.getByRole('button', { name: 'See what Alice is doing' }))
    view.rerender(element({ leaderId: 'leader-1', members: [bob] }))
    expect(screen.queryByLabelText(en['world.memberDetails'])).toBeNull()
    expect(screen.queryByRole('button', { name: 'See what Alice is doing' })).toBeNull()
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

  it('uses the author’s voxel portrait on each message', () => {
    const { container } = stage({ messages })
    openPanel(en['stage.feed'])
    expect(container.querySelector('[data-message-kind="message"] [data-portrait="-1"]')).toBeTruthy()
    expect(container.querySelector('[data-message-kind="report"] [data-portrait="0"]')).toBeTruthy()
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
