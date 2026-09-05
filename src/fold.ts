/**
 * The durable team fold: one leader session's log to {@link TeamView}.
 *
 * The team invents no session event type. rc.6's `Session.append` cannot mark
 * an event `ignorable`, so an out-of-repo event type would be required-on-read
 * and a log written with this plugin would refuse to load once the plugin is
 * gone. Every durable fact therefore rides vocabulary the harness already
 * knows: the `meta` (presentationMeta) of this plugin's own `tool/result`
 * events, and the `user/message` deliveries whose source is `team-message`.
 * Both are plain JSON on a durable boundary, so this module validates them
 * instead of trusting them.
 *
 * @module dsh-team/fold
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  EMPTY_TEAM_VIEW,
  type TeamBoardEntryView, type TeamMemberView, type TeamMessageView, type TeamRelation,
  type TeamTaskStatus, type TeamTaskView, type TeamView,
} from './contract.ts'

/** Identity and relation facts one settled team tool publishes about a member. */
export interface TeamMemberFact {
  readonly memberId: string
  readonly name: string
  readonly role?: string
  readonly relation: TeamRelation
  readonly model?: string
  readonly effort?: string
}

/**
 * One settled team-tool result, projected through `presentationMeta`. Every
 * arm carries the WHOLE post-change entity, never a delta, so the fold's
 * transition stays trivial and each logged row is self-describing.
 */
export type TeamFact =
  | { readonly team: 'member-added'; readonly member: TeamMemberFact }
  | { readonly team: 'member-updated'; readonly member: TeamMemberFact }
  | { readonly team: 'member-removed'; readonly memberId: string }
  | { readonly team: 'ended' }
  | {
    readonly team: 'message'
    readonly messageId: string
    readonly to: string
    readonly text: string
    /** Depth of the delivery in its conversation chain. */
    readonly hop?: number
  }
  | { readonly team: 'task'; readonly task: TeamTaskView }
  | { readonly team: 'board'; readonly entries: readonly TeamBoardEntryView[]; readonly at: number }

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function asRelation(value: unknown): TeamRelation | undefined {
  return value === 'managed' || value === 'peer' ? value : undefined
}

function asStatus(value: unknown): TeamTaskStatus | undefined {
  return value === 'pending' || value === 'active' || value === 'done' ? value : undefined
}

/** Narrow one logged member fact, or reject it whole. */
function readMember(value: unknown): TeamMemberFact | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const memberId = asText(record['memberId'])
  const name = asText(record['name'])
  const relation = asRelation(record['relation'])
  if (memberId === undefined || name === undefined || relation === undefined) return undefined
  const role = asText(record['role'])
  const model = asText(record['model'])
  const effort = asText(record['effort'])
  return {
    memberId,
    name,
    relation,
    ...role !== undefined ? { role } : {},
    ...model !== undefined ? { model } : {},
    ...effort !== undefined ? { effort } : {},
  }
}

/** Narrow one logged task fact, or reject it whole. */
function readTask(value: unknown): TeamTaskView | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const taskId = asText(record['taskId'])
  const title = asText(record['title'])
  const status = asStatus(record['status'])
  if (taskId === undefined || title === undefined || status === undefined) return undefined
  const assigneeId = asText(record['assigneeId'])
  const note = asText(record['note'])
  return {
    taskId,
    title,
    status,
    ...assigneeId !== undefined ? { assigneeId } : {},
    ...note !== undefined ? { note } : {},
  }
}

/** Narrow one logged board entry, or reject it whole. */
function readBoardEntry(value: unknown): TeamBoardEntryView | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const key = asText(record['key'])
  const authorId = asText(record['authorId'])
  const authorName = asText(record['authorName'])
  const updatedAt = asCount(record['updatedAt'])
  if (key === undefined || authorId === undefined || authorName === undefined || updatedAt === undefined) {
    return undefined
  }
  return { key, authorId, authorName, updatedAt, preview: asText(record['preview']) ?? '' }
}

