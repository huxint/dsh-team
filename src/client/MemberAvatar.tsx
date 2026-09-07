import { memo } from 'react'
import { Crew, accentOf, gearOf, hairOf, maskOf, skinOf, toneOf } from './crew.tsx'
import css from './TeamStage.module.css'

export const MemberAvatar = memo(function MemberAvatar(props: {
  readonly seat: number | undefined
  readonly name: string
}) {
  const { seat, name } = props
  if (seat === undefined) return <span className={css.discGlyph} aria-hidden>{[...name][0]?.toUpperCase() ?? '?'}</span>
  return (
    <span className={css.cameo} data-cameo-species={maskOf(seat)} style={accentOf(seat)} aria-hidden>
      <Crew
        kind={maskOf(seat)}
        className={css.cameoCrew}
        portrait
        hair={hairOf(seat)}
        gear={gearOf(seat)}
        tone={toneOf(seat)}
        skin={skinOf(seat)}
      />
    </span>
  )
})
