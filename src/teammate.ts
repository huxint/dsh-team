/**
 * The teammate world: what one continuable child gains when it is a member of
 * a team. The setup follows the agent lifecycle: it is installed as soon as a
 * child is published and removed on disposal.
 *
 * A child that belongs to no team receives nothing: an ordinary subagent must
 * not see team tools it cannot use.
 *
 * @module dsh-team/teammate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type { TeamService } from './service.ts'
import { boardTool, listTool, noteTool, sendTool } from './tools.ts'
import type { TeamWorkspace } from './workspace.ts'

/** Guidance order: after the harness tool sections, before the persona. */
const TEAM_SECTION_ORDER = 118

/** The workspace paragraph sits right after the membership briefing. */
const WORKSPACE_SECTION_ORDER = 119

/** What a teammate needs to know about the two workspaces it can reach. */
const WORKSPACE_BRIEFING = [
  'Your team has two virtual workspaces, which are not files and are not in the user\'s working tree.',
  'The shared board (team_board / team_note) is what every member reads and writes: put a conclusion, a '
  + 'decision or hand-off material there instead of messaging it around — a note costs nobody a turn and '
  + 'survives after you go idle, while a message costs the recipient a turn and spends conversation budget. '
  + 'Read the board before you ask anyone anything; the answer may already be on it.',
  'Your private pad (the same tools with private=true) is yours alone: keep your own working state there so '
  + 'a later turn of yours can pick it up.',
].join('\n')

