import { useId, useMemo, useState } from 'react'
import type { PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { readFact } from '../fold.ts'
import { MemberAvatar } from './MemberAvatar.tsx'
import type { TeamInjected, TeamPanelState } from './TeamStage.tsx'
import {
  IconTeam16, IconTeamPeer16, IconTeamSend16, IconTeamTask16, IconTeamWorkspace16,
} from './icons.tsx'
import type { TeamKey } from './locales.ts'
import theme from './TeamStage.module.css'
import css from './TeamChat.module.css'

export const TEAM_TOOLS = [
  'team_spawn', 'team_send', 'team_task', 'team_relation',
  'team_dismiss', 'team_list', 'team_note', 'team_board',
] as const

type TeamTool = typeof TEAM_TOOLS[number]
type Translate = PropsLocale<'team'>['t']

export type TeamToolCardProps = ToolCallViewProps & PropsLocale<'team'> & TeamInjected & {
  readonly useTeam: SnapshotSelectorHook<TeamPanelState>
}

const TITLES: Record<TeamTool, TeamKey> = {
  team_spawn: 'tool.spawn', team_send: 'tool.send', team_task: 'tool.task',
  team_relation: 'tool.relation', team_dismiss: 'tool.dismiss', team_list: 'tool.list',
  team_note: 'tool.note', team_board: 'tool.board',
}

const SUCCEEDED: Record<TeamTool, TeamKey> = {
  team_spawn: 'tool.joined', team_send: 'tool.sent', team_task: 'tool.updated',
  team_relation: 'tool.updated', team_dismiss: 'tool.ended', team_list: 'tool.read',
  team_note: 'tool.saved', team_board: 'tool.read',
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    // Partial call arguments remain inspectable until the tool supplies valid JSON.
    return {}
  }
}

function argument(args: Record<string, unknown>, name: string): string | undefined {
  return typeof args[name] === 'string' && args[name] !== '' ? args[name] as string : undefined
}

interface Participant {
  readonly id: string | undefined
  readonly seat: number | undefined
  readonly name: string
}

function participant(state: TeamPanelState, reference: string | undefined, fallback: string, t: Translate): Participant {
  if (reference !== undefined && (reference === 'leader' || reference === state.leaderId)) {
    return { id: state.leaderId, seat: -1, name: t('member.leader') }
  }
  const seat = state.members.findIndex(member => member.memberId === reference || member.name === reference)
  const member = state.members[seat]
  return { id: member?.memberId, seat: member === undefined ? undefined : seat, name: member?.name ?? fallback }
}

function presentation(tool: TeamTool, block: ToolCallBlock, state: TeamPanelState, sessionId: string, t: Translate) {
  const settled = 'kind' in block
  const raw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const args = parseArgs(raw)
  const status: 'running' | 'stopped' | 'error' | 'ok' = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
  const fact = settled && !block.isError ? readFact(block.meta) : undefined
  const output = settled ? block.content.filter(content => content.type === 'text').map(content => content.text).join('\n') : ''
  let title = t(TITLES[tool])
  let summary = ''
  let caption = ''
  let people: Participant[] = []
  const who = (reference: string | undefined, fallback = reference ?? t('presence.title')) => participant(state, reference, fallback, t)

  switch (tool) {
    case 'team_spawn': {
      const member = fact?.team === 'member-added' ? fact.member : undefined
      const name = member?.name ?? argument(args, 'name') ?? t('tool.teammate')
      people = [who(member?.memberId, name)]
      summary = argument(args, 'task') ?? name
      caption = member === undefined ? argument(args, 'role') ?? '' : member.role ?? ''
      break
    }
    case 'team_send': {
      const reference = fact?.team === 'message' ? fact.to : argument(args, 'to')
      people = [who(sessionId, t('tool.sender')), who(reference, argument(args, 'to') ?? t('tool.teammate'))]
      summary = fact?.team === 'message' ? fact.text : argument(args, 'message') ?? ''
      caption = t('tool.recipient', { name: people[1]!.name })
      break
    }
    case 'team_task': {
      const task = fact?.team === 'task' ? fact.task : undefined
      const assignee = task === undefined ? argument(args, 'assignee') : task.assigneeId
      summary = task?.title ?? argument(args, 'title') ?? argument(args, 'task_id') ?? ''
      if (assignee !== undefined) people = [who(assignee)]
      const taskStatus = task?.status
      caption = taskStatus === undefined ? '' : t(`task.${taskStatus}`)
      break
    }
    case 'team_relation': {
      const member = fact?.team === 'member-updated' ? fact.member : undefined
      people = [who(member?.memberId ?? argument(args, 'member'), member?.name ?? argument(args, 'member') ?? t('tool.teammate'))]
      const relation = member?.relation ?? argument(args, 'relation')
      summary = people[0]!.name
      caption = relation === 'peer' ? t('relation.peer') : relation === 'managed' ? t('relation.managed') : ''
      break
    }
    case 'team_dismiss': {
      const member = argument(args, 'member')
      const id = fact?.team === 'member-removed' ? fact.memberId : member
      if (id !== undefined) people = [who(id, member ?? id)]
      summary = people[0]?.name ?? t('presence.title')
      break
    }
    case 'team_list':
      summary = t('tool.overview')
      break
    case 'team_note':
      if (raw !== '' && args['text'] === undefined && argument(args, 'key') !== undefined) title = t('tool.removeNote')
      summary = argument(args, 'key') ?? ''
      caption = t(args['private'] === true ? 'tool.private' : 'tool.shared')
      break
    case 'team_board':
      summary = argument(args, 'key') ?? (fact?.team === 'board' && args['private'] !== true ? t('tool.notes', { count: fact.entries.length }) : '')
      caption = t(args['private'] === true ? 'tool.private' : 'tool.shared')
      break
  }

  const failure = status === 'error' || status === 'stopped'
  const resultLabel = tool === 'team_note' && args['text'] === undefined && argument(args, 'key') !== undefined
    ? 'tool.removed' : SUCCEEDED[tool]
  return {
    title, summary, caption: failure ? '' : caption, people, status, raw, output,
    stateLabel: t(status === 'ok' ? resultLabel : `tool.${status}`),
    error: failure ? output || (settled && block.error ? `${block.error.name}: ${block.error.code}` : t('tool.error')) : '',
  }
}

