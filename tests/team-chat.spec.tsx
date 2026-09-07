/** @vitest-environment jsdom */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TeamPresence, type TeamPresenceProps } from '../src/client/TeamPresence.tsx'
import { TeamToolCard, type TeamToolCardProps } from '../src/client/TeamToolCard.tsx'
import type { TeamPanelState } from '../src/client/TeamStage.tsx'
import { en, type TeamKey } from '../src/client/locales.ts'

afterEach(cleanup)

const alice = { memberId: 'alice', name: 'Alice', role: 'Reviewer', relation: 'peer' as const, joinedAt: 1 }
const bob = { memberId: 'bob', name: 'Bob', role: 'Developer', relation: 'managed' as const, joinedAt: 2 }
const state: TeamPanelState = { leaderId: 'leader', currentId: 'leader', members: [alice, bob], tasks: [], messages: [], board: [] }

function t(key: TeamKey, params?: Record<string, string | number>): string {
  return Object.entries(params ?? {}).reduce((line, [name, value]) => line.replaceAll(`{${name}}`, String(value)), en[key])
}

function hook<T>(store: SnapshotStore<T>): SnapshotSelectorHook<T> {
  return select => select(useSyncExternalStore(store.subscribe, store.getSnapshot))
}

function sessionState(running: readonly string[]): SessionListState {
  return {
    ids: [], byId: Object.fromEntries(running.map(id => [id, { id, running: true }])),
    current: 'leader', phase: 'ready', subagentsByParent: {}, jobsBySession: {},
  } as unknown as SessionListState
}

function presence(snapshot = state) {
  const team = createSnapshotStore(snapshot)
  const sessions = createSnapshotStore(sessionState([]))
  const openMember = vi.fn()
  const openLeader = vi.fn()
  const props = { sessionId: 'leader', useTeam: hook(team), useSessions: hook(sessions), openMember, openLeader, t } as unknown as TeamPresenceProps
  return { team, sessions, openMember, openLeader, ...render(<TeamPresence {...props} />) }
}

function result(name: string, args: Record<string, unknown>, extra: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', callId: 'call-1', call: { name, argsRaw: JSON.stringify(args) },
    seq: 2, time: 2000, callTime: 1000, content: [], isError: false, subCalls: [], ...extra,
  }
}

function toolCard(toolName: string, block: ToolCallBlock, snapshot = state) {
  const team = createSnapshotStore(snapshot)
  const openMember = vi.fn()
  const openLeader = vi.fn()
  const inspect = vi.fn()
  const props = { sessionId: 'leader', callId: block.callId, toolName, block, useTeam: hook(team), openMember, openLeader, inspect, t } as unknown as TeamToolCardProps
  return { team, openMember, openLeader, inspect, ...render(<TeamToolCard {...props} />) }
}

