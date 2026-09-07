/**
 * The declaration merges this plugin contributes to harness type tables: the
 * `team` projection key, the `team-message` message source, the `ctx.team`
 * service seat, and the live change event the browser bridge listens on.
 *
 * @module dsh-team/types
 */

import type { TeamMessageSource, TeamView } from './contract.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Durable agent-team state folded from this session's own log: the roster,
     * the shared task list, and the bounded mailbox feed. Present on a leader
     * session; every other session folds the empty value.
     */
    team: TeamView
  }

  /**
   * The unit's fold state IS its client value — the team fold already produces
   * exactly what the world renders — so the state table carries the same type
   * and the unit's `wire.view` is the identity.
   */
  interface SessionProjectionStateMap {
    /** Host-side fold state of the `team` unit; identical to its client value. */
    team: TeamView
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * One team mailbox delivery. The recipient's own turn input carries it, so
     * sender attribution survives persistence on the recipient's log — and a
     * reader without this plugin still folds the message as ordinary user
     * content (merge-extensible sum type, unknown kinds fall through).
     */
    'team-message': TeamMessageSource
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The agent-team service: roster, mailbox routing, tasks, lifecycle. */
    team: import('./service.ts').TeamService
  }

  interface Events {
    /**
     * The live team of one leader changed (roster, tasks, or a delivery). The
     * durable value still travels through the `team` projection; this edge only
     * tells same-process observers to look again.
     * @param payload.leaderId - the leader session whose team changed.
     * @param payload.ended - the whole team was disbanded, so everything scoped
     *   to it (the virtual workspaces included) is now unowned.
     * @param payload.removedMember - one teammate left; its private pad is unowned.
     * @mode emit
     */
    'team/changed'(payload: {
      readonly leaderId: import('@deepseek-ai/dsh-session').SessionId
      readonly ended?: boolean
      readonly removedMember?: string
    }): void
  }
}

export type {}