/** Dispose a batch completely, then report the first failure. */
function release(disposers: readonly (() => void)[]): void {
  const failures: unknown[] = []
  for (const dispose of [...disposers].reverse()) {
    try {
      dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'dsh-team: teammate teardown failed')
}

type ChildSetup = (childCtx: Context) => () => void

/** Observe the live agent registry so cold resumes and fresh children share one setup path. */
function registerChildSetup(ctx: Context, setup: ChildSetup): () => void {
  const installed = new Map<SessionId, () => void>()
  const install = (agent: Agent): void => {
    if (agent.session.header.origin !== 'subagent' || installed.has(agent.id)) return
    const dispose = setup(agent.ctx)
    installed.set(agent.id, dispose)
  }
  const disposeCreated = ctx.on('agent/created', (payload: { agent: Agent }) => { install(payload.agent) })
  const disposeRemoved = ctx.on('agent/disposed', (payload: { agent: Agent }) => {
    const dispose = installed.get(payload.agent.id)
    installed.delete(payload.agent.id)
    dispose?.()
  })
  for (const agent of ctx.agents.list()) install(agent)
  return () => {
    disposeRemoved()
    disposeCreated()
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }
}

/** One roster line as a teammate reads it. */
function memberLine(member: { name: string; role?: string; relation: string }): string {
  const parts = [member.role, member.relation === 'peer' ? 'peer' : 'managed'].filter(part => part !== undefined)
  return `${member.name} (${parts.join(', ')})`
}

/**
 * What a teammate is told when its roster row cannot be read. Two different
 * facts wear that one absence, and they ask for opposite things: a leader
 * session that is merely not loaded still has a team behind it, so the work is
 * worth finishing and parking on the shared board; a team that let this member
 * go has nobody left to read anything.
 */
function orphaned(ctx: Context, child: Agent): string {
  const leaderId = child.session.header.parentSession
  if (leaderId !== undefined && ctx.agents.get(leaderId) === undefined) {
    return 'Your team is intact, but its main session is not loaded right now, so team_send has nowhere to '
      + 'deliver. Your work is not lost: finish what you were asked for, write the result to the shared '
      + 'workspace with team_note if you have one, and stop — the leader reads it when it comes back.'
  }
  return 'You were part of an agent team that is no longer active: nothing you send can be delivered and '
    + 'nobody is waiting on you. Report what you already have and stop.'
}

/**
 * The teammate's standing briefing, re-rendered at every assembly so a member
 * that joins later, a promotion, or a new task is visible on the next step
 * without touching the child's own log.
 */
function briefing(ctx: Context, team: TeamService, child: Agent): string {
  const roster = team.rosterFor(child)
  if (roster === undefined) return orphaned(ctx, child)
  const { self, others } = roster
  const identity = self.role === undefined
    ? `You are ${self.name}, a teammate on an agent team.`
    : `You are ${self.name}, the ${self.role} on an agent team.`
  const reach = self.relation === 'peer'
    ? 'You are a peer member: team_send reaches the leader ("leader") and any teammate by name.'
    : 'You are a managed member: team_send reaches the leader ("leader") only.'
  const list = others.length === 0
    ? 'You are currently the only teammate.'
    : `The rest of the team: ${others.map(memberLine).join('; ')}.`
  const mine = team.list(child).tasks.filter(task => task.assigneeId === self.memberId && task.status !== 'done')
  const tasks = mine.length === 0
    ? 'No task on the shared list is assigned to you right now.'
    : `Assigned to you on the shared task list: ${mine.map(task => `${task.taskId} "${task.title}"`).join('; ')}.`
  return [
    identity,
    reach,
    list,
    tasks,
    'Nobody sees your session but you, so deliver results to the leader with team_send — a self-contained answer, '
    + 'not "done". Use team_send when you need something FROM a member mid-task; the reply arrives later as its '
    + 'own turn, so do not wait for it in place. team_list shows the roster, the shared task list, and recent '
    + 'traffic. When you have sent the outcome, stop and wait for the next message instead of starting work nobody '
    + 'asked for. A conversation between teammates is budgeted: it may only relay so far and one pair may not '
    + 'keep trading messages inside it, so put everything you need into one message rather than negotiating. '
    + 'Reaching the leader is never refused — when an exchange with a peer stops converging, say so to the '
    + 'leader and move on.',
  ].join('\n')
}

/**
 * Register the teammate composition for every continuable child of a team.
 * @param ctx - context carrying the team and subagent services.
 * @returns the exact effect disposer removing the contribution.
 */
export function installTeammateWorld(ctx: Context): () => void {
  return registerChildSetup(ctx, (childCtx) => {
    const child = childCtx.agent
    if (child === undefined) return () => {}
    const member = ctx.team.adopt(child)
    if (member === undefined) return () => {}
    const disposers: Array<() => void> = []
    try {
      disposers.push(childCtx.systemPrompt.section({
        name: 'team-membership',
        order: TEAM_SECTION_ORDER,
        text: () => briefing(ctx, ctx.team, child),
      }))
      disposers.push(childCtx.tools.register(sendTool(ctx, 'member')))
      disposers.push(childCtx.tools.register(listTool(ctx, 'member')))
    } catch (error: unknown) {
      release(disposers)
      throw error
    }
    return () => { release(disposers) }
  })
}

/**
 * Give every teammate its half of the virtual workspaces: the shared board it
 * writes conclusions to, and its own private pad. Registered separately from
 * {@link installTeammateWorld} because the workspaces are optional — a
 * deployment without a storage domain form composes this contribution out and
 * the rest of the teammate world is untouched.
 * @param ctx - context carrying the team service and the open workspace.
 * @param workspace - the open workspace domain.
 * @returns the exact effect disposer removing the contribution.
 */
export function installTeammateWorkspace(ctx: Context, workspace: TeamWorkspace): () => void {
  return registerChildSetup(ctx, (childCtx) => {
    const child = childCtx.agent
    const leaderId = child?.session.header.parentSession
    const roster = child === undefined ? undefined : ctx.team.rosterFor(child)
    if (child === undefined || leaderId === undefined || roster === undefined) return () => {}
    // The seat is captured here, not resolved per call: the workspace is the
    // one surface a teammate must keep while its leader session is unloaded.
    const seat = { leaderId, memberId: child.id, name: roster.self.name }
    const seatOf = (): typeof seat => seat
    const disposers: Array<() => void> = []
    try {
      disposers.push(childCtx.systemPrompt.section({
        name: 'team-workspace',
        order: WORKSPACE_SECTION_ORDER,
        text: WORKSPACE_BRIEFING,
      }))
      disposers.push(childCtx.tools.register(noteTool(workspace, 'member', seatOf)))
      disposers.push(childCtx.tools.register(boardTool(workspace, 'member', seatOf)))
    } catch (error: unknown) {
      release(disposers)
      throw error
    }
    return () => { release(disposers) }
  })
}