describe('team presence in the conversation header', () => {
  it('shows the total and live member status before opening the roster', () => {
    const view = presence()
    const avatars = screen.getByRole('group', { name: 'Your team' })
    expect(within(avatars).getAllByRole('button').map(button => button.getAttribute('aria-label')))
      .toEqual(['Back to the main session', 'Open the session of Alice', 'Open the session of Bob'])
    expect(screen.getByRole('button', { name: 'View 3 team members' }).textContent).toBe('3 people')
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => { view.sessions.set(sessionState(['leader', 'alice'])) })

    expect(within(avatars).getByLabelText('Open the session of Alice').title).toBe('Alice · Reviewer · Working')
    fireEvent.click(screen.getByRole('button', { name: 'View 3 team members' }))
    expect(within(screen.getByRole('dialog')).getByText('3 members · 2 working')).toBeTruthy()
  })

  it('keeps all nine people reachable when only four avatars fit in the header', () => {
    const members = Array.from({ length: 8 }, (_, index) => ({ ...alice, memberId: `member-${index}`, name: `Member ${index}` }))
    presence({ ...state, members })
    expect(within(screen.getByRole('group')).getAllByRole('button')).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: 'View 9 team members' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(9)
    expect(within(dialog).getByRole('button', { name: 'Open the session of Member 7' })).toBeTruthy()
  })

  it('opens a teammate directly from its portrait and the leader from the roster', () => {
    const view = presence()
    fireEvent.click(screen.getByRole('button', { name: 'Open the session of Alice' }))
    expect(view.openMember).toHaveBeenCalledWith('leader', 'alice')

    fireEvent.click(screen.getByRole('button', { name: 'View 3 team members' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back to the main session' }))

    expect(view.openLeader).toHaveBeenCalledWith('leader')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows ongoing work ahead of an older report and counts completed tasks', () => {
    presence({
      ...state,
      tasks: [
        { taskId: 'done', title: 'Old review', status: 'done', assigneeId: 'alice' },
        { taskId: 'active', title: 'Review authentication', status: 'active', assigneeId: 'alice' },
      ],
      messages: [{ messageId: 'm1', from: 'alice', kind: 'report', text: 'The old review is complete', time: 1000 }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'View 3 team members' }))

    const dialog = screen.getByRole('dialog')
    const row = within(dialog).getByRole('button', { name: 'Open the session of Alice' })
    expect(row.textContent).toContain('Review authentication')
    expect(row.textContent).not.toContain('The old review is complete')
    const progress = within(dialog).getByRole('progressbar') as HTMLProgressElement
    expect([progress.value, progress.max]).toEqual([1, 2])
  })

  it('returns focus to the roster control when Escape closes it', () => {
    presence()
    const toggle = screen.getByRole('button', { name: 'View 3 team members' })
    fireEvent.click(toggle)
    expect(document.activeElement).toBe(screen.getByLabelText('Close team members'))

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(toggle)
  })

  it('closes the old roster when a different team comes into view', () => {
    const view = presence()
    fireEvent.click(screen.getByRole('button', { name: 'View 3 team members' }))

    act(() => { view.team.set({ ...state, leaderId: 'other', currentId: 'other', members: [{ ...bob, name: 'Carol' }] }) })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open the session of Alice' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View 2 team members' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open the session of Carol' })).toBeTruthy()
  })
})

describe('team tool cards', () => {
  it('uses the recorded spawn when the call head is outside the history window', () => {
    const view = toolCard('team_spawn', result('team_spawn', {}, {
      call: null, meta: { team: 'member-added', member: { ...alice, memberId: 'former-alice', role: 'Original reviewer' } },
    }))

    expect(screen.getByText('Original reviewer')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Joined')
    expect(screen.queryByRole('button', { name: 'Open the session of Alice' })).toBeNull()
    expect(view.openMember).not.toHaveBeenCalled()
  })

  it('shows the task returned by that call even after the live task changes', () => {
    toolCard('team_task', result('team_task', { title: 'Draft title', assignee: 'Alice' }, {
      meta: { team: 'task', task: { taskId: 't1', title: 'Authentication reviewed', status: 'done', assigneeId: 'alice' } },
    }), { ...state, tasks: [{ taskId: 't1', title: 'Now review storage', status: 'active', assigneeId: 'bob' }] })

    expect(screen.getByText('Authentication reviewed')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Updated')
    expect(screen.queryByText('Now review storage')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open the session of Alice' })).toBeTruthy()
  })

  it('shows a failed delivery with its actual error and never consumes success metadata', () => {
    toolCard('team_send', result('team_send', { to: 'Bob', message: 'Please review' }, {
      isError: true, content: [{ type: 'text', text: 'Bob is no longer on the team' }],
      meta: { team: 'message', messageId: 'wrong', to: 'alice', text: 'This was not delivered' },
    }))

    expect(screen.getByRole('status').textContent).toBe('Failed')
    expect(screen.getByText('Bob is no longer on the team')).toBeTruthy()
    expect(screen.queryByText('This was not delivered')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open the session of Bob' })).toBeTruthy()
  })

  it('distinguishes an interrupted call from a successful result', () => {
    toolCard('team_spawn', result('team_spawn', { name: 'Alice' }, {
      isError: true, error: { name: 'ToolError', code: 'interrupted' },
    }))

    expect(screen.getByRole('status').textContent).toBe('Stopped')
    expect(screen.getByText('ToolError: interrupted')).toBeTruthy()
  })

  it('keeps partial arguments inspectable while a call is running', () => {
    const raw = '{"name":"Alice","task":'
    const view = toolCard('team_spawn', { callId: 'call-1', name: 'team_spawn', argsRaw: raw, time: 1000, turn: 1, step: 1, subCalls: [] })
    expect(screen.getByRole('status').textContent).toBe('In progress')

    fireEvent.click(screen.getByRole('button', { name: 'Expand call details' }))

    expect(screen.getByText(raw).tagName).toBe('PRE')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect full call' }))
    expect(view.inspect).toHaveBeenCalledTimes(1)
  })

  it('links both ends of a message to the same sessions used by the world', () => {
    const view = toolCard('team_send', result('team_send', { to: 'Alice', message: 'Review this change' }, {
      meta: { team: 'message', messageId: 'm1', to: 'alice', text: 'Review this change' },
    }))

    expect(screen.getByText('To Alice')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open the session of Alice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to the main session' }))
    expect(view.openMember).toHaveBeenCalledWith('leader', 'alice')
    expect(view.openLeader).toHaveBeenCalledWith('leader')
  })

  it.each([
    { tool: 'team_relation', args: { member: 'Alice', relation: 'peer' }, title: 'Update collaboration', summary: 'Alice', caption: 'Peer', status: 'Updated' },
    { tool: 'team_dismiss', args: {}, title: 'End collaboration', summary: 'Your team', caption: '', status: 'Ended' },
    { tool: 'team_list', args: {}, title: 'View team', summary: 'Members and tasks', caption: '', status: 'Read' },
    { tool: 'team_note', args: { key: 'Decision', text: 'Keep v1' }, title: 'Save note', summary: 'Decision', caption: 'Shared with the team', status: 'Saved' },
    { tool: 'team_note', args: { key: 'Scratch', private: true }, title: 'Remove note', summary: 'Scratch', caption: 'Private note', status: 'Removed' },
    { tool: 'team_board', args: { key: 'Decision' }, title: 'Read workspace', summary: 'Decision', caption: 'Shared with the team', status: 'Read' },
  ])('describes $tool as $title with its subject and outcome', ({ tool, args, title, summary, caption, status }) => {
    toolCard(tool, result(tool, args))

    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.getAllByText(summary).length).toBeGreaterThan(0)
    if (caption !== '') expect(screen.getByText(caption)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(status)
  })

  it('does not describe the shared index as the contents of a private read', () => {
    toolCard('team_board', result('team_board', { private: true }, {
      meta: { team: 'board', entries: [{ key: 'Public', authorId: 'alice', authorName: 'Alice', updatedAt: 1, preview: 'Shared only' }], at: 1000 },
      content: [{ type: 'text', text: 'The private workspace is empty' }],
    }))

    expect(screen.getByText('Private note')).toBeTruthy()
    expect(screen.queryByText('1 shared notes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand call details' }))
    expect(screen.getByText('The private workspace is empty')).toBeTruthy()
  })
})
