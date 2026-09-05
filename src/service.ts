/**
 * The agent-team service: roster, mailbox routing with its relation-based
 * authorization, the shared task list, and the team lifecycle.
 *
 * Teammates are NOT a private runtime. Each one is a continuable subagent of
 * the leader (`ctx.subagents.startContinuable`), so the harness owns identity,
 * residency, cold resume after a restart, interrupt, and the `origin:
 * 'subagent'` session header that keeps a teammate out of the session tree and
 * out of generic Host routing. What this service adds is what the subagent
 * seam deliberately leaves out: named members, member-to-member delivery, and
 * one shared task list.
 *
 * Delivery authority is always the leader's. `ctx.subagents` authorizes a
 * follow-up against the durable direct-parent lineage only ("teams remain
 * rejected until an explicit authority protocol has a production consumer"),
 * and the leader IS every teammate's durable direct parent. A peer-to-peer
 * message is therefore a leader-authorized delivery whose durable source names
 * the real sender; `relation` decides who may ASK for it, never who may
 * perform it.
 *
 * @module dsh-team/service
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import { queueHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  EMPTY_TEAM_VIEW, type TeamChain, type TeamMemberView, type TeamMessageView, type TeamRelation,
  type TeamTaskStatus, type TeamTaskView, type TeamView,
} from './contract.ts'
import { TeamError } from './errors.ts'
import { foldTeam, type TeamMemberFact } from './fold.ts'
import type { TeamConfig } from './config.ts'

/** Live lifecycle of one teammate, as `list_agents` names the same states. */
export type MemberStatus = 'running' | 'idle' | 'ready'

/** How many recent conversation chains one team keeps enforcement state for. */
const CHAIN_MEMORY = 64

/** Traffic one conversation chain has already carried, per ordered pair. */
interface ChainRecord {
  /** Deliveries per `from → to` pair. */
  readonly edges: Map<string, number>
  /** The last text each ordered pair carried, so a verbatim repeat is refused. */
  readonly said: Map<string, string>
}

/** The live team of one leader session. */
interface TeamState {
  active: boolean
  readonly members: Map<string, TeamMemberFact>
  readonly tasks: Map<string, TeamTaskView>
  /**
   * The delivery each member is working from. A teammate's own sends inherit
   * it, which is what makes a peer exchange one bounded conversation rather
   * than an unbounded sequence of unrelated messages.
   */
  readonly inbox: Map<string, TeamChain>
  /** Enforcement state per chain, oldest first and bounded by {@link CHAIN_MEMORY}. */
  readonly chains: Map<string, ChainRecord>
  /** Monotonic chain counter for this leader's live team. */
  started: number
}

/** A spawn in flight: identity for the teammate scope that is being composed. */
interface PendingSpawn {
  readonly fact: Omit<TeamMemberFact, 'memberId'>
  /** Child ids adopted by the setup contribution, rolled back on failure. */
  readonly claimed: string[]
}

/** What the leader asks for when spawning one teammate. */
export interface TeamSpawnRequest {
  readonly name: string
  readonly role?: string
  readonly persona?: string
  readonly relation: TeamRelation
  readonly task: string
  readonly model?: string
  readonly reasoningEffort?: string
}

/** One roster row with its live runtime state. */
export interface TeamMemberStatusView extends TeamMemberView {
  readonly status: MemberStatus
}

/** The model-facing team read. */
export interface TeamListResult {
  readonly active: boolean
  readonly members: readonly TeamMemberStatusView[]
  readonly tasks: readonly TeamTaskView[]
  readonly messages: readonly TeamMessageView[]
}

/** Where one member sits: whose workspace it reaches, and how a note is signed. */
export interface TeamSeat {
  readonly leaderId: string
  readonly memberId: string
  readonly name: string
}

/** Who is acting, and which team they act in. */
interface Actor {
  /** The live leader agent whose parent authority every delivery uses. */
  readonly leader: Agent
  readonly team: TeamState
  /** The acting teammate, or undefined when the leader itself is acting. */
  readonly member?: TeamMemberFact
}

