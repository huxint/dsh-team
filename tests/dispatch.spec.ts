/** Round trips through the tools' real renderers and the code-mode log. */
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecution, ToolExecutionSuccess } from '@deepseek-ai/dsh-tools'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { describe, expect, it } from 'vitest'
import { EMPTY_TEAM_VIEW, type TeamView } from '../src/contract.ts'
import { applyTeamEvent, foldTeam } from '../src/fold.ts'
import { DISPATCH_FACT_PREFIX } from '../src/fold-dispatch.ts'
import { boardTool, dismissTool, noteTool, relationTool, sendTool, spawnTool, taskTool } from '../src/tools.ts'
import type { TeamWorkspace } from '../src/workspace.ts'
import { codeDispatchEvent, fakeAgent, toolResultEvent } from './harness.ts'

const BOUND = 50
const TIME = 1_700_000_000_000
const ctx = new Context()
const alice = { memberId: 'child-1', name: 'Alice', relation: 'peer' as const, effort: 'high' }
const roster = foldTeam([toolResultEvent({ team: 'member-added', member: alice }, { time: TIME })], BOUND)

/** Use the same render/finalize sequence as the registry, with no hand-written prose fixture. */
function dispatch(tool: ToolDefinition, args: Record<string, unknown>, value: JsonValue) {
  const exec = { name: tool.name, arguments: args, parent: Symbol('run_code') } as ToolExecution
  const result: ToolExecutionSuccess = { isError: false, value, content: tool.output.render(args, value) }
  return codeDispatchEvent(tool.name, args, tool.finalizeContent?.(exec, result) ?? result.content, { time: TIME })
}

function roundTrip(tool: ToolDefinition, args: Record<string, unknown>, value: JsonValue, prior: TeamView = EMPTY_TEAM_VIEW) {
  const expected = applyTeamEvent(prior, toolResultEvent(tool.output.presentationMeta?.(args, value), { time: TIME }), BOUND)
  const actual = applyTeamEvent(prior, dispatch(tool, args, value), BOUND)
  expect(actual).toEqual(expected)
  return actual
}

// These tests exercise output projection, so no workspace methods are called.
const workspace = {} as TeamWorkspace
const seat = () => ({ leaderId: 'leader-1', memberId: 'leader-1', name: 'leader' })
const board = boardTool(workspace, 'leader', seat)
const note = noteTool(workspace, 'leader', seat)
const entries = [
  { key: 'plan', authorId: 'child-1', authorName: 'Alice <reviewer>', updatedAt: TIME, preview: 'first line' },
  { key: 'next', authorId: 'child-2', authorName: 'Bob', updatedAt: TIME - 1, preview: 'second note' },
]

describe('code-mode result fidelity', () => {
  it('retains reasoning_effort from a real spawn output', () => {
    const view = roundTrip(spawnTool(ctx), { name: 'Alice', relation: 'peer', task: 'review', reasoning_effort: 'high' }, alice)
    expect(view.members[0]?.effort).toBe('high')
  })

  it('restores the whole task even when an update supplies only its id and status', () => {
    const task = { taskId: 't1', title: 'ship it', status: 'done', assigneeId: 'child-1', note: 'verified' }
    roundTrip(taskTool(ctx), { task_id: 't1', status: 'done' }, task)
  })

  it('uses the resolved recipient, actual message id, and chain depth', () => {
    const view = roundTrip(sendTool(ctx, 'leader'), { to: ' ALICE ', message: 'status?' }, {
      messageId: 'm1', to: 'child-1', name: 'Alice', hop: 0,
    }, roster)
    expect(view.messages[0]).toMatchObject({ messageId: 'm1', to: 'child-1', hop: 0 })
  })

  it('applies relation changes addressed with different casing and spaces', () => {
    roundTrip(relationTool(ctx), { member: ' ALICE ', relation: 'managed' }, { ...alice, relation: 'managed' }, roster)
  })

  it('clears a task note when the update explicitly supplies an empty string', () => {
    const task = { taskId: 't1', title: 'ship it', status: 'done', note: 'old note' }
    const prior = foldTeam([toolResultEvent({ team: 'task', task })], BOUND)
    const view = roundTrip(taskTool(ctx), { task_id: 't1', note: '' }, { ...task, note: '' }, prior)
    expect(view.tasks[0]?.note).toBeUndefined()
  })

  it('folds the actual dismissal renderer without depending on a trailing period', () => {
    const tool = dismissTool(ctx)
    const event = codeDispatchEvent(tool.name, { member: ' ALICE ' }, tool.output.render({}, { ended: false, memberId: 'child-1' }))
    expect(applyTeamEvent(roster, event, BOUND).members).toEqual([])
    roundTrip(tool, {}, { ended: true }, roster)
  })
})

