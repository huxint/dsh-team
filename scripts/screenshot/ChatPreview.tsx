import { TeamPresence, type TeamPresenceProps } from '../../src/client/TeamPresence.tsx'
import { TeamToolCard, type TeamToolCardProps } from '../../src/client/TeamToolCard.tsx'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { crewState } from './fixture.ts'
import './chat-preview.css'

const settled = (tool: string, args: Record<string, unknown>, meta: unknown, output: string): ToolResultNode => ({
  kind: 'tool-result', seq: 3, time: 1_755_003_900_000, callId: `call-${tool}`,
  call: { name: tool, argsRaw: JSON.stringify(args, null, 2) }, callTime: 1_755_003_899_000,
  content: [{ type: 'text', text: output }], isError: false, meta, subCalls: [],
})

const calls: Array<{ name: string, block: ToolCallBlock }> = [
  {
    name: 'team_spawn',
    block: settled('team_spawn', { name: 'Atlas', task: '梳理鉴权模块与 session 的依赖边界，确认迁移方案。', role: '架构评审', relation: 'peer' },
      { team: 'member-added', member: crewState.members[0] }, 'Atlas 已加入团队，开始梳理架构边界。'),
  },
  {
    name: 'team_task',
    block: settled('team_task', { title: '迁移鉴权接口', assignee: 'Nova' },
      { team: 'task', task: { taskId: 't1', title: '将鉴权接口迁移到新 SDK，保留现有调用方式', status: 'active', assigneeId: 'child-2' } },
      '任务已交给 Nova，当前状态：进行中。'),
  },
  {
    name: 'team_send',
    block: {
      callId: 'call-send', name: 'team_send', turn: 1, step: 3, time: 1_755_003_900_000, subCalls: [],
      argsRaw: JSON.stringify({ to: 'Orion', message: '接口迁移正在进行，请先补齐 storage 和鉴权边界的回归用例。' }, null, 2),
    },
  },
]

export function ChatPreview(props: Omit<TeamPresenceProps, 'sessionId'> & { onRoom: () => void, english: boolean }) {
  const { onRoom, english, ...teamProps } = props
  return (
    <main className="chat-preview">
      <header className="chat-preview-header">
        <div className="chat-preview-title">
          <span>{english ? 'Authentication SDK migration' : '鉴权模块迁移'}</span>
          <TeamPresence {...teamProps} sessionId="leader-1" />
        </div>
        <nav className="chat-preview-tabs">
          <span aria-current="page">{english ? 'Chat' : '对话'}</span>
          <span>{english ? 'Trajectory' : '轨迹'}</span>
          <button type="button" onClick={onRoom}>{english ? 'Agent team' : 'Agent 团队'}</button>
        </nav>
      </header>
      <div className="chat-preview-scroll">
        <div className="chat-preview-transcript">
          <p className="chat-preview-user">{english ? 'Build a team to migrate authentication to the new SDK, including tests and documentation.' : '组一个团队，把鉴权模块迁移到新 SDK，并补齐测试与文档。'}</p>
          <div className="chat-preview-answer">
            <span className="chat-preview-mark" aria-hidden>✳</span>
            <div>
              <p>{english ? 'Atlas will review the architecture, Nova will migrate the interfaces, and Orion and Vega will take care of tests and documentation.' : 'Atlas 梳理架构，Nova 迁移接口，Orion 和 Vega 同步测试与文档。我们先把分工安排好。'}</p>
              {calls.map(call => (
                <TeamToolCard key={call.name} {...teamProps as TeamToolCardProps} sessionId="leader-1" toolName={call.name} callId={call.block.callId} block={call.block} inspect={() => { document.body.dataset.inspected = call.block.callId }} openFile={() => {}} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <footer className="chat-preview-composer">
        <div className="chat-preview-input">
          <textarea aria-label={english ? 'Message' : '消息'} placeholder={english ? 'Message the main session…' : '继续和主会话聊…'} />
          <div><span>＋</span><span>DeepSeek</span><button type="button" aria-label={english ? 'Send' : '发送'}>↑</button></div>
        </div>
      </footer>
    </main>
  )
}