/** One resolved delivery recipient. */
type Recipient =
  | { readonly kind: 'leader'; readonly id: string; readonly name: string }
  | { readonly kind: 'member'; readonly id: string; readonly name: string; readonly member: TeamMemberFact }

/** `Context.team`: roster, mailbox routing, tasks, and team lifecycle. */
export class TeamService extends Service {
  static inject = ['agents', 'sessions', 'subagents', 'sessionProjections']

  /** Live team per leader session id; rebuilt lazily from that session's log. */
  private readonly teams = new Map<string, TeamState>()
  /** Spawns in flight, keyed by leader session id (team tools never overlap). */
  private readonly pending = new Map<string, PendingSpawn>()

  constructor(ctx: Context, private readonly config: TeamConfig) {
    super(ctx, 'team')
    // A leader's live team is a cache of its log. Dropping it with the agent
    // keeps a resumed session from inheriting the previous lifecycle's roster,
    // and keeps this map from growing with every session ever touched.
    ctx.on('agent/disposed', (payload: { agent: Agent }) => {
      this.teams.delete(payload.agent.id)
      this.pending.delete(payload.agent.id)
    })
  }

  /**
   * The live team of one leader, rebuilt from its log on first touch. Nothing
   * is resumed here: a teammate materializes only when a message reaches it.
   * @param leader - the leader session's live agent.
   * @returns the mutable live team state.
   */
  teamOf(leader: Agent): TeamState {
    const existing = this.teams.get(leader.id)
    if (existing !== undefined) return existing
    const view = this.durableView(leader)
    const state: TeamState = {
      active: view.active,
      members: new Map(view.members.map(member => [member.memberId, memberFact(member)])),
      tasks: new Map(view.tasks.map(task => [task.taskId, task])),
      inbox: new Map(),
      chains: new Map(),
      started: 0,
    }
    this.teams.set(leader.id, state)
    return state
  }

  /**
   * Adopt one continuable child into the team world while its scope is being
   * composed. Called from the teammate setup contribution after the child is
   * published — on cold resume the child is already on the leader's roster,
   * and only a child the roster has never seen can be the spawn currently in
   * flight.
   * @param child - the unpublished child agent.
   * @returns the membership facts, or undefined for a child outside any team.
   */
  adopt(child: Agent): TeamMemberFact | undefined {
    const leaderId = child.session.header.parentSession
    if (leaderId === undefined) return undefined
    const leader = this.ctx.agents.get(leaderId)
    if (leader === undefined) return undefined
    const team = this.teamOf(leader)
    // Roster first: a cold resume of one teammate may run while another spawn
    // is in flight (a peer's message wakes it), and claiming the pending
    // identity for it would give two children the same name.
    const known = team.members.get(child.id)
    if (known !== undefined) return known
    const pending = this.pending.get(leaderId)
    if (pending === undefined) return undefined
    const fact: TeamMemberFact = { ...pending.fact, memberId: child.id }
    pending.claimed.push(child.id)
    team.members.set(child.id, fact)
    return fact
  }

