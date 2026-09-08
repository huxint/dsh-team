/**
 * The `tool/code-dispatch` fold channel — the code-mode mirror of the
 * `tool/result` meta channel in `./fold.ts`. Code-mode deployments (the
 * model's only tool path is a run_code-style dispatcher) log nested calls as
 * dispatch records — name + arguments + rendered content — and the harness
 * projects `presentationMeta` only for top-level executions, so the meta
 * channel stays silent there while every fact still lands in the log. Both
 * the argument names and the rendered lines are this repo's own stable
 * vocabulary, so the fold reads them; an unfamiliar shape folds to nothing
 * rather than corrupting the view.
 *
 * @module dsh-team/fold-dispatch
 */

import type { TeamBoardEntryView, TeamMemberView, TeamView } from './contract.ts'
import type { TeamFact } from './fold.ts'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asRelation(value: unknown): 'managed' | 'peer' | undefined {
  return value === 'managed' || value === 'peer' ? value : undefined
}

function asStatus(value: unknown): 'pending' | 'active' | 'done' | undefined {
  return value === 'pending' || value === 'active' || value === 'done' ? value : undefined
}

/** First readable text block of a dispatch record's rendered content. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    const record = asRecord(block)
    if (record?.['type'] === 'text') return asText(record['text']) ?? ''
  }
  return ''
}

/**
 * Find one roster member by member id first, then by name. The id wins so a
 * teammate named after another member's id cannot hijack the reference.
 * @param view - the state holding the roster.
 * @param ref - the raw reference a tool argument carried.
 * @returns the matched member, or undefined.
 */
function resolveMember(view: TeamView, ref: string | undefined): TeamMemberView | undefined {
  if (ref === undefined) return undefined
  return view.members.find(member => member.memberId === ref)
    ?? view.members.find(member => member.name === ref)
}

/** The member id a settled spawn's render line ends with, or undefined. */
function spawnMemberId(text: string): string | undefined {
  const marker = ' or "'
  const at = text.lastIndexOf(marker)
  if (at < 0 || !text.endsWith('".')) return undefined
  return text.slice(at + marker.length, -2)
}

/** The task id a settled task render line opens with, or undefined. */
function taskIdFromText(text: string): string | undefined {
  if (!text.startsWith('task ')) return undefined
  const rest = text.slice(5)
  const space = rest.indexOf(' ')
  const quoted = rest.indexOf(' "')
  const end = quoted >= 0 && quoted < space ? quoted : space
  if (end <= 0) return undefined
  return rest.slice(0, end)
}

/** The member id a settled dismiss line names, or undefined. */
function dismissedMemberId(text: string): string | undefined {
  const prefix = 'teammate '
  const suffix = ' is dismissed.'
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return undefined
  return text.slice(prefix.length, -suffix.length)
}

/**
 * Rebuild the shared-board snapshot a `team_board` dispatch rendered. The
 * header line of one row is `## key — authorName <authorId> · <ISO stamp>`
 * and its body is the bounded preview the projection schema expects — the
 * format is the fold's own contract with `team_board`'s render.
 * @param text - the rendered board text.
 * @param at - fallback stamp when a row's own stamp cannot parse.
 * @returns the entries, or undefined when the text is not a board render.
 */
function boardEntriesFromText(text: string, at: number): TeamBoardEntryView[] | undefined {
  if (text === 'the shared workspace is empty') return []
  if (!text.startsWith('## ')) return undefined
  const entries: TeamBoardEntryView[] = []
  for (const section of text.split(String.fromCharCode(10, 10))) {
    const newline = section.indexOf(String.fromCharCode(10))
    if (newline < 0) return undefined
    const header = section.slice(3, newline)
    const nameAt = header.indexOf(' — ')
    const idAt = header.indexOf(' <', nameAt)
    const idEnd = header.indexOf('> · ', idAt)
    if (nameAt < 0 || idAt < 0 || idEnd < 0) return undefined
    const stamp = Date.parse(header.slice(idEnd + 4))
    entries.push({
      key: header.slice(0, nameAt),
      authorName: header.slice(nameAt + 3, idAt),
      authorId: header.slice(idAt + 2, idEnd),
      updatedAt: Number.isNaN(stamp) ? at : stamp,
      preview: section.slice(newline + 1),
    })
  }
  return entries
}

/**
 * Narrow one `tool/code-dispatch` record into a team fact. The dispatch
 * record carries the settled call's name, arguments, and rendered content;
 * facts that need the roster (name-to-id resolution) read it from the state.
 * @param view - the state holding the roster and task list.
 * @param data - the raw dispatch record data.
 * @param time - the event's stamp, used for snapshot facts.
 * @returns the fact, or undefined when the record is not a settled team call.
 */
export function readDispatchFact(view: TeamView, data: unknown, time: number): TeamFact | undefined {
  const record = asRecord(data)
  if (record === undefined || record['isError'] === true) return undefined
  const args = asRecord(record['arguments']) ?? {}
  const text = textOf(record['content'])
  switch (asText(record['name'])) {
    case 'team_spawn': {
      const name = asText(args['name'])
      const relation = asRelation(args['relation'])
      const memberId = spawnMemberId(text)
      if (name === undefined || relation === undefined || memberId === undefined) return undefined
      const role = asText(args['role'])
      const model = asText(args['model'])
      const effort = asText(args['effort'])
      return {
        team: 'member-added',
        member: {
          memberId,
          name,
          relation,
          ...role !== undefined ? { role } : {},
          ...model !== undefined ? { model } : {},
          ...effort !== undefined ? { effort } : {},
        },
      }
    }
    case 'team_relation': {
      const relation = asRelation(args['relation'])
      const member = resolveMember(view, asText(args['member']))
      if (relation === undefined || member === undefined) return undefined
      const { joinedAt: _joinedAt, ...fact } = member
      return { team: 'member-updated', member: { ...fact, relation } }
    }
    case 'team_dismiss': {
      const ref = asText(args['member'])
      if (ref === undefined) return { team: 'ended' }
      const memberId = resolveMember(view, ref)?.memberId ?? dismissedMemberId(text)
      return memberId === undefined ? undefined : { team: 'member-removed', memberId }
    }
    case 'team_task': {
      const taskId = asText(args['task_id']) ?? taskIdFromText(text)
      if (taskId === undefined) return undefined
      const existing = view.tasks.find(candidate => candidate.taskId === taskId)
      const title = asText(args['title']) ?? existing?.title
      if (title === undefined) return undefined
      const assignee = asText(args['assignee'])
      const assigneeId = assignee === undefined
        ? existing?.assigneeId
        : resolveMember(view, assignee)?.memberId ?? assignee
      const note = asText(args['note']) ?? existing?.note
      return {
        team: 'task',
        task: {
          taskId,
          title,
          status: asStatus(args['status']) ?? existing?.status ?? 'pending',
          ...assigneeId !== undefined ? { assigneeId } : {},
          ...note !== undefined ? { note } : {},
        },
      }
    }
    case 'team_send': {
      const to = asText(args['to'])
      const message = asText(args['message'])
      const messageId = asText(record['subCallId'])
      if (to === undefined || message === undefined || messageId === undefined) return undefined
      return { team: 'message', messageId, to: resolveMember(view, to)?.memberId ?? to, text: message }
    }
    case 'team_board': {
      // The projection's board is the shared area; a private-pad read is not it.
      if (args['private'] === true) return undefined
      const entries = boardEntriesFromText(text, time)
      return entries === undefined ? undefined : { team: 'board', entries, at: time }
    }
    default:
      return undefined
  }
}
