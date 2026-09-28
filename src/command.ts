/**
 * The human-facing `/agent-teams` slash command — the one-command door into
 * the team capability. The model-facing tools stay internal: a user who wants
 * the work done by a team types `/agent-teams <goal>` instead of persuading
 * the leader in prose, and everything after the command name becomes the
 * brief the leader is steered with.
 *
 * The command plane owns no team state of its own. It submits one ordinary
 * user message through `agent.steer` (an idle leader opens a turn, a running
 * one picks the steering up at its next step boundary) and lets the existing
 * tools do the work; the ack text renders in the composer only and never
 * enters model history.
 *
 * @module dsh-team/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * The standing instruction that makes `/team <goal>` mean "use the team":
 * without it the leader would often just do the work solo, which is exactly
 * what the user typed the command to avoid having to argue against.
 */
const BRIEF =
  'Pursue this request through your agent team rather than alone: decide what teammates the work needs, '
  + 'spawn them with team_spawn (each with a self-contained first task), coordinate them over team_send '
  + 'and the shared task list, and keep this session posted as results land.'

/** What the composer shows when the steering was accepted. */
const ACK = 'The leader takes it from here: it will assemble and drive the team for this.'

/**
 * The `/agent-teams` definition: one command, whole-goal input, attachment-capable.
 * @returns the command definition for the registry.
 */
export function teamCommand(): CommandDefinition {
  return {
    name: 'agent-teams',
    description:
      'Hand a goal to an agent team: the main session spawns named teammates and coordinates them. '
      + 'Everything after the command becomes the team\'s brief.',
    input: { hint: '<what the team should do>', attachments: true },
    handler({ agent, rawInput, attachments }) {
      // A teammate transcript has no team to hand off to — spawning from a
      // member is refused by the service (`NESTED_TEAM`) before it starts.
      if (agent.session.header.origin === 'subagent') {
        return { kind: 'error', text: '/agent-teams works in your main session — a teammate cannot lead a team.' }
      }
      const goal = rawInput.trim()
      if (goal.length === 0 && attachments.length === 0) {
        return { kind: 'error', text: 'Tell /agent-teams what the team should do, e.g. "/agent-teams migrate auth to the new SDK".' }
      }
      agent.steer(createUserMessage({
        content: [
          ...attachments,
          {
            type: 'text',
            text: goal.length === 0 ? BRIEF : `${BRIEF}\n\nRequest:\n${goal}`,
          },
        ] satisfies ContentBlock[],
        source: { kind: 'user' },
      }))
      return { kind: 'success', text: ACK }
    },
  }
}

/**
 * Register {@link teamCommand} into the row's context.
 * @param ctx - the row context; must carry `ctx.commands`.
 * @returns the exact disposer unregistering the command.
 */
export function installCommand(ctx: Context): () => void {
  return ctx.commands.register(teamCommand())
}
