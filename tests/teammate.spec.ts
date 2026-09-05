/**
 * The teammate world: what one continuable child gains when — and only when —
 * it belongs to a team.
 *
 * @module dsh-team/tests/teammate
 */

import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import { TeamService } from '../src/service.ts'
import { installTeammateWorld } from '../src/teammate.ts'
import type { TeamConfig } from '../src/config.ts'
import { FakeAgents, FakeSubagents, FakeSystemPrompt, FakeTools, fakeAgent, type FakeAgent } from './harness.ts'

const CONFIG: TeamConfig = {
  provider: 'spawn', maxTeammates: 8, maxRecentMessages: 20, maxChainHops: 4, maxChainRoundTrips: 2,
  maxWorkspaceEntries: 8, maxNoteChars: 400,
}
const signal = new AbortController().signal

/** The world one continuable child is composed in. */
interface Child {
  readonly ctx: Context
  readonly tools: FakeTools
  readonly prompt: FakeSystemPrompt
  readonly agent: FakeAgent
  readonly release: () => void
}

let ctx: Context
let agents: FakeAgents
let subagents: FakeSubagents
let service: TeamService
let leader: FakeAgent
let removeWorld: () => void

beforeEach(() => {
  ctx = new Context()
  agents = new FakeAgents(ctx)
  subagents = new FakeSubagents()
  subagents.publishChild = (childId, parentId, options) => {
    agents.add(fakeAgent(String(childId), {
      parent: String(parentId),
      ...typeof options?.model === 'string' ? { model: options.model } : {},
      ...typeof options?.reasoningEffort === 'string' ? { reasoningEffort: options.reasoningEffort } : {},
    }))
  }
  ctx.provide('agents', agents)
  ctx.provide('subagents', subagents)
  service = new TeamService(ctx, CONFIG)
  leader = agents.add(fakeAgent('leader-1'))
  removeWorld = installTeammateWorld(ctx)
})

/** Read the child scope composed by the agent lifecycle listener. */
function compose(agent: FakeAgent): Child {
  return {
    ctx: agent.ctx,
    tools: agent.tools,
    prompt: agent.prompt,
    agent,
    release: () => agents.remove(agent.id),
  }
}

/** Spawn one teammate and publish its live agent double. */
async function spawn(name: string, options: {
  readonly relation?: 'managed' | 'peer'
  readonly effort?: string
} = {}): Promise<FakeAgent> {
  subagents.nextChildId = `child-${subagents.started.length + 1}`
  const member = await service.spawn(leader.agent, {
    name,
    task: `do ${name}'s work`,
    relation: options.relation ?? 'managed',
    ...options.effort !== undefined ? { reasoningEffort: options.effort } : {},
  }, signal)
  const child = agents.getFake(member.memberId)
  if (child === undefined) throw new Error(`published child ${member.memberId} is missing`)
  return child
}

describe('composition', () => {
  it('composes published children and removes their world on disposal', () => {
    removeWorld()
    const child = fakeAgent('child-1', { parent: leader.id })
    agents.add(child)
    expect(child.tools.registered).toEqual([])
  })

  it('gives an ordinary subagent nothing at all', () => {
    const stranger = compose(agents.add(fakeAgent('other-child', { parent: 'unrelated-leader' })))
    expect(stranger.tools.registered).toEqual([])
    expect(stranger.prompt.sections).toEqual([])
    stranger.release()
  })

  it('equips a teammate with the mailbox, the team read, and its briefing', async () => {
    const child = compose(await spawn('Alice', { relation: 'peer' }))
    expect(child.tools.registered.map(tool => tool.name)).toEqual(['team_send', 'team_list'])
    expect(child.prompt.sections).toHaveLength(1)
    expect(child.prompt.sections[0]).toMatchObject({ name: 'team-membership', order: 118 })
  })

  it('unwinds every registration with the child', async () => {
    const child = compose(await spawn('Alice'))
    child.release()
    expect(child.tools.registered).toEqual([])
    expect(child.prompt.sections).toEqual([])
  })
})

describe('briefing', () => {
  it('states the identity, the reach a relation grants, and the rest of the team', async () => {
    const alice = await spawn('Alice', { relation: 'peer' })
    await spawn('Bob')
    const child = compose(alice)
    const text = child.prompt.sections[0]!.text()

    expect(text).toContain('You are Alice')
    expect(text).toContain('peer member')
    expect(text).toContain('Bob (managed)')
    expect(text).not.toContain('Alice (')
  })

  it('tells a managed teammate that its only correspondent is the leader', async () => {
    const child = compose(await spawn('Bob'))
    expect(child.prompt.sections[0]!.text()).toContain('managed member')
  })

  it('re-renders live, so a later teammate and a new task are visible next step', async () => {
    const alice = await spawn('Alice', { relation: 'peer' })
    const child = compose(alice)
    expect(child.prompt.sections[0]!.text()).toContain('only teammate')

    await spawn('Bob')
    service.upsertTask(leader.agent, { title: 'review the diff', assigneeId: 'Alice' })
    const text = child.prompt.sections[0]!.text()
    expect(text).toContain('Bob (managed)')
    expect(text).toContain('t1 "review the diff"')
  })

  it('tells a dismissed teammate its team is gone instead of failing to render', async () => {
    const alice = await spawn('Alice')
    const child = compose(alice)
    service.dismiss(leader.agent, 'Alice')
    expect(child.prompt.sections[0]!.text()).toContain('no longer active')
  })

  it('tells a teammate whose leader unloaded that the team is intact, and where to park the work', async () => {
    const alice = await spawn('Alice')
    const child = compose(alice)
    agents.remove(leader.id)
    const text = child.prompt.sections[0]!.text()
    expect(text).toContain('team is intact')
    expect(text).toContain('team_note')
    expect(text).not.toContain('no longer active')
  })
})