  /**
   * Spawn one teammate: a continuable subagent of the leader plus a roster row.
   * @param leader - the acting leader agent.
   * @param request - name, relation, initial task, and optional overrides.
   * @param signal - cancellation owning the operation until the teammate accepts its brief.
   * @returns the new member's durable facts.
   * @throws {TeamError} when the actor cannot lead, or the roster is full.
   */
  async spawn(leader: Agent, request: TeamSpawnRequest, signal: AbortSignal): Promise<TeamMemberFact> {
    if (leader.session.header.origin === 'subagent') throw new TeamError('NESTED_TEAM')
    const team = this.teamOf(leader)
    if (team.members.size >= this.config.maxTeammates) {
      throw new TeamError('MAX_TEAMMATES', String(this.config.maxTeammates))
    }
    if (findByName(team, request.name) !== undefined) throw new TeamError('DUPLICATE_NAME', request.name)
    await this.assertEffortOffered(leader, request)
    const agentOptions: AgentOptions = {
      ...request.model !== undefined ? { model: request.model } : {},
      ...request.reasoningEffort !== undefined
        ? { reasoningEffort: ReasoningEffortId(request.reasoningEffort) }
        : {},
    }
    const pending: PendingSpawn = {
      fact: {
        name: request.name,
        relation: request.relation,
        ...request.role !== undefined ? { role: request.role } : {},
        ...request.model !== undefined ? { model: request.model } : {},
        ...request.reasoningEffort !== undefined ? { effort: request.reasoningEffort } : {},
      },
      claimed: [],
    }
    this.pending.set(leader.id, pending)
    let childId: SessionIdType
    try {
      const started = await this.ctx.subagents.startContinuable({
        provider: this.config.provider,
        label: request.role === undefined ? request.name : `${request.name} (${request.role})`,
        request: {
          parent: leader,
          prompt: [{ type: 'text', text: brief(request) }],
          ...request.persona !== undefined ? { persona: request.persona } : {},
          ...Object.keys(agentOptions).length > 0 ? { agentOptions } : {},
        },
        signal,
      })
      childId = started.childId
    } catch (error: unknown) {
      // The child rolled back: drop whatever its composition window adopted so
      // a failed spawn never leaves a phantom on the roster.
      for (const claimed of pending.claimed) team.members.delete(claimed)
      throw error
    } finally {
      this.pending.delete(leader.id)
    }
    const fact: TeamMemberFact = { ...pending.fact, memberId: childId }
    team.members.set(childId, fact)
    team.active = true
    this.ctx.emit('team/changed', { leaderId: leader.id })
    return fact
  }

  /**
   * Deliver one mailbox message. The leader may message any teammate; a peer
   * teammate may message the leader or any other teammate; a managed teammate
   * may message only the leader.
   *
   * A teammate-to-teammate delivery also spends chain budget: it continues the
   * conversation its sender is working from, and that conversation may only
   * relay so far and may not repeat one ordered pair. Escalation to the leader
   * spends nothing, so the guard converges a peer exchange without ever
   * trapping a member with something to say.
   * @param from - the acting agent (leader or teammate).
   * @param to - recipient member id or member name; `leader` addresses the leader.
   * @param text - the message content.
   * @param signal - cancellation owning the delivery until inbox acceptance.
   * @returns the accepted message id, the resolved recipient, and the chain it joined.
   * @throws {TeamError} when the actor is outside the team, the recipient is
   *   unknown, the actor's relation forbids the delivery, or the conversation
   *   has spent its budget.
   */
  async send(
    from: Agent,
    to: string,
    text: string,
    signal: AbortSignal,
  ): Promise<{ readonly messageId: string; readonly recipient: Recipient; readonly chain: TeamChain }> {
    const actor = this.resolveActor(from)
    const recipient = this.resolveRecipient(actor, to)
    if (actor.member !== undefined && actor.member.relation === 'managed' && recipient.kind !== 'leader') {
      throw new TeamError('UNAUTHORIZED', `${actor.member.name} is a managed teammate and may only message the leader`)
    }
    if (recipient.id === from.id) throw new TeamError('SELF_MESSAGE')
    const chain = this.chainFor(actor, from)
    if (recipient.kind === 'member') this.assertBudget(actor.team, chain, from.id, recipient, text)
    const messageId = await this.deliver(actor, recipient, [{ type: 'text', text }], signal, chain)
    this.recordDelivery(actor.team, chain, from.id, recipient, text)
    return { messageId, recipient, chain }
  }

