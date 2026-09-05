/**
 * The `team` projection unit: the single place the fold runs, and the value the
 * framework serves to the browser.
 *
 * @module dsh-team/tests/projection
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_TEAM_VIEW, type TeamView } from '../src/contract.ts'
import { teamProjection } from '../src/projection.ts'
import { testHeader, toolResultEvent, userMessageEvent } from './harness.ts'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'

const unit = teamProjection(3)

describe('teamProjection', () => {
  it('is registered under the key the client reads, with a stated state version', () => {
    expect(unit.key).toBe('team')
    expect(unit.stateVersion).toBe(4)
    expect(unit.init(testHeader(), SessionLogOffset(0))).toEqual(EMPTY_TEAM_VIEW)
  })

  it('serves its state as the value: one fold, no second shape to keep in step', () => {
    const state = unit.apply(unit.init(testHeader(), SessionLogOffset(0)), toolResultEvent({
      team: 'member-added',
      member: { memberId: 'child-1', name: 'Alice', relation: 'peer' },
    }))
    expect(unit.wire.view(state)).toBe(state)
  })

  it('returns the same state for an event it does not own', () => {
    const state = unit.init(testHeader(), SessionLogOffset(0))
    expect(unit.apply(state, toolResultEvent({ tool: 'bash' }))).toBe(state)
  })

  it('honours the deployment mailbox bound it was built with', () => {
    let state = unit.init(testHeader(), SessionLogOffset(0))
    for (let index = 0; index < 5; index += 1) {
      state = unit.apply(state, toolResultEvent({
        team: 'message', messageId: `m${index}`, to: 'child-1', text: `t${index}`,
      }))
    }
    expect(state.messages.map(message => message.messageId)).toEqual(['m2', 'm3', 'm4'])
  })

  it('validates the whole served value, including every mailbox kind', () => {
    let state = unit.apply(unit.init(testHeader(), SessionLogOffset(0)), toolResultEvent({
      team: 'member-added',
      member: { memberId: 'child-1', name: 'Alice', relation: 'peer', role: 'reviewer', model: 'x', effort: 'high' },
    }))
    state = unit.apply(state, toolResultEvent({
      team: 'task', task: { taskId: 't1', title: 'ship', status: 'done', assigneeId: 'child-1', note: 'merged' },
    }))
    state = unit.apply(state, toolResultEvent({ team: 'message', messageId: 'm1', to: 'child-1', text: 'go' }))
    state = unit.apply(state, userMessageEvent(
      { kind: 'subagent-report', senderSessionId: 'child-1' } as never,
      'reviewed',
    ))
    state = unit.apply(state, userMessageEvent(
      { kind: 'subagent-settled', senderSessionId: 'child-1', summary: 'Alice finished' } as never,
      '',
    ))

    expect(state.messages.map(message => message.kind)).toEqual(['message', 'report', 'settled'])
    expect(unit.stateSchema.parse(state)).toEqual(state)
  })

  it('refuses a cached state that no longer matches the served shape', () => {
    const broken = { ...EMPTY_TEAM_VIEW, members: [{ memberId: 'child-1', name: 'Alice' }] } as unknown as TeamView
    expect(() => unit.stateSchema.parse(broken)).toThrow()
  })
})
