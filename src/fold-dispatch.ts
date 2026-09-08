/**
 * The `tool/code-dispatch` fold channel — the code-mode mirror of the
 * `tool/result` meta channel in `./fold.ts`. Code-mode deployments (the
 * model's only tool path is a run_code-style dispatcher) log nested calls as
 * dispatch records — name + arguments + rendered content — and the harness
 * projects `presentationMeta` only for top-level executions, so the meta
 * channel stays silent there. Team tools carry the same structured fact in
 * a separate text block on nested results. Historical logs have only prose;
 * the fallback reads the fields those old renderers can establish, without
 * treating a partial board read as a complete snapshot.
 *
 * @module dsh-team/fold-dispatch
 */

import type { TeamBoardEntryView, TeamMemberView, TeamView } from './contract.ts'

/** A versioned envelope inside an ordinary, harness-readable text block. */
export const DISPATCH_FACT_PREFIX = 'dsh-team/fact@1 '

const FACT_TOOLS = new Set([
  'team_spawn', 'team_relation', 'team_dismiss', 'team_task', 'team_send', 'team_note', 'team_board',
])

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
  const normalized = ref.trim()
  return view.members.find(member => member.memberId === normalized)
    ?? view.members.find(member => member.name.trim().toLowerCase() === normalized.toLowerCase())
}

/** The member id a settled spawn's render line ends with, or undefined. */
function spawnMemberId(text: string): string | undefined {
  const marker = ' or "'
  const at = text.lastIndexOf(marker)
  if (at < 0 || !text.endsWith('".')) return undefined
  return text.slice(at + marker.length, -2)
}

/** The member id a settled dismiss line names, or undefined. */
function dismissedMemberId(text: string): string | undefined {
  const prefix = 'teammate '
  const suffix = text.endsWith('.') ? ' is dismissed.' : ' is dismissed'
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return undefined
  return text.slice(prefix.length, -suffix.length)
}

/**
 * Rebuild the shared-board snapshot a `team_board` dispatch rendered. The
 * header line of one row is `## key — authorName <authorId> · <ISO stamp>`
 * and its body is the bounded preview the projection schema expects — the
 * format is the fold's own contract with `team_board`'s render.
 * @param text - the rendered board text.
 * @returns the entries, or undefined when the text is not a board render.
 */
function boardEntriesFromText(text: string): TeamBoardEntryView[] | undefined {
  if (text === 'the shared workspace is empty') return []
  if (!text.startsWith('## ')) return undefined
  const entries: TeamBoardEntryView[] = []
  for (const section of text.split('\n\n')) {
    const newline = section.indexOf('\n')
    if (!section.startsWith('## ') || newline < 0) return undefined
    const header = section.slice(3, newline)
    const nameAt = header.indexOf(' — ')
    const idAt = header.lastIndexOf(' <')
    const idEnd = header.lastIndexOf('> · ')
    if (nameAt < 0 || idAt <= nameAt || idEnd <= idAt) return undefined
    const stamp = Date.parse(header.slice(idEnd + 4))
    if (!Number.isSafeInteger(stamp) || stamp < 0) return undefined
    const preview = section.slice(newline + 1).split('\n').find(line => line.trim().length > 0)?.trim() ?? ''
    entries.push({
      key: header.slice(0, nameAt),
      authorName: header.slice(nameAt + 3, idAt),
      authorId: header.slice(idAt + 2, idEnd),
      updatedAt: stamp,
      // The historical workspace format bounded its first non-empty line.
      preview: preview.length > 180 ? `${preview.slice(0, 180)}…` : preview,
    })
  }
  return entries
}

/**
 * Read one `tool/code-dispatch` record's metadata. The caller validates the
 * result with the same `readFact` boundary used for native tool results.
 * Historical facts that need name resolution read the roster from the state.
 * @param view - the state holding the roster and task list.
 * @param data - the raw dispatch record data.
 * @param time - the event's stamp, used for snapshot facts.
 * @returns the fact, or undefined when the record is not a settled team call.
 */
export function readDispatchFact(view: TeamView, data: unknown, time: number): unknown {
  const record = asRecord(data)
  if (record === undefined || record['isError'] !== false) return undefined
  const name = asText(record['name'])
  if (name === undefined || !FACT_TOOLS.has(name)) return undefined
  const args = asRecord(record['arguments'])
  if (args === undefined) return undefined
  const content = record['content']
  const last = Array.isArray(content) ? asRecord(content.at(-1)) : undefined
  const envelope = last?.['type'] === 'text' ? asText(last['text']) : undefined
  if (envelope?.startsWith('dsh-team/fact@')) {
    // A malformed or future envelope must not fall through to prose guesses.
    if (!envelope.startsWith(DISPATCH_FACT_PREFIX)) return undefined
    try {
      return JSON.parse(envelope.slice(DISPATCH_FACT_PREFIX.length)) as unknown
    } catch {
      return undefined
    }
  }
  const text = textOf(record['content'])
  switch (name) {
    case 'team_spawn': {
      const name = asText(args['name'])
      const relation = asRelation(args['relation'])
      const memberId = spawnMemberId(text)
      if (name === undefined || relation === undefined || memberId === undefined) return undefined
      if (text !== `teammate ${name} joined as a ${relation} member and started on its task. Address it as "${name}" or "${memberId}".`) return undefined
      const role = asText(args['role'])
      const model = asText(args['model'])
      const effort = asText(args['reasoning_effort'])
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
      if (text !== `${member.name} is now a ${relation} member`) return undefined
      const { joinedAt: _joinedAt, ...fact } = member
      return { team: 'member-updated', member: { ...fact, relation } }
    }
    case 'team_dismiss': {
      const ref = asText(args['member'])
      if (args['member'] === undefined) return text === 'the team is disbanded' ? { team: 'ended' } : undefined
      if (ref === undefined) return undefined
      const memberId = dismissedMemberId(text)
      return memberId === undefined ? undefined : { team: 'member-removed', memberId }
    }
    case 'team_task': {
      const rendered = /^task (\S+) "([\s\S]*)" is (pending|active|done)(?: for (\S+)| and unassigned)$/.exec(text)
      if (rendered === null) return undefined
      const taskId = rendered[1]!
      if (args['task_id'] !== undefined && args['task_id'] !== taskId) return undefined
      const existing = view.tasks.find(candidate => candidate.taskId === taskId)
      const assigneeId = rendered[4]
      const note = typeof args['note'] === 'string' ? args['note'] : existing?.note
      return {
        team: 'task',
        task: {
          taskId,
          title: rendered[2]!,
          status: asStatus(rendered[3])!,
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
      const recipient = resolveMember(view, to)
      const prefix = 'message queued as the next turn of '
      if (!text.startsWith(prefix) || text.length === prefix.length) return undefined
      if (recipient !== undefined && text !== prefix + recipient.name) return undefined
      return { team: 'message', messageId, to: recipient?.memberId ?? to.trim(), text: message }
    }
    case 'team_board': {
      // Legacy renders of private or filtered reads are never whole snapshots.
      if (args['private'] === true || args['key'] !== undefined) return undefined
      const entries = boardEntriesFromText(text)
      return entries === undefined ? undefined : { team: 'board', entries, at: time }
    }
    default:
      return undefined
  }
}