  /**
   * Create or update one shared task. Writes are the leader's: a teammate's
   * own tool calls land in its own log, which the leader's durable team state
   * never reads — teammates report, and the leader records the outcome.
   * @param leader - the acting leader agent.
   * @param spec - a new task (title) or an update to an existing one (taskId).
   * @returns the whole post-change task.
   * @throws {TeamError} when the actor is not the leader, the task is unknown,
   *   or the assignee is not on the roster.
   */
  upsertTask(leader: Agent, spec: {
    readonly taskId?: string
    readonly title?: string
    readonly assigneeId?: string
    readonly status?: TeamTaskStatus
    readonly note?: string
  }): TeamTaskView {
    const actor = this.resolveActor(leader)
    if (actor.member !== undefined) throw new TeamError('UNAUTHORIZED', 'only the leader writes the task list')
    const assigneeId = spec.assigneeId === undefined
      ? undefined
      : this.resolveRecipient(actor, spec.assigneeId).id
    if (spec.taskId === undefined) {
      if (spec.title === undefined) throw new TeamError('TASK_TITLE_REQUIRED')
      const task: TeamTaskView = {
        taskId: taskIdOf(actor.team),
        title: spec.title,
        status: spec.status ?? 'pending',
        ...assigneeId !== undefined ? { assigneeId } : {},
        ...spec.note !== undefined ? { note: spec.note } : {},
      }
      actor.team.tasks.set(task.taskId, task)
      this.ctx.emit('team/changed', { leaderId: actor.leader.id })
      return task
    }
    const previous = actor.team.tasks.get(spec.taskId)
    if (previous === undefined) throw new TeamError('UNKNOWN_TASK', spec.taskId)
    const task: TeamTaskView = {
      ...previous,
      ...spec.title !== undefined ? { title: spec.title } : {},
      ...spec.status !== undefined ? { status: spec.status } : {},
      ...assigneeId !== undefined ? { assigneeId } : {},
      ...spec.note !== undefined ? { note: spec.note } : {},
    }
    actor.team.tasks.set(task.taskId, task)
    this.ctx.emit('team/changed', { leaderId: actor.leader.id })
    return task
  }

  /**
   * Change one teammate's relationship level.
   * @param leader - the acting leader agent.
   * @param target - the teammate's member id or name.
   * @param relation - the new relation.
   * @returns the whole post-change member record.
   * @throws {TeamError} when the actor is not the leader or the member is unknown.
   */
  setRelation(leader: Agent, target: string, relation: TeamRelation): TeamMemberFact {
    const actor = this.resolveActor(leader)
    if (actor.member !== undefined) throw new TeamError('UNAUTHORIZED', 'only the leader changes relations')
    const recipient = this.resolveRecipient(actor, target)
    if (recipient.kind !== 'member') throw new TeamError('UNKNOWN_MEMBER', target)
    const fact: TeamMemberFact = { ...recipient.member, relation }
    actor.team.members.set(fact.memberId, fact)
    this.ctx.emit('team/changed', { leaderId: actor.leader.id })
    return fact
  }

  /**
   * Dismiss one teammate, or end the whole team when no target is given. A
   * dismissed teammate stops its current turn and stops receiving mail; its
   * durable session stays readable through the subagent catalog.
   * @param leader - the acting leader agent.
   * @param target - the teammate's member id or name; absent ends the team.
   * @returns whether the team ended, plus the dismissed member id when targeted.
   * @throws {TeamError} when the actor is not the leader or the member is unknown.
   */
  dismiss(leader: Agent, target?: string): { readonly ended: boolean; readonly memberId?: string } {
    const actor = this.resolveActor(leader)
    if (actor.member !== undefined) throw new TeamError('UNAUTHORIZED', 'only the leader dismisses teammates')
    if (target === undefined) {
      for (const memberId of [...actor.team.members.keys()]) this.stopMember(actor.leader, memberId)
      actor.team.members.clear()
      actor.team.tasks.clear()
      actor.team.inbox.clear()
      actor.team.chains.clear()
      actor.team.active = false
      this.ctx.emit('team/changed', { leaderId: actor.leader.id, ended: true })
      return { ended: true }
    }
    const recipient = this.resolveRecipient(actor, target)
    if (recipient.kind !== 'member') throw new TeamError('UNKNOWN_MEMBER', target)
    this.stopMember(actor.leader, recipient.id)
    actor.team.members.delete(recipient.id)
    // A dismissed member carries no conversation forward; a later member
    // reusing its id would otherwise inherit a stranger's chain.
    actor.team.inbox.delete(recipient.id)
    this.ctx.emit('team/changed', { leaderId: actor.leader.id, removedMember: recipient.id })
    return { ended: false, memberId: recipient.id }
  }

