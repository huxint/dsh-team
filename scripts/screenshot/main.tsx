import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TeamStage } from '../../src/client/TeamStage.tsx'
import { zh, en } from '../../src/client/locales.ts'
import { crewState, sessionState } from './fixture'
import { themeTokens, darkTokens } from './theme'

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

const sessions = sessionState()

createRoot(document.getElementById('stage')!).render(
  createElement(TeamStage, {
    useTeam: (select: (snap: typeof crewState) => unknown) => select(crewState),
    useSessions: (select: (snap: ReturnType<typeof sessionState>) => unknown) => select(sessions),
    openMember: () => {},
    openLeader: () => {},
    t: translate,
  }),
)
