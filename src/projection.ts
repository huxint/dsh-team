/**
 * The `team` session-projection unit: the host is the only place the team fold
 * runs, and the framework serves its value to the browser (list baselines,
 * history tail pages, and `session/projection` push frames) with no client-side
 * folding at all.
 *
 * @module dsh-team/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { EMPTY_TEAM_VIEW, type TeamView } from './contract.ts'
import { applyTeamEvent } from './fold.ts'

/**
 * Wire validation for the served value. The unit's state IS the value, so one
 * schema covers the fold state, the read side, and the persisted-cache round
 * trip.
 */
const teamViewSchema = z.object({
  active: z.boolean(),
  members: z.array(z.object({
    memberId: z.string(),
    name: z.string(),
    role: z.string().optional(),
    relation: z.union([z.literal('managed'), z.literal('peer')]),
    model: z.string().optional(),
    effort: z.string().optional(),
    joinedAt: z.number(),
  })),
  tasks: z.array(z.object({
    taskId: z.string(),
    title: z.string(),
    assigneeId: z.string().optional(),
    status: z.union([z.literal('pending'), z.literal('active'), z.literal('done')]),
    note: z.string().optional(),
  })),
  messages: z.array(z.object({
    messageId: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
    kind: z.union([z.literal('message'), z.literal('report'), z.literal('settled')]),
    text: z.string(),
    time: z.number(),
    hop: z.number().optional(),
  })),
  board: z.array(z.object({
    key: z.string(),
    authorId: z.string(),
    authorName: z.string(),
    updatedAt: z.number(),
    preview: z.string(),
  })),
  boardAt: z.number().optional(),
}) as unknown as z.ZodType<TeamView>

/**
 * The `team` unit as the registry's client-visible overload takes it: the fold
 * state is also the served value, so `wire` is present rather than optional and
 * its `view` is the identity.
 */
export type TeamProjectionUnit =
  Omit<ProjectionDefinition<'team', TeamView>, 'wire'>
  & { readonly wire: NonNullable<ProjectionDefinition<'team', TeamView>['wire']> }

/**
 * Build the projection unit for one deployment's mailbox bound.
 * @param maxRecentMessages - feed ceiling from the row config.
 * @returns the registrable unit.
 */
export function teamProjection(maxRecentMessages: number): TeamProjectionUnit {
  return {
    key: 'team',
    stateSchema: teamViewSchema,
    init: () => EMPTY_TEAM_VIEW,
    apply: (state, event) => applyTeamEvent(state, event, maxRecentMessages),
    // The state is already the shape the room renders, so nothing is recomputed
    // on the read side and there is no second shape to keep in step.
    wire: { viewSchema: teamViewSchema, view: state => state },
    // 1: initial shape (members/tasks/messages folded from tool result meta).
    // 2: mailbox rows carry the conversation-chain depth they were delivered at.
    // 4: inbound agent messages use the current continuation source vocabulary.
    stateVersion: 4,
  }
}
