import { memo } from 'react'
import { appearance } from './world/appearance.ts'
import css from './TeamStage.module.css'

export const MemberAvatar = memo(function MemberAvatar(props: {
  readonly seat: number | undefined
  readonly name: string
}) {
  const { seat, name } = props
  if (seat === undefined) return <span className={css.discGlyph} aria-hidden>{[...name][0]?.toUpperCase() ?? '?'}</span>
  const paint = appearance(seat)
  return (
    <span className={css.cameo} data-portrait={seat} aria-hidden>
      <svg className={css.cameoPortrait} viewBox="0 0 40 44" shapeRendering="crispEdges">
        <path d="M7 44V32h6v-3h14v3h6v12Z" fill={paint.shirt} />
        <path d="M18 33h4v11h-4Z" fill={paint.trim} />
        <path d="M16 27h8v7h-8Z" fill={paint.skin} />
        <path d="M9 11h22v18H9Z" fill={paint.skin} />
        <path d="M7 15h3v8H7Zm23 0h3v8h-3Z" fill={paint.skin} />
        <path d="M8 8h24v8h-4v-3h-9v4H9Z" fill={paint.hair} />
        <path d="M13 19h3v4h-3Zm11 0h3v4h-3Z" fill="#35434a" />
        <path d="M13 19h1v1h-1Zm11 0h1v1h-1Z" fill="#fff7e8" />
        <path d="M18 26h5v1h-5Z" fill="#a36f5a" />
        <path d="M11 24h4v2h-4Zm14 0h4v2h-4Z" fill="#d9947f" opacity="0.6" />
        {paint.glasses && <path d="M11 18h7v7h-7v-7Zm11 0h7v7h-7v-7Zm-4 3h4" fill="none" stroke="#35434a" strokeWidth="1.5" />}
        {paint.hat && <path d="M10 5h20v6h5v4H5v-4h5V5Z" fill={paint.trim} />}
      </svg>
    </span>
  )
})