describe('code-mode workspace snapshots', () => {
  it.each([{}, { key: 'plan' }, { key: 'missing' }])('records the full shared index when reading %j', args => {
    const selected = args.key === 'missing' ? [] : args.key === 'plan' ? entries.slice(0, 1) : entries
    const value = {
      area: 'shared',
      entries: selected.map(entry => ({ ...entry, text: `${entry.preview}\n\na paragraph\n\n## a heading\nbody` })),
      board: entries,
      at: TIME - 10,
    }
    const view = roundTrip(board, args, value)
    expect(view.board).toEqual(entries)
    expect(view.boardAt).toBe(TIME - 10)
  })

  it('records shared note writes and deletions immediately', () => {
    const written = roundTrip(note, { key: 'plan', text: 'first line\nbody' }, {
      key: 'plan', area: 'shared', removed: false, board: entries, at: TIME,
    })
    const removed = roundTrip(note, { key: 'plan' }, {
      key: 'plan', area: 'shared', removed: true, board: entries.slice(1), at: TIME + 1,
    }, written)
    expect(removed.board.map(entry => entry.key)).toEqual(['next'])
  })

  it('projects only the shared index after a private-pad read or write', () => {
    const secret = { ...entries[0]!, key: 'secret', preview: 'private content', text: 'private content' }
    const read = roundTrip(board, { private: true }, { area: 'private', entries: [secret], board: entries, at: TIME })
    const written = roundTrip(note, { key: 'secret', text: 'private content', private: true }, {
      key: 'secret', area: 'private', removed: false, board: entries, at: TIME + 1,
    }, read)
    expect(JSON.stringify(written.board)).not.toContain('private content')
  })
})

describe('legacy dispatch logs', () => {
  it('retains reasoning effort in historical spawn renders', () => {
    const args = { name: 'Alice', relation: 'peer', task: 'review', reasoning_effort: 'high' }
    const event = codeDispatchEvent('team_spawn', args, spawnTool(ctx).output.render(args, alice))
    expect(foldTeam([event], BOUND).members[0]?.effort).toBe('high')
  })

  it('resolves member names like the service for messages, tasks, and relation changes', () => {
    const events = [
      codeDispatchEvent('team_send', { to: ' ALICE ', message: 'hi' }, 'message queued as the next turn of Alice'),
      codeDispatchEvent('team_task', { title: 'review', assignee: ' ALICE ' }, 'task t1 "review" is pending for child-1'),
      codeDispatchEvent('team_relation', { member: ' ALICE ', relation: 'managed' }, 'Alice is now a managed member'),
    ]
    const view = events.reduce((state, event) => applyTeamEvent(state, event, BOUND), roster)
    expect(view.messages[0]?.to).toBe('child-1')
    expect(view.tasks[0]?.assigneeId).toBe('child-1')
    expect(view.members[0]?.relation).toBe('managed')
  })

  it('never treats a filtered board read as a whole-board snapshot', () => {
    const prior = { ...roster, board: entries, boardAt: TIME }
    const event = codeDispatchEvent('team_board', { key: 'missing' }, 'the shared workspace is empty')
    expect(applyTeamEvent(prior, event, BOUND)).toBe(prior)
  })

  it('ignores unknown result shapes instead of treating arguments as successful effects', () => {
    for (const [name, args] of [
      ['team_dismiss', {}],
      ['team_relation', { member: 'Alice', relation: 'managed' }],
      ['team_send', { to: 'Alice', message: 'hi' }],
      ['team_task', { task_id: 't1', title: 'unknown' }],
    ] as const) {
      expect(applyTeamEvent(roster, codeDispatchEvent(name, args, 'unrecognized output'), BOUND)).toBe(roster)
    }
  })
})

