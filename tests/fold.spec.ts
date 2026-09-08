/**
 * The durable fold: what a leader's own log says about its team.
 *
 * These tests are the contract the browser panel and the service both read
 * through, so they assert on the folded VALUE — never on how it was produced.
 *
 * @module dsh-team/tests/fold
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_TEAM_VIEW } from '../src/contract.ts'
import { applyTeamEvent, foldTeam, readFact } from '../src/fold.ts'
import { codeDispatchEvent, toolResultEvent, userMessageEvent } from './harness.ts'

const BOUND = 50

const alice = { memberId: 'child-1', name: 'Alice', role: 'reviewer', relation: 'peer', model: 'x', effort: 'high' }
const bob = { memberId: 'child-2', name: 'Bob', relation: 'managed' }

describe('readFact', () => {
  it('narrows every fact arm this plugin writes', () => {
    expect(readFact({ team: 'member-added', member: alice })).toEqual({ team: 'member-added', member: alice })
    expect(readFact({ team: 'member-removed', memberId: 'child-1' })).toEqual({ team: 'member-removed', memberId: 'child-1' })
    expect(readFact({ team: 'ended' })).toEqual({ team: 'ended' })
    expect(readFact({ team: 'task', task: { taskId: 't1', title: 'ship', status: 'pending' } }))
      .toEqual({ team: 'task', task: { taskId: 't1', title: 'ship', status: 'pending' } })
  })

  it('rejects a fact whose required members are missing or ill-typed', () => {
    expect(readFact({ team: 'member-added', member: { memberId: 'child-1' } })).toBeUndefined()
    expect(readFact({ team: 'member-added', member: { ...alice, relation: 'boss' } })).toBeUndefined()
    expect(readFact({ team: 'task', task: { taskId: 't1', title: 'ship', status: 'archived' } })).toBeUndefined()
    expect(readFact({ team: 'message', messageId: 'm1' })).toBeUndefined()
  })

  it('folds an unknown fact kind to nothing instead of corrupting the view', () => {
    expect(readFact({ team: 'member-promoted-to-leader', member: alice })).toBeUndefined()
    expect(readFact('member-added')).toBeUndefined()
    expect(readFact(undefined)).toBeUndefined()
  })
})

describe('foldTeam', () => {
  it('is empty for a log with no team facts', () => {
    expect(foldTeam([], BOUND)).toEqual(EMPTY_TEAM_VIEW)
  })

  it('records the whole member on a settled spawn, stamped with the log time', () => {
    const view = foldTeam([toolResultEvent({ team: 'member-added', member: alice }, { time: 4242 })], BOUND)
    expect(view.active).toBe(true)
    expect(view.members).toEqual([{ ...alice, joinedAt: 4242 }])
  })

  it('ignores a failed call: an errored spawn never joins the roster', () => {
    const view = foldTeam([
      toolResultEvent({ team: 'member-added', member: alice }, { error: { name: 'TeamError', code: 'MAX_TEAMMATES' } }),
    ], BOUND)
    expect(view).toEqual(EMPTY_TEAM_VIEW)
  })

  it('replaces a member in place on update and keeps its join time', () => {
    const view = foldTeam([
      toolResultEvent({ team: 'member-added', member: alice }, { time: 100 }),
      toolResultEvent({ team: 'member-updated', member: { ...alice, relation: 'managed' } }, { time: 900 }),
    ], BOUND)
    expect(view.members).toEqual([{ ...alice, relation: 'managed', joinedAt: 100 }])
  })

  it('drops an update for a member the roster never had', () => {
    const view = foldTeam([toolResultEvent({ team: 'member-updated', member: alice })], BOUND)
    expect(view.members).toEqual([])
  })

  it('removes one member and ends the whole team', () => {
    const events = [
      toolResultEvent({ team: 'member-added', member: alice }),
      toolResultEvent({ team: 'member-added', member: bob }),
    ]
    expect(foldTeam([...events, toolResultEvent({ team: 'member-removed', memberId: 'child-1' })], BOUND).members)
      .toEqual([{ ...bob, joinedAt: expect.any(Number) }])
    const ended = foldTeam([...events, toolResultEvent({ team: 'ended' })], BOUND)
    expect(ended.active).toBe(false)
    expect(ended.members).toEqual([])
  })

  it('lets a spawn after an end restart the team', () => {
    const view = foldTeam([
      toolResultEvent({ team: 'member-added', member: alice }),
      toolResultEvent({ team: 'ended' }),
      toolResultEvent({ team: 'member-added', member: bob }),
    ], BOUND)
    expect(view.active).toBe(true)
    expect(view.members.map(member => member.memberId)).toEqual(['child-2'])
  })

  it('upserts tasks by id', () => {
    const view = foldTeam([
      toolResultEvent({ team: 'task', task: { taskId: 't1', title: 'ship', status: 'pending' } }),
      toolResultEvent({ team: 'task', task: { taskId: 't1', title: 'ship', status: 'done', note: 'merged' } }),
      toolResultEvent({ team: 'task', task: { taskId: 't2', title: 'review', status: 'active', assigneeId: 'child-1' } }),
    ], BOUND)
    expect(view.tasks).toEqual([
      { taskId: 't1', title: 'ship', status: 'done', note: 'merged' },
      { taskId: 't2', title: 'review', status: 'active', assigneeId: 'child-1' },
    ])
  })

  it('records an outbound message with no sender: the leader owns the log', () => {
    const view = foldTeam([
      toolResultEvent({ team: 'message', messageId: 'm1', to: 'child-1', text: 'please review' }, { time: 77 }),
    ], BOUND)
    expect(view.messages).toEqual([
      { messageId: 'm1', to: 'child-1', kind: 'message', text: 'please review', time: 77 },
    ])
  })

  it('records an inbound delivery only when its sender is on the roster', () => {
    const fromAlice = userMessageEvent(
      { kind: 'team-message', form: 'relay', senderSessionId: 'child-1', senderName: 'Alice', chainId: 'c1', hop: 1 },
      'reviewed',
    )
    const fromStranger = userMessageEvent(
      { kind: 'subagent-report', senderSessionId: 'other-session' } as never,
      'unrelated subagent output',
    )
    const view = foldTeam([
      toolResultEvent({ team: 'member-added', member: alice }),
      fromAlice,
      fromStranger,
    ], BOUND)
    expect(view.messages).toEqual([
      {
        messageId: expect.any(String), from: 'child-1', kind: 'message', text: 'reviewed',
        time: expect.any(Number), hop: 1,
      },
    ])
  })

  it('records a teammate report and its settlement notice as distinct kinds', () => {
    const view = foldTeam([
      toolResultEvent({ team: 'member-added', member: alice }),
      userMessageEvent({ kind: 'subagent-report', senderSessionId: 'child-1' } as never, 'the review is done'),
      userMessageEvent(
        { kind: 'subagent-settled', senderSessionId: 'child-1', summary: 'Alice finished' } as never,
        '',
      ),
    ], BOUND)
    expect(view.messages.map(message => [message.kind, message.text])).toEqual([
      ['report', 'the review is done'],
      ['settled', 'Alice finished'],
    ])
  })

  it('keeps the newest rows once the mailbox bound is reached', () => {
    const events = Array.from({ length: 5 }, (_unused, index) =>
      toolResultEvent({ team: 'message', messageId: `m${index}`, to: 'child-1', text: `t${index}` }))
    const view = foldTeam(events, 3)
    expect(view.messages.map(message => message.messageId)).toEqual(['m2', 'm3', 'm4'])
  })
})

describe('applyTeamEvent', () => {
  it('returns the same reference for an event this unit does not own', () => {
    const view = foldTeam([toolResultEvent({ team: 'member-added', member: alice })], BOUND)
    const unrelated = toolResultEvent({ tool: 'bash', exit: 0 })
    expect(applyTeamEvent(view, unrelated, BOUND)).toBe(view)
    expect(applyTeamEvent(view, userMessageEvent({ kind: 'user' } as never, 'hello'), BOUND)).toBe(view)
  })

  it('returns the same reference for a delivery from outside the roster', () => {
    const view = foldTeam([toolResultEvent({ team: 'member-added', member: alice })], BOUND)
    const stray = userMessageEvent(
      { kind: 'team-message', form: 'relay', senderSessionId: 'nobody', senderName: 'Nobody', chainId: 'c1', hop: 0 },
      'hi',
    )
    expect(applyTeamEvent(view, stray, BOUND)).toBe(view)
  })
})


describe('code-dispatch fold (code-mode deployments)', () => {
  const NL = String.fromCharCode(10)
  const spawnText = (name: string, id: string): string => 'teammate ' + name + ' joined as a managed member and started on its task. Address it as "' + name + '" or "' + id + '".'

  it('builds the roster from a nested spawn, stamped with the event time', () => {
    const view = foldTeam([
      codeDispatchEvent('team_spawn', { name: 'Alice', role: 'reviewer', relation: 'managed', task: 'review it' }, spawnText('Alice', 'child-1'), { time: 4242 }),
    ], BOUND)
    expect(view.active).toBe(true)
    expect(view.members).toEqual([{ memberId: 'child-1', name: 'Alice', role: 'reviewer', relation: 'managed', joinedAt: 4242 }])
  })

  it('lets roster-gated deliveries through once a dispatch spawn healed the roster', () => {
    const view = foldTeam([
      userMessageEvent({ kind: 'team-message', form: 'relay', senderSessionId: 'child-1', senderName: 'Alice', chainId: 'c1', hop: 0 }, 'early'),
      codeDispatchEvent('team_spawn', { name: 'Alice', relation: 'managed', task: 'x' }, spawnText('Alice', 'child-1')),
      userMessageEvent({ kind: 'team-message', form: 'relay', senderSessionId: 'child-1', senderName: 'Alice', chainId: 'c1', hop: 0 }, 'late'),
    ], BOUND)
    expect(view.messages.map(message => message.text)).toEqual(['late'])
  })

  it('folds task creates and updates with assignee name resolution', () => {
    const view = foldTeam([
      codeDispatchEvent('team_spawn', { name: 'Alice', relation: 'managed', task: 'x' }, spawnText('Alice', 'child-1')),
      codeDispatchEvent('team_task', { title: 'ship it', assignee: 'Alice' }, 'task t1 "ship it" is pending for child-1'),
      codeDispatchEvent('team_task', { task_id: 't1', status: 'done', note: 'shipped' }, 'task t1 "ship it" is done for child-1'),
    ], BOUND)
    expect(view.tasks).toEqual([{ taskId: 't1', title: 'ship it', status: 'done', assigneeId: 'child-1', note: 'shipped' }])
  })

  it('folds dismissals by name and whole-team disbands', () => {
    const roster = [
      codeDispatchEvent('team_spawn', { name: 'Alice', relation: 'managed', task: 'x' }, spawnText('Alice', 'child-1')),
      codeDispatchEvent('team_spawn', { name: 'Bob', relation: 'peer', task: 'y' }, 'teammate Bob joined as a peer member and started on its task. Address it as "Bob" or "child-2".'),
    ]
    const dismissed = foldTeam([...roster, codeDispatchEvent('team_dismiss', { member: 'Bob' }, 'teammate child-2 is dismissed.')], BOUND)
    expect(dismissed.members.map(member => member.name)).toEqual(['Alice'])
    const disbanded = foldTeam([
      codeDispatchEvent('team_spawn', { name: 'Alice', relation: 'managed', task: 'x' }, spawnText('Alice', 'child-1')),
      codeDispatchEvent('team_dismiss', {}, 'the team is disbanded'),
    ], BOUND)
    expect(disbanded.active).toBe(false)
    expect(disbanded.members).toEqual([])
  })

  it('records a leader message from a nested send, resolving the recipient name', () => {
    const view = foldTeam([
      codeDispatchEvent('team_spawn', { name: 'Alice', relation: 'managed', task: 'x' }, spawnText('Alice', 'child-1')),
      codeDispatchEvent('team_send', { to: 'Alice', message: 'status?' }, 'message queued as the next turn of Alice'),
    ], BOUND)
    expect(view.messages).toHaveLength(1)
    expect(view.messages[0].to).toBe('child-1')
    expect(view.messages[0].text).toBe('status?')
    expect(view.messages[0].messageId.startsWith('root-1:code:')).toBe(true)
  })

  it('folds a shared board read snapshot and ignores private-pad reads', () => {
    const row = '## roadmap — Alice <child-1> · 2026-09-08T11:55:22.000Z' + NL + 'first line preview'
    const view = foldTeam([
      codeDispatchEvent('team_board', {}, row, { time: 7000 }),
      codeDispatchEvent('team_board', { private: true }, '## secret — Alice <child-1> · 2026-09-08T12:00:00.000Z' + NL + 'hidden'),
    ], BOUND)
    expect(view.board).toEqual([{ key: 'roadmap', authorName: 'Alice', authorId: 'child-1', updatedAt: Date.parse('2026-09-08T11:55:22.000Z'), preview: 'first line preview' }])
    expect(view.boardAt).toBe(7000)
  })

  it('composes with the meta channel without duplicating members', () => {
    const view = foldTeam([
      toolResultEvent({ team: 'member-added', member: alice }),
      codeDispatchEvent('team_spawn', { name: 'Alice', role: 'reviewer', relation: 'peer', task: 'x' }, 'teammate Alice joined as a peer member and started on its task. Address it as "Alice" or "child-1".'),
    ], BOUND)
    expect(view.members).toHaveLength(1)
  })

  it('ignores failed dispatches and tools it does not own', () => {
    const view = foldTeam([
      codeDispatchEvent('team_spawn', { name: 'Alice', relation: 'managed', task: 'x' }, spawnText('Alice', 'child-1'), { isError: true }),
      codeDispatchEvent('bash', { command: 'ls' }, 'ok'),
    ], BOUND)
    expect(view).toEqual(EMPTY_TEAM_VIEW)
  })
})