/** Narrow one logged team fact off a `tool/result` event's `meta`. */
export function readFact(meta: unknown): TeamFact | undefined {
  const record = asRecord(meta)
  if (record === undefined) return undefined
  switch (record['team']) {
    case 'member-added':
    case 'member-updated': {
      const member = readMember(record['member'])
      return member === undefined
        ? undefined
        : { team: record['team'] === 'member-added' ? 'member-added' : 'member-updated', member }
    }
    case 'member-removed': {
      const memberId = asText(record['memberId'])
      return memberId === undefined ? undefined : { team: 'member-removed', memberId }
    }
    case 'ended':
      return { team: 'ended' }
    case 'message': {
      const messageId = asText(record['messageId'])
      const to = asText(record['to'])
      if (messageId === undefined || to === undefined) return undefined
      const hop = asCount(record['hop'])
      return {
        team: 'message',
        messageId,
        to,
        text: asText(record['text']) ?? '',
        ...hop !== undefined ? { hop } : {},
      }
    }
    case 'task': {
      const task = readTask(record['task'])
      return task === undefined ? undefined : { team: 'task', task }
    }
    case 'board': {
      const rows = record['entries']
      const at = asCount(record['at'])
      if (!Array.isArray(rows) || at === undefined) return undefined
      const entries = rows.map(readBoardEntry).filter((entry): entry is TeamBoardEntryView => entry !== undefined)
      return { team: 'board', entries, at }
    }
    default:
      // Merge-extensible by construction: a fact written by a newer team
      // plugin folds to nothing rather than corrupting this view.
      return undefined
  }
}

/** The delivery facts the fold reads off one inbound message source. */
interface IncomingMessage {
  readonly senderSessionId: string
  readonly senderName?: string
  readonly kind: 'message' | 'report' | 'settled'
  /** Chain depth, on this plugin's own deliveries only. */
  readonly hop?: number
}

/**
 * Narrow one delivered message's source into a mailbox row, or reject it.
 *
 * Team deliveries use `team-message`; current continuation messages use
 * `agent-message`; historical report and settlement sources remain readable so
 * existing leader logs keep their mailbox rows. The latter sources can also
 * come from ordinary subagents, so the caller keeps only roster members.
 */
function readIncoming(source: unknown): IncomingMessage | undefined {
  const record = asRecord(source)
  if (record === undefined) return undefined
  const kind = record['kind']
  if (kind !== 'team-message' && kind !== 'agent-message' && kind !== 'subagent-report' && kind !== 'subagent-settled') return undefined
  const senderSessionId = asText(record['senderSessionId'])
  if (senderSessionId === undefined) return undefined
  const senderName = asText(record['senderName'])
  const hop = asCount(record['hop'])
  return {
    senderSessionId,
    ...senderName !== undefined ? { senderName } : {},
    ...hop !== undefined ? { hop } : {},
    kind: kind === 'team-message' || kind === 'agent-message' ? 'message' : kind === 'subagent-report' ? 'report' : 'settled',
  }
}

/** Append one row to the bounded feed. */
function appended(
  messages: readonly TeamMessageView[],
  row: TeamMessageView,
  bound: number,
): TeamMessageView[] {
  const next = [...messages, row]
  return next.length > bound ? next.slice(next.length - bound) : next
}

/** Replace one member in place, or append it when the id is new. */
function upsertMember(
  members: readonly TeamMemberView[],
  member: TeamMemberView,
): TeamMemberView[] {
  const index = members.findIndex(candidate => candidate.memberId === member.memberId)
  if (index < 0) return [...members, member]
  const next = [...members]
  next[index] = member
  return next
}

/** Replace one task in place, or append it when the id is new. */
function upsertTask(tasks: readonly TeamTaskView[], task: TeamTaskView): TeamTaskView[] {
  const index = tasks.findIndex(candidate => candidate.taskId === task.taskId)
  if (index < 0) return [...tasks, task]
  const next = [...tasks]
  next[index] = task
  return next
}

