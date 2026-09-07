import { createElement, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { TeamStage } from '../../src/client/TeamStage.tsx'
import { zh, en } from '../../src/client/locales.ts'
import { crewState, sessionState } from './fixture'
import { themeTokens, darkTokens } from './theme'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ChatPreview } from './ChatPreview.tsx'

const params = new URLSearchParams(location.search)
const sheet = document.createElement('style')
const declarations = (tokens: Record<string, string>): string => Object.entries(tokens).map(([name, value]) => `${name}:${value};`).join('')
sheet.textContent = `body{${declarations(themeTokens)}}body[data-ds-dark-theme]{${declarations(darkTokens)}}`
document.head.append(sheet)
document.body.toggleAttribute('data-ds-dark-theme', params.get('theme') === 'dark')
document.documentElement.style.fontFamily = 'var(--dsw-font-family)'
document.documentElement.lang = params.get('locale') === 'en' ? 'en' : 'zh-CN'
const dictionary = params.get('locale') === 'en' ? en : zh

const translate = (key: string, params?: Record<string, string | number>): string => {
  const text = (dictionary as Record<string, string>)[key] ?? key
  return params === undefined ? text
    : Object.entries(params).reduce((line, [name, value]) =>
        line.replaceAll(`{${name}}`, String(value)), text)
}

const sessions = createSnapshotStore(sessionState())
const team = createSnapshotStore(crewState)
window.teamPreview = { team, sessions }

function Preview() {
  const [view, setView] = useState(params.get('view') ?? 'world')
  const shared = {
    useTeam: (select: (snap: typeof crewState) => unknown) => select(useSyncExternalStore(team.subscribe, team.getSnapshot)),
    useSessions: (select: (snap: ReturnType<typeof sessionState>) => unknown) => select(useSyncExternalStore(sessions.subscribe, sessions.getSnapshot)),
    openMember: (leaderId: string, memberId: string) => { document.body.dataset.openedMember = `${leaderId}/${memberId}` },
    openLeader: (leaderId: string) => { document.body.dataset.openedMember = leaderId },
    t: translate,
  }
  return view === 'chat'
    ? createElement(ChatPreview, { ...shared, english: params.get('locale') === 'en', onWorld: () => { setView('world') } })
    : createElement(TeamStage, shared)
}

createRoot(document.getElementById('stage')!).render(createElement(Preview))
