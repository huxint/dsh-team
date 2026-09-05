/**
 * Walking, as one continuous motion.
 *
 * `routeBetween` gives the corners of a trip and `smooth` rounds them off; this
 * hook walks that line. It parametrises the whole path by arc length and eases
 * once across the trip — a member leans into its first step and slows into its
 * last, rather than stopping dead at every corner — and it drives a gait phase
 * off distance covered, so the legs swing at the speed the member is actually
 * moving instead of at a fixed rate.
 *
 * The frame loop writes `left`, `top`, the depth and the gait STRAIGHT onto the
 * node. React is told only when the member turns or stops, which is a handful
 * of renders in a whole trip; the position itself never round-trips through
 * state, so a roomful of members walking at once costs one style write each per
 * frame instead of a render tree each.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  lengthOf, routeBetween, smooth, walkMs, wanderOf,
  type Point, type Post, type Rect,
} from './room.ts'
import { FIGURE, project as legacyProject } from './stagecraft.ts'
import { useRoomActivity, useStagecraft } from './scene/context.ts'
import { canRender } from './scene/kit.ts'

/**
 * Which way a member is turned. `front` faces the room, `away` is somebody
 * walking off into it, and `back` is the different thing of sitting at your own
 * computer — the stylesheet poses those two apart.
 */
export type Facing = 'left' | 'right' | 'front' | 'away' | 'back'

/** What the room needs back: where to hang the member, and how it is posed. */
export interface Gait {
  /** Attach to the element that stands on the floor. */
  readonly ref: (node: HTMLElement | null) => void
  readonly facing: Facing
  readonly walking: boolean
}

/** Two places closer than this are the same place. */
const NEAR = 0.5

/** How much floor one full swing of the legs covers. */
const STRIDE = 13

/** Whether the reader asked for no motion. */
function still(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The clock the frame loop runs on, where there is one. */
function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/** Which way a step is headed: across the room, or into and out of it. */
function facingOf(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy > 0 ? 'front' : 'away'
}

/** Ease across the whole trip: lean into the first step, slow into the last. */
function ease(at: number): number {
  return at * at * (3 - 2 * at)
}

/**
 * Walk a member from where it is to where it should be.
 *
 * A target that changes mid-trip is re-planned from the exact place the member
 * has reached, not from the end of some leg it was committed to: it turns
 * around where it stands.
 * @param home - where the member starts, before it has walked anywhere.
 * @param target - where it should be standing now.
 * @param obstacles - the furniture on the floor, to walk around.
 * @param base - the member's own size at this station, before perspective.
 * @returns the ref to hang it on, and the pose it is in.
 */
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
  /** Where the member is right now, to the frame. */
  const at = useRef<Point>({ x: home.x, y: home.y })
  /** How far into a stride the legs are, kept across trips so they never jump. */
  const gait = useRef(0)
  const facing = useRef<Facing>('front')
  const scale = useRef(base)
  const [pose, setPose] = useState<{ readonly facing: Facing, readonly walking: boolean }>(
    { facing: 'front', walking: false },
  )

  /** Put the member on the floor: the one place position is ever written. */
  const place = useCallback((point: Point): void => {
    const element = node.current
    if (element === null) return
    const screen = canRender()
      ? stage.project(point)
      : legacyProject(point)
    element.style.left = `${screen.left}%`
    element.style.top = `${screen.top}%`
    const unit = 'unit' in screen ? screen.unit * FIGURE : 140 * screen.scale
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

  // A member that is standing still still has to be re-hung when the room
  // rescales it — a new teammate arrives and every desk shrinks. The scale
  // rides a ref, but is written here rather than during render: a render
  // that is thrown away must not leave a stale scale behind.
  useEffect(() => {
    scale.current = base
    place(at.current)
  }, [place, base])

  /** Stop wherever the member stands, without keeping a walk pose alive. */
  const settle = useCallback((): void => {
    facing.current = 'front'
    setPose(current => current.walking ? { facing: 'front', walking: false } : current)
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    const start = at.current
    // Already there — or a trip cancelled within a step of its target. Either
    // way the member lands: a walk pose nobody is paying for would keep the
    // gait animation and the standing silhouette running in place forever.
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
    /** Distance along the path at which each corner is reached. */
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
    // Covered distance only ever grows, so the leg cursor rides along with it
    // instead of rescanning from the first corner on every frame.
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

/** How long the room waits between one member's idle errands. */
const WANDER_MS = 45_000

/**
 * Where a member with nothing to do has drifted off to right now. The clock
 * turns on its own and `wanderOf` decides — most turns it decides the member
 * stays exactly where it is, which is what makes the one that gets up worth
 * looking at. The first turn always keeps it put: nobody arrives at the room
 * already out of its chair.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @param loose - whether the member is free to wander at all.
 * @returns the place it has wandered to, if anywhere.
 */
export function useIdleErrand(seat: number, loose: boolean): Post | undefined {
  const { visible, reducedMotion } = useRoomActivity()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!loose || !visible || reducedMotion || still()) return undefined
    // Members do not all get up on the same beat: each seat's clock is offset.
    const timer = setInterval(() => { setTick(count => count + 1) }, WANDER_MS + ((seat + 1) % 5) * 1_700)
    return () => { clearInterval(timer) }
  }, [seat, loose, visible, reducedMotion])
  return loose ? wanderOf(seat, tick) : undefined
}