describe('dispatch envelopes', () => {
  it.each([
    DISPATCH_FACT_PREFIX + '{',
    DISPATCH_FACT_PREFIX + JSON.stringify({ team: 'member-removed', memberId: null }),
    'dsh-team/fact@2 ' + JSON.stringify({ team: 'ended' }),
  ])('ignores invalid or future envelopes without guessing from the prose', text => {
    const event = codeDispatchEvent('team_dismiss', {}, [
      { type: 'text', text: 'the team is disbanded' },
      { type: 'text', text },
    ])
    expect(applyTeamEvent(roster, event, BOUND)).toBe(roster)
  })

  it('ignores structured facts in failed calls or unrelated tools', () => {
    const content = [{ type: 'text' as const, text: DISPATCH_FACT_PREFIX + JSON.stringify({ team: 'ended' }) }]
    expect(applyTeamEvent(roster, codeDispatchEvent('team_dismiss', {}, content, { isError: true }), BOUND)).toBe(roster)
    expect(applyTeamEvent(roster, codeDispatchEvent('bash', {}, content), BOUND)).toBe(roster)
  })
})

describe('host registry integration', () => {
  it('persists nested facts through run_code while preserving native results and program values', async () => {
    const host = new Context()
    host.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 0 } })
    host.provide('team', { spawn: async () => alice })
    const args = { name: 'Alice', relation: 'peer', task: 'review', reasoning_effort: 'high' }
    host.provide('codeRuntime', {
      language: 'typescript',
      async run(request: { bindings: Array<{ functions: Record<string, (args: unknown) => Promise<unknown>> }> }) {
        const functions = request.bindings[0]!.functions
        const value = await functions['team_spawn']!(args)
        expect(value).toEqual(alice)
        await expect(functions['team_spawn']!({ name: 'invalid' })).rejects.toThrow()
        return { logs: [], value }
      },
    })
    const runtime = new ToolRuntime(host, { mode: 'both' })
    runtime.register(spawnTool(host))
    const leader = fakeAgent('leader-1')
    const events: SessionEvent[] = []
    Object.assign(leader.session, {
      append(type: string, data: unknown) {
        events.push({ type, data, seq: events.length + 1, time: TIME } as SessionEvent)
      },
    })
    const signal = new AbortController().signal
    const native = await runtime.execute({ callId: ToolCallId('native'), name: 'team_spawn', arguments: args, agent: leader.agent, signal })
    expect(native.isError).toBe(false)
    expect(native.content).toEqual(spawnTool(host).output.render(args, alice))
    expect(native.meta).toEqual({ team: 'member-added', member: alice })

    const result = await runtime.execute({
      callId: ToolCallId('outer'), name: 'run_code', arguments: { code: 'fixture', description: 'test team spawn' }, agent: leader.agent, signal,
    })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ logs: [], result: alice })
    const settled = events.filter(event => event.type === 'tool/code-dispatch')
    expect(settled).toHaveLength(2)
    expect(settled.map(event => event.data.isError)).toEqual([false, true])
    // Exercise the durable JSON boundary: no value/meta property is available
    // on these actual host events, only finalized content and arguments.
    const replay = JSON.parse(JSON.stringify(events)) as SessionEvent[]
    expect(foldTeam(replay, BOUND).members).toEqual([{ ...alice, joinedAt: TIME }])
  })
})