  /**
   * The roster, task list, and recent leader-visible mailbox traffic, from the
   * point of view of any member of the team.
   * @param actorAgent - the acting leader or teammate.
   * @returns the live team read; an inactive team reports empty lists.
   */
  list(actorAgent: Agent): TeamListResult {
    const actor = this.tryResolveActor(actorAgent)
    if (actor === undefined) return { active: false, members: [], tasks: [], messages: [] }
    const view = this.durableView(actor.leader)
    return {
      active: actor.team.active,
      members: [...actor.team.members.values()].map(member => ({
        ...member,
        joinedAt: view.members.find(row => row.memberId === member.memberId)?.joinedAt ?? 0,
        status: this.statusOf(member.memberId),
      })),
      tasks: [...actor.team.tasks.values()],
      messages: [...view.messages],
    }
  }

  /**
   * Where one acting agent sits in its team: whose workspace it reaches, and
   * how a note it writes is attributed. The leader's own seat carries its
   * session id, so its private pad is addressed exactly like a teammate's.
   * @param agent - the acting leader or teammate.
   * @returns the team's leader id, the actor's own id, and its display name.
   * @throws {TeamError} when the actor is not in a team.
   */
  seatOf(agent: Agent): TeamSeat {
    const actor = this.resolveActor(agent)
    return {
      leaderId: actor.leader.id,
      memberId: actor.member?.memberId ?? actor.leader.id,
      name: actor.member?.name ?? 'leader',
    }
  }

  /**
   * The teammate roster as one teammate should see it, for its prompt section.
   * @param member - the teammate agent.
   * @returns the leader-relative roster, or undefined outside a team.
   */
  rosterFor(member: Agent): { readonly self: TeamMemberFact; readonly others: readonly TeamMemberFact[] } | undefined {
    const actor = this.tryResolveActor(member)
    if (actor?.member === undefined) return undefined
    return {
      self: actor.member,
      others: [...actor.team.members.values()].filter(row => row.memberId !== member.id),
    }
  }

  /** The durable view the leader's log folds to (the projection registry's cached cut). */
  private durableView(leader: Agent): TeamView {
    const registry = this.ctx.get('sessionProjections')
    if (registry === undefined) {
      return foldTeam(leader.session.snapshotEvents(), this.config.maxRecentMessages)
    }
    const value = registry.snapshot(leader.session).values.team
    return value ?? EMPTY_TEAM_VIEW
  }

  /** Live runtime state of one teammate; `ready` means no live agent remains. */
  private statusOf(memberId: string): MemberStatus {
    const agent = this.ctx.agents.get(SessionId(memberId))
    if (agent === undefined) return 'ready'
    return agent.status === 'running' ? 'running' : 'idle'
  }

  /**
   * Resolve the acting agent's team, or fail loud — and say WHICH failure it
   * is. A teammate whose leader session is simply not loaded is not a teammate
   * without a team: every delivery runs on the leader's parent authority, so
   * the mailbox is shut until the leader is back, while the workspace (which
   * needs nobody) stays open. Telling it "no team here yet" would send it to
   * spawn one, which it cannot do.
   */
  private resolveActor(agent: Agent): Actor {
    const actor = this.tryResolveActor(agent)
    if (actor !== undefined) return actor
    const leaderId = agent.session.header.parentSession
    if (agent.session.header.origin === 'subagent'
      && leaderId !== undefined
      && this.ctx.agents.get(leaderId) === undefined) {
      throw new TeamError('LEADER_AWAY')
    }
    throw new TeamError('NO_TEAM')
  }

  /** Resolve the acting agent's team, or report absence. */
  private tryResolveActor(agent: Agent): Actor | undefined {
    if (agent.session.header.origin !== 'subagent') {
      return { leader: agent, team: this.teamOf(agent) }
    }
    const leaderId = agent.session.header.parentSession
    if (leaderId === undefined) return undefined
    const leader = this.ctx.agents.get(leaderId)
    if (leader === undefined) return undefined
    const team = this.teamOf(leader)
    const member = team.members.get(agent.id)
    return member === undefined ? undefined : { leader, team, member }
  }

