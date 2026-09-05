import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Stagecraft } from '../stagecraft.ts'
import css from '../TeamStage.module.css'
import { StageContext } from './context.ts'
import { canRender } from './kit.ts'
import { Office } from './office.ts'
import { paletteOf, readTokens, type Tokens } from './palette.ts'
import { StageRenderer } from './renderer.ts'
import type { StationSpec } from './workstation.ts'

export function RoomScene(props: {
  readonly label: string
  readonly hint: string
  readonly fallbackLabel: string
  readonly stations: readonly StationSpec[]
  readonly children: ReactNode
}) {
  const { label, hint, fallbackLabel, stations, children } = props
  const [stage] = useState(() => new Stagecraft())
  const host = useRef<HTMLDivElement>(null)
  const office = useRef<Office>()
  const renderer = useRef<StageRenderer>()
  const [status, setStatus] = useState<'loading' | 'webgl' | 'fallback'>('loading')

  useEffect(() => {
    const element = host.current
    if (element === null) return
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let seen = true
    let contextLost = false
    let tokens: Tokens | undefined
    const activity = (): void => {
      const visible = seen && document.visibilityState !== 'hidden'
      const still = motion?.matches ?? false
      element.dataset.roomPaused = String(!visible || still)
      stage.setReducedMotion(still)
      stage.setVisible(visible)
      office.current?.setStill(still)
      renderer.current?.setReducedMotion(still)
      renderer.current?.setVisible(visible && !contextLost)
    }
    activity()

    if (canRender()) {
      try {
        tokens = readTokens(element)
        office.current = new Office(paletteOf(tokens), { still: motion?.matches ?? false })
        renderer.current = new StageRenderer(element, stage, office.current)
        setStatus('webgl')
      } catch (error) {
        console.error('Unable to render the team room', error)
        renderer.current?.dispose()
        office.current?.dispose()
        renderer.current = undefined
        office.current = undefined
        setStatus('fallback')
      }
    } else setStatus('fallback')
    activity()

    const resize = (): void => {
      const { clientWidth: width, clientHeight: height } = element
      stage.resize(width, height)
      renderer.current?.resize(width, height)
    }
    resize()
    const sizes = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)
    sizes?.observe(element)
    window.addEventListener('resize', resize)

    const themes = new MutationObserver(() => {
      if (tokens === undefined || office.current === undefined) return
      const colors = readTokens(element)
      if ((Object.keys(colors) as (keyof Tokens)[]).every(name => colors[name].equals(tokens![name]))) return
      tokens = colors
      office.current.repaint(paletteOf(colors))
      renderer.current?.invalidate()
    })
    for (const target of [document.body, document.documentElement]) {
      themes.observe(target, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] })
    }
    const sight = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      seen = entries[entries.length - 1]?.isIntersecting ?? seen
      activity()
    })
    sight?.observe(element)
    motion?.addEventListener('change', activity)
    document.addEventListener('visibilitychange', activity)

    const stop = stage.onSprites(() => { renderer.current?.invalidateFront() })
    const lost = (event: Event): void => {
      event.preventDefault()
      contextLost = true
      activity()
      setStatus('fallback')
    }
    const restored = (): void => {
      contextLost = false
      activity()
      renderer.current?.invalidate()
      setStatus('webgl')
    }
    const canvas = renderer.current?.canvases.overlay
    canvas?.addEventListener('webglcontextlost', lost)
    canvas?.addEventListener('webglcontextrestored', restored)
    return () => {
      stop()
      sizes?.disconnect()
      sight?.disconnect()
      themes.disconnect()
      window.removeEventListener('resize', resize)
      motion?.removeEventListener('change', activity)
      document.removeEventListener('visibilitychange', activity)
      canvas?.removeEventListener('webglcontextlost', lost)
      canvas?.removeEventListener('webglcontextrestored', restored)
      renderer.current?.dispose()
      office.current?.dispose()
      renderer.current = undefined
      office.current = undefined
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
          if (event.pointerType === 'touch' || status !== 'webgl') return
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
      <div className={css.roomHint}>{status === 'fallback' ? `${fallbackLabel} · ${hint}` : hint}</div>
    </section>
  )
}
