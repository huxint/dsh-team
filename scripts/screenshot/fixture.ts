import type { TeamPanelState } from '../../src/client/TeamStage.tsx'

/** One teammate as the panel state carries it. */
const member = (
  id: string, name: string, role: string | undefined, relation: 'managed' | 'peer',
  joinedAt: number, extra: Record<string, string> = {},
): TeamPanelState['members'][number] => ({
  memberId: id,
  name,
  ...(role !== undefined ? { role } : {}),
  relation,
  joinedAt,
  ...extra,
})

/** Fixed team and timestamps keep scene captures reproducible. */
export const crewState: TeamPanelState = {
  leaderId: 'leader-1',
  currentId: 'leader-1',
  members: [
    member('child-1', 'Atlas', '架构评审', 'peer', 1_755_000_000_000, { model: 'reasoner', effort: 'high' }),
    member('child-2', 'Nova', '接口迁移', 'managed', 1_755_000_100_000),
    member('child-3', 'Orion', '测试补齐', 'peer', 1_755_000_200_000),
    member('child-4', 'Vega', '文档同步', 'managed', 1_755_000_300_000),
  ],
  tasks: [
    { taskId: 't1', title: '把鉴权模块迁到新 SDK', assigneeId: 'child-1', status: 'active' },
    { taskId: 't2', title: '梳理 session 依赖边界', assigneeId: 'child-2', status: 'active' },
    { taskId: 't3', title: '补齐 storage 回归用例', assigneeId: 'child-3', status: 'active' },
    { taskId: 't4', title: '更新 README 与配置表', assigneeId: 'child-4', status: 'pending' },
    { taskId: 't5', title: '冻结旧 provider 入口', status: 'done', note: 'v0.2.6 起' },
  ],
  messages: [
    { messageId: 'm1', to: 'child-2', kind: 'message', text: '请把 session 注入点迁移到新 SDK 的 binding 层。', time: 1_755_003_600_000 },
    { messageId: 'm2', from: 'child-2', to: 'child-1', kind: 'message', hop: 1, text: '新 SDK 的注入点我找到了，在 dsh-session 的 binding 层。', time: 1_755_003_660_000 },
    { messageId: 'm3', to: 'child-3', kind: 'message', text: '请把 storage 域的回归用例补齐，重点看 fold 的幂等性。', time: 1_755_003_700_000 },
    { messageId: 'm4', from: 'child-3', kind: 'report', text: '回归用例已补齐 12 个，全部通过。', time: 1_755_003_800_000 },
    { messageId: 'm5', from: 'child-1', kind: 'settled', text: '架构评审完成，结论已写入共享工作区。', time: 1_755_003_900_000 },
  ],
  board: [
    { key: 'auth-migration', authorId: 'child-1', authorName: 'Atlas', updatedAt: 1_755_003_500_000, preview: '新 SDK 的鉴权走 binding 注入，旧 provider 入口已冻结。' },
    { key: 'session-edge', authorId: 'child-2', authorName: 'Nova', updatedAt: 1_755_003_640_000, preview: 'session 依赖边界：runtime 与 storage 分层，不再互相引用。' },
    { key: 'regression', authorId: 'child-3', authorName: 'Orion', updatedAt: 1_755_003_810_000, preview: '回归基线已更新，fold 幂等性覆盖 12 例。' },
  ],
  boardAt: 1_755_003_910_000,
}

/** Which members are mid-turn, as the runtime session list carries it. */
export function sessionState() {
  const running = new Set(['leader-1', 'child-1', 'child-2'])
  const byId: Record<string, { id: string, running: boolean }> = {}
  for (const id of [...running]) byId[id] = { id, running: true }
  return {
    ids: Object.keys(byId),
    byId,
    current: crewState.currentId,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
  }
}