  /** Resolve one address (member id, member name, or `leader`) to a recipient. */
  private resolveRecipient(actor: Actor, address: string): Recipient {
    const normalized = address.trim()
    if (normalized.length === 0) throw new TeamError('UNKNOWN_MEMBER', address)
    if (normalized === actor.leader.id || normalized.toLowerCase() === 'leader') {
      return { kind: 'leader', id: actor.leader.id, name: 'leader' }
    }
    const byId = actor.team.members.get(normalized)
    if (byId !== undefined) return { kind: 'member', id: byId.memberId, name: byId.name, member: byId }
    const byName = findByName(actor.team, normalized)
    if (byName !== undefined) return { kind: 'member', id: byName.memberId, name: byName.name, member: byName }
    throw new TeamError('UNKNOWN_MEMBER', address)
  }

  /**
   * The chain one send belongs to. A teammate continues the conversation it is
   * working from — that is what turns a peer exchange into one bounded
   * conversation instead of an unbounded sequence of unrelated messages. The
   * leader always opens a fresh chain: its own turns are the user-visible,
   * interruptible convergence point, so a conversation that reached the leader
   * has already converged and the next instruction starts over.
   */
  private chainFor(actor: Actor, from: Agent): TeamChain {
    const inherited = actor.member === undefined ? undefined : actor.team.inbox.get(from.id)
    if (inherited !== undefined) return { chainId: inherited.chainId, hop: inherited.hop + 1 }
    actor.team.started += 1
    return { chainId: `c${actor.team.started}`, hop: 0 }
  }

  /**
   * Refuse a peer delivery this conversation can no longer afford: too many
   * relays deep, one ordered pair talked out, or a verbatim repeat. Nothing
   * here applies to a message addressed to the leader.
   */
  private assertBudget(
    team: TeamState,
    chain: TeamChain,
    fromId: string,
    recipient: Recipient,
    text: string,
  ): void {
    if (chain.hop > this.config.maxChainHops) {
      throw new TeamError('CHAIN_EXHAUSTED', `relay ${chain.hop} of at most ${this.config.maxChainHops}`)
    }
    const record = team.chains.get(chain.chainId)
    if (record === undefined) return
    const edge = edgeKey(fromId, recipient.id)
    if ((record.edges.get(edge) ?? 0) >= this.config.maxChainRoundTrips) {
      throw new TeamError(
        'PING_PONG',
        `${this.config.maxChainRoundTrips} message(s) already went to ${recipient.name} in this conversation`,
      )
    }
    if (record.said.get(edge) === text) throw new TeamError('REPEATED_MESSAGE', recipient.name)
  }

  /** Charge one accepted peer delivery to its chain, and hand the chain on. */
  private recordDelivery(
    team: TeamState,
    chain: TeamChain,
    fromId: string,
    recipient: Recipient,
    text: string,
  ): void {
    if (recipient.kind !== 'member') return
    team.inbox.set(recipient.id, chain)
    let record = team.chains.get(chain.chainId)
    if (record === undefined) {
      record = { edges: new Map(), said: new Map() }
      team.chains.set(chain.chainId, record)
      // Bounded by insertion order: the oldest conversation's enforcement state
      // falls off first, and a conversation that old is not the one looping.
      for (const stale of team.chains.keys()) {
        if (team.chains.size <= CHAIN_MEMORY) break
        team.chains.delete(stale)
      }
    }
    const edge = edgeKey(fromId, recipient.id)
    record.edges.set(edge, (record.edges.get(edge) ?? 0) + 1)
    record.said.set(edge, text)
  }

