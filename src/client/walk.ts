import { useCallback, useEffect, useRef, useState } from 'react'
import {
  lengthOf, routeBetween, smooth, walkMs, wanderOf,
  type Point, type Post, type Rect,
} from './room.ts'
import { FIGURE } from './stagecraft.ts'
import { useRoomActivity, useStagecraft } from './scene/context.ts'

/** Back is seated; away is a walking figure moving into the room. */
export type Facing = 'left' | 'right' | 'front' | 'away' | 'back'

export interface Gait {
  readonly ref: (node: HTMLElement | null) => void
  readonly facing: Facing
  readonly walking: boolean
}

const NEAR = 0.5

const STRIDE = 13

function still(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function facingOf(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy > 0 ? 'front' : 'away'
}

function ease(at: number): number {
  return at * at * (3 - 2 * at)
}

export function useWalk(
  home: Point,
  target: Point,
  obstacles: readonly Rect[],
  base: number,
  id: string,
): Gait {
  const stage = useStagecraft()
  const { visible, reducedMotion } = useRoomActivity()
  const node = useRef<HTMLElement | null>(null)
  const at = useRef<Point>({ x: home.x, y: home.y })
  const gait = useRef(0)
  const facing = useRef<Facing>('front')
  const scale = useRef(base)
  const [pose, setPose] = useState<{ readonly facing: Facing, readonly walking: boolean }>(
    { facing: 'front', walking: false },
  )

  // Frame positions bypass React; only facing and walking state trigger a render.
  const place = useCallback((point: Point): void => {
    const element = node.current
    if (element === null) return
    const screen = stage.project(point)
    element.style.left = `${screen.left}%`
    element.style.top = `${screen.top}%`
    const unit = screen.unit * FIGURE
    element.style.setProperty('--team-unit', `${unit * scale.current}px`)
    element.style.setProperty('--team-depth', `${Math.round(point.y)}`)
    element.style.setProperty('--team-gait', `${gait.current}`)
    stage.markSprite(id, point, scale.current)
  }, [stage, id])

  useEffect(() => {
    const unsubscribe = stage.subscribe(() => { place(at.current) })
    return () => {
      unsubscribe()
      stage.dropSprite(id)
    }
  }, [stage, id, place])

  const hang = useCallback((element: HTMLElement | null): void => {
    node.current = element
    place(at.current)
  }, [place])

  // Effects keep aborted React renders from changing the live walk’s scale.
  useEffect(() => {
    scale.current = base
    place(at.current)
  }, [place, base])

  const settle = useCallback((): void => {
    facing.current = 'front'
    setPose(current => current.walking ? { facing: 'front', walking: false } : current)
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    // Re-plan from the current position when a delivery changes mid-walk.
    const start = at.current
    if (Math.abs(start.x - target.x) < NEAR && Math.abs(start.y - target.y) < NEAR) {
      settle()
      return undefined
    }
    if (reducedMotion || still()) {
      at.current = { x: target.x, y: target.y }
      place(at.current)
      settle()
      return undefined
    }

    const path = smooth(routeBetween(start, target, obstacles), obstacles)
    const total = lengthOf(path)
    if (total < NEAR) {
      at.current = { x: target.x, y: target.y }
      place(at.current)
      settle()
      return undefined
    }
    const marks: number[] = [0]
    for (let index = 1; index < path.length; index += 1) {
      marks.push(marks[index - 1]! + Math.hypot(
        path[index]!.x - path[index - 1]!.x,
        path[index]!.y - path[index - 1]!.y,
      ))
    }
    const span = walkMs(total)
    const began = now()
    const from = gait.current
    let frame = 0
    let leg = 1

    const tick = (): void => {
      const through = Math.min(1, (now() - began) / span)
      const covered = ease(through) * total
      while (leg < marks.length - 1 && marks[leg]! < covered) leg += 1
      const back = path[leg - 1]!
      const ahead = path[leg]!
      const run = marks[leg]! - marks[leg - 1]!
      const into = run < 1e-6 ? 1 : (covered - marks[leg - 1]!) / run
      at.current = {
        x: back.x + (ahead.x - back.x) * into,
        y: back.y + (ahead.y - back.y) * into,
      }
      gait.current = (from + covered / STRIDE) % 1
      place(at.current)

      const turned = facingOf(ahead.x - back.x, ahead.y - back.y)
      if (turned !== facing.current) {
        facing.current = turned
        setPose({ facing: turned, walking: true })
      }
      if (through < 1) {
        frame = requestAnimationFrame(tick)
        return
      }
      at.current = { x: target.x, y: target.y }
      place(at.current)
      facing.current = 'front'
      setPose({ facing: 'front', walking: false })
    }

    facing.current = facingOf(path[1]!.x - path[0]!.x, path[1]!.y - path[0]!.y)
    setPose({ facing: facing.current, walking: true })
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame) }
  }, [target.x, target.y, obstacles, place, settle, visible, reducedMotion])

  return { ref: hang, facing: pose.facing, walking: pose.walking }
}

const WANDER_MS = 45_000

export function useIdleErrand(seat: number, loose: boolean): Post | undefined {
  const { visible, reducedMotion } = useRoomActivity()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!loose || !visible || reducedMotion || still()) return undefined
    const timer = setInterval(() => { setTick(count => count + 1) }, WANDER_MS + ((seat + 1) % 5) * 1_700)
    return () => { clearInterval(timer) }
  }, [seat, loose, visible, reducedMotion])
  return loose ? wanderOf(seat, tick) : undefined
}
