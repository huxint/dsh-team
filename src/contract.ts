/**
 * The team vocabulary shared by the host half and the browser half: the
 * durable projection value, the mailbox message source, and the relationship
 * model. Types only — the browser bundle imports this module type-only, so it
 * must never grow a runtime import of a host package.
 *
 * @module dsh-team/contract
 */

/** The two relationship levels between the leader and a teammate. */
export type TeamRelation = 'managed' | 'peer'

/** Lifecycle of one shared task. */
export type TeamTaskStatus = 'pending' | 'active' | 'done'

/** What kind of traffic one mailbox row records. */
export type TeamMessageKind =
  /** Content one member addressed to another through `team_send`. */
  | 'message'
  /** A teammate's own result, delivered through the continuation settlement message. */
  | 'report'
  /** The runtime's account of a teammate's activation ending. */
  | 'settled'

/** One teammate as the leader's log records it. */
export interface TeamMemberView {
  /** The teammate's session id; the address every team tool takes. */
  readonly memberId: string
  readonly name: string
  readonly role?: string
  readonly relation: TeamRelation
  /** Model route recorded at spawn, when the leader overrode its own. */
  readonly model?: string
  /** Provider-owned reasoning effort recorded at spawn, when one was requested. */
  readonly effort?: string
  /** Epoch ms of the spawn that added this member. */
  readonly joinedAt: number
}

/** One shared task. */
export interface TeamTaskView {
  readonly taskId: string
  readonly title: string
  /** Assigned teammate; absent means unassigned (leader-held). */
  readonly assigneeId?: string
  readonly status: TeamTaskStatus
  /** Closing note recorded by whoever moved the task to `done`. */
  readonly note?: string
}

/**
 * One mailbox row. `from`/`to` absent means the leader — the projection is
 * served per session, so the owning session needs no id of its own.
 */
export interface TeamMessageView {
  readonly messageId: string
  readonly from?: string
  readonly to?: string
  readonly kind: TeamMessageKind
  readonly text: string
  readonly time: number
  /**
   * Depth of this delivery in its conversation chain: 0 is a message the
   * leader started, and every teammate-to-teammate relay adds one. A row
   * without it was written before the plugin recorded chains.
   */
  readonly hop?: number
}

/**
 * One entry of the team's shared workspace, as the leader's log last recorded
 * it. Only the shared area is ever projected: a member's private pad stays
 * private, including from this panel.
 */
export interface TeamBoardEntryView {
  readonly key: string
  /** Session id of the member that wrote it last. */
  readonly authorId: string
  readonly authorName: string
  readonly updatedAt: number
  /** First non-empty line, bounded — the projection never carries note bodies. */
  readonly preview: string
}

/** The durable team state folded from one leader session's log. */
export interface TeamView {
  /** True once a spawn settled and the team was not ended afterwards. */
  readonly active: boolean
  readonly members: readonly TeamMemberView[]
  readonly tasks: readonly TeamTaskView[]
  /** Bounded newest-last mailbox feed of leader-visible traffic. */
  readonly messages: readonly TeamMessageView[]
  /**
   * The shared workspace as of the last time the leader read or wrote it.
   * Teammates write straight to the durable workspace, which no session log
   * records, so this index is a snapshot rather than a live view.
   */
  readonly board: readonly TeamBoardEntryView[]
  /** When that snapshot was taken; absent while the leader has never looked. */
  readonly boardAt?: number
}

/** The empty value every session without a team folds to. */
export const EMPTY_TEAM_VIEW: TeamView = { active: false, members: [], tasks: [], messages: [], board: [] }

/**
 * One delivery's place in a conversation chain. A chain begins whenever the
 * leader addresses a teammate and grows by one hop with every relay a teammate
 * makes off the message it is working from; escalation to the leader always
 * ends it. The pair is what bounds a peer conversation mechanically instead of
 * by prompt — see `src/service.ts`.
 */
export interface TeamChain {
  /** Identity of the conversation this delivery belongs to (per leader, per process). */
  readonly chainId: string
  /** Relays between the chain's first delivery and this one. */
  readonly hop: number
}

/**
 * Durable attribution for one team mailbox delivery, carried by the recipient's
 * own `user/message` event so the sender survives persistence on both sides.
 */
export interface TeamMessageSource extends TeamChain {
  readonly kind: 'team-message'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the sending member, or of the leader. */
  readonly senderSessionId: string
  /** Display name of the sender at delivery time. */
  readonly senderName: string
}

/** The projection key this plugin owns. */
export const TEAM_PROJECTION_KEY = 'team'