/** Apply one settled team fact to the view. */
function applyFact(view: TeamView, fact: TeamFact, time: number, bound: number): TeamView {
  switch (fact.team) {
    case 'member-added':
      // A settled spawn (re)starts the team: an earlier whole-team end no
      // longer applies to the members that follow it.
      return {
        ...view,
        active: true,
        members: upsertMember(view.members, { ...fact.member, joinedAt: time }),
      }
    case 'member-updated': {
      const previous = view.members.find(candidate => candidate.memberId === fact.member.memberId)
      if (previous === undefined) return view
      return {
        ...view,
        members: upsertMember(view.members, { ...fact.member, joinedAt: previous.joinedAt }),
      }
    }
    case 'member-removed':
      return {
        ...view,
        members: view.members.filter(candidate => candidate.memberId !== fact.memberId),
      }
    case 'ended':
      return { active: false, members: [], tasks: [], messages: view.messages, board: [] }
    case 'message':
      return {
        ...view,
        messages: appended(view.messages, {
          messageId: fact.messageId,
          to: fact.to,
          kind: 'message',
          text: fact.text,
          time,
          ...fact.hop !== undefined ? { hop: fact.hop } : {},
        }, bound),
      }
    case 'task':
      return { ...view, tasks: upsertTask(view.tasks, fact.task) }
    case 'board':
      // The WHOLE shared area, as of the read or write that published it: the
      // durable workspace lives outside every session log, so the fold records
      // a snapshot rather than pretending to track it.
      return { ...view, board: fact.entries, boardAt: fact.at }
  }
}

/**
 * Apply one inbound delivery to the view, keeping only senders the roster
 * knows: a plain subagent's report is not team traffic.
 */
function applyIncoming(
  view: TeamView,
  incoming: IncomingMessage,
  messageId: string,
  text: string,
  time: number,
  bound: number,
): TeamView {
  if (!view.members.some(member => member.memberId === incoming.senderSessionId)) return view
  return {
    ...view,
    messages: appended(view.messages, {
      messageId,
      from: incoming.senderSessionId,
      kind: incoming.kind,
      text,
      time,
      ...incoming.hop !== undefined ? { hop: incoming.hop } : {},
    }, bound),
  }
}

/** One-line account carried by a `notice`-form source, when it has one. */
function noticeText(source: unknown): string | undefined {
  const record = asRecord(source)
  return record === undefined ? undefined : asText(record['summary'])
}

/** First readable text block of a logged message's content. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    const record = asRecord(block)
    if (record?.['type'] === 'text') return asText(record['text']) ?? ''
  }
  return ''
}

/**
 * Fold one committed event into the team view.
 *
 * Returns the SAME reference for every event this unit does not own — the
 * projection registry treats reference equality as "no downstream work".
 * @param view - the state covering all prior events.
 * @param event - the next committed session event.
 * @param bound - mailbox feed length ceiling.
 * @returns the next view, or `view` itself when nothing changed.
 */
export function applyTeamEvent(view: TeamView, event: SessionEvent, bound: number): TeamView {
  if (event.type === 'tool/result') {
    if (event.data.error !== undefined) return view
    const fact = readFact(event.data.meta)
    return fact === undefined ? view : applyFact(view, fact, event.time, bound)
  }
  if (event.type === 'user/message') {
    const incoming = readIncoming(event.data.source)
    if (incoming === undefined) return view
    const text = incoming.kind === 'settled'
      ? noticeText(event.data.source) ?? textOf(event.data.content)
      : textOf(event.data.content)
    return applyIncoming(view, incoming, event.data.id, text, event.time, bound)
  }
  return view
}

/**
 * Fold a whole log — the cold path used by tests and by a service reading a
 * session the projection registry has not driven.
 * @param events - the session's events, in seq order.
 * @param bound - mailbox feed length ceiling.
 * @returns the folded view.
 */
export function foldTeam(events: readonly SessionEvent[], bound: number): TeamView {
  let view = EMPTY_TEAM_VIEW
  for (const event of events) view = applyTeamEvent(view, event, bound)
  return view
}
