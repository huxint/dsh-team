import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Stagecraft } from '../stagecraft.ts'
import css from '../TeamStage.module.css'
import { StageContext } from './context.ts'
import { canRender } from './kit.ts'
import { Office } from './office.ts'
import { paletteOf, readTokens } from './palette.ts'
import { StageRenderer } from './renderer.ts'
import type { StationSpec } from './workstation.ts'

export function RoomScene(props: {
  readonly label: string
  readonly stations: readonly StationSpec[]
  readonly children: ReactNode
}) {
  const { label, stations, children } = props
  const [stage] = useState(() => new Stagecraft())
  const host = useRef<HTMLDivElement>(null)
  const office = useRef<Office>()
  const renderer = useRef<StageRenderer>()
  const [status, setStatus] = useState<'loading' | 'webgl' | 'fallback'>('loading')

  useEffect(() => {
    const element = host.current
    if (element === null || !canRender()) {
      setStatus('fallback')
      return
    }
    const room = new Office(paletteOf(readTokens(element)))
    office.current = room
    let drawing: StageRenderer
    try {
      drawing = new StageRenderer(element, stage, room)
    } catch (error) {
      console.error('Unable to render the team room', error)
      room.dispose()
      office.current = undefined
      setStatus('fallback')
      return
    }
    renderer.current = drawing
    setStatus('webgl')
    const stop = stage.onSprites(() => { drawing.invalidateFront() })
    const lost = (event: Event): void => {
      event.preventDefault()
      drawing.setVisible(false)
      setStatus('fallback')
    }
    const restored = (): void => {
      drawing.setVisible(true)
      drawing.invalidate()
      setStatus('webgl')
    }
    const canvas = drawing.canvases.overlay
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    return () => {
      stop()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
      drawing.dispose()
      room.dispose()
      office.current = undefined
      renderer.current = undefined
    }
  }, [stage])

  useEffect(() => {
    office.current?.setStations(stations)
    renderer.current?.invalidate()
  }, [stations])

  return (
    <section className={css.roomPane} aria-label={label}>
      <div
        ref={host}
        className={css.floor}
        data-renderer={status}
        onPointerMove={event => {
          if (event.pointerType === 'touch') return
          const rect = event.currentTarget.getBoundingClientRect()
          stage.setLean((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1)
          renderer.current?.wake()
        }}
        onPointerLeave={() => {
          stage.setLean(0, 0)
          renderer.current?.wake()
        }}
      >
        <StageContext.Provider value={stage}>{children}</StageContext.Provider>
      </div>
    </section>
  )
}