function ToolIcon({ tool }: { readonly tool: TeamTool }) {
  if (tool === 'team_send') return <IconTeamSend16 size={16} />
  if (tool === 'team_task') return <IconTeamTask16 size={16} />
  if (tool === 'team_note' || tool === 'team_board') return <IconTeamWorkspace16 size={16} />
  if (tool === 'team_relation') return <IconTeamPeer16 size={16} />
  return <IconTeam16 size={16} />
}

export function TeamToolCard(props: TeamToolCardProps) {
  const { block, toolName, sessionId, openMember, openLeader, inspect, t } = props
  const team = props.useTeam(snapshot => snapshot)
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const tool = toolName as TeamTool
  const card = useMemo(() => presentation(tool, block, team, sessionId, t), [tool, block, team, sessionId, t])
  const participantNode = (person: Participant, index: number) => {
    const { id, name, seat } = person
    const { leaderId } = team
    const portrait = <><MemberAvatar seat={seat} name={name} /><span className={css.toolPersonName}>{name}</span></>
    return id !== undefined && leaderId !== undefined ? (
      <button
        key={`${id}-${index}`}
        type="button"
        className={css.toolPerson}
        aria-label={id === leaderId ? t('member.openLeader') : t('member.open', { name })}
        title={name}
        onClick={() => {
          if (id === leaderId) openLeader(leaderId)
          else openMember(leaderId, id)
        }}
      >{portrait}</button>
    ) : <span key={index} className={css.toolPerson} title={name}>{portrait}</span>
  }

  return (
    <article className={`${theme.theme} ${css.toolCard}`} data-team-tool={tool} data-state={card.status}>
      <div className={css.toolHeader}>
        <span className={css.toolIcon}><ToolIcon tool={tool} /></span>
        <strong>{card.title}</strong>
        <span className={css.toolState} role="status">{card.stateLabel}</span>
        <button type="button" className={css.iconButton} aria-label={t(expanded ? 'tool.collapse' : 'tool.expand')} aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} onClick={() => { setExpanded(value => !value) }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d={expanded ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'} /></svg>
        </button>
      </div>
      <div className={css.toolBody}>
        <div className={css.toolCopy}>
          {card.summary !== '' && <p className={css.toolSummary} title={card.summary}>{card.summary}</p>}
          {card.caption !== '' && <span className={css.toolCaption}>{card.caption}</span>}
          {card.error !== '' && <p className={css.toolError}>{card.error}</p>}
        </div>
        {card.people.length > 0 && (
          <div className={css.toolPeople} data-team-participants>
            {card.people.map((person, index) => (
              <span key={index} className={css.toolParticipant}>
                {index > 0 && <span className={css.personArrow} aria-hidden>→</span>}
                {participantNode(person, index)}
              </span>
            ))}
          </div>
        )}
      </div>
      {expanded && (
        <div id={detailsId} className={css.toolDetails}>
          {card.raw !== '' && <div><span>{t('tool.input')}</span><pre>{card.raw}</pre></div>}
          {card.output !== '' && <div><span>{t('tool.output')}</span><pre>{card.output}</pre></div>}
          {inspect !== undefined && <button type="button" className={css.inspectButton} onClick={inspect}>{t('tool.inspect')}<span aria-hidden>↗</span></button>}
        </div>
      )}
    </article>
  )
}