  /** Deliver one message, choosing the transport the recipient's runtime requires. */
  private async deliver(
    actor: Actor,
    recipient: Recipient,
    content: ContentBlock[],
    signal: AbortSignal,
    chain: TeamChain,
  ): Promise<string> {
    const source = {
      kind: 'team-message',
      form: 'relay',
      senderSessionId: actor.member?.memberId ?? actor.leader.id,
      senderName: actor.member?.name ?? 'leader',
      chainId: chain.chainId,
      hop: chain.hop,
    } as const
    if (recipient.kind === 'leader') {
      // The leader is an ordinary top-level agent: its inbox is the delivery
      // point, exactly as the continuation manager delivers a child's report.
      const message = createUserMessage({ content, source })
      actor.leader.send(message, 'next-turn', true)
      return message.id
    }
    return await queueHostSubagentPrompt(
      this.ctx.subagents,
      actor.leader,
      SessionId(recipient.id),
      content,
      source,
      signal,
    )
  }

  /**
   * Reject a reasoning effort the selected model does not offer, at spawn
   * rather than on the teammate's every later request. Validation needs an
   * exact provider/model route: without one the adapter stays the authority.
   */
  private async assertEffortOffered(leader: Agent, request: TeamSpawnRequest): Promise<void> {
    if (request.reasoningEffort === undefined) return
    const llm = this.ctx.get('llm')
    const provider = leader.options.provider
    const model = request.model ?? leader.options.model
    if (llm === undefined || provider === undefined || model === undefined) return
    const info = await llm.resolveModelInfo(provider, model)
    const offered = info.reasoning?.efforts ?? []
    if (offered.some(effort => effort.id === request.reasoningEffort)) return
    throw new TeamError(
      'UNKNOWN_EFFORT',
      offered.length === 0
        ? `${model} exposes no reasoning efforts`
        : `${model} offers ${offered.map(effort => effort.id).join(', ')}`,
    )
  }

  /**
   * Stop one teammate's current work. Residency belongs to the continuation
   * manager, so dismissal interrupts rather than disposes: an interrupted
   * teammate settles on its own and its session stays readable.
   */
  private stopMember(leader: Agent, memberId: string): void {
    try {
      this.ctx.subagents.interrupt(SessionId(memberId), { kind: 'ancestor', agent: leader })
    } catch (error: unknown) {
      // Swallows only the subagent seam's authorization/absence rejection for
      // one member: dismissal must remove the roster row either way, and an
      // already-settled teammate has nothing left to interrupt.
      this.ctx.logger.warn('dsh-team: interrupt of teammate %s failed: %s', memberId, String(error))
    }
  }

  /** Service teardown: live teams are rebuilt from their logs on next touch. */
  protected stop(): void {
    this.teams.clear()
    this.pending.clear()
  }
}

/** Strip the live-view fields a roster fact does not carry. */
function memberFact(member: TeamMemberView): TeamMemberFact {
  return {
    memberId: member.memberId,
    name: member.name,
    relation: member.relation,
    ...member.role !== undefined ? { role: member.role } : {},
    ...member.model !== undefined ? { model: member.model } : {},
    ...member.effort !== undefined ? { effort: member.effort } : {},
  }
}

/** One ordered pair, as the chain ledger keys it. */
function edgeKey(fromId: string, toId: string): string {
  return `${fromId} ${toId}`
}

/** Case-insensitive roster lookup by display name. */
function findByName(team: TeamState, name: string): TeamMemberFact | undefined {
  const wanted = name.trim().toLowerCase()
  for (const member of team.members.values()) {
    if (member.name.toLowerCase() === wanted) return member
  }
  return undefined
}

/** Short stable task id, unique within one team's live list. */
function taskIdOf(team: TeamState): string {
  let next = team.tasks.size + 1
  while (team.tasks.has(`t${next}`)) next += 1
  return `t${next}`
}

/** The teammate's first turn: who it is, and what the leader asked for. */
function brief(request: TeamSpawnRequest): string {
  const identity = request.role === undefined
    ? `You are ${request.name}, a teammate in this agent team.`
    : `You are ${request.name} (${request.role}), a teammate in this agent team.`
  return [identity, '', 'The leader assigned you this task:', request.task].join('\n')
}
