/**
 * The room's own arithmetic: which desk a member gets, where a visitor stands
 * to talk to it, and the walk between two places on the floor. Pure geometry —
 * no DOM, no measurement.
 *
 * @module dsh-team/tests/room
 */

import { describe, expect, it } from 'vitest'
import {
  CORRIDOR, FIELD, HAUNTS, ROOM_BLOCKS, aisleFor, breakAt, deskOf, footprintOf,
  lengthOf, obstaclesOf, poseFor, rowsFor, routeBetween, smooth, spread,
  stationFor, visitAt, walkMs, wanderOf, type Point, type Rect,
} from '../src/client/room.ts'

/** Every desk of one roster, in seating order. */
function desks(count: number) {
  return Array.from({ length: count }, (_, index) => deskOf(index, count))
}

/** Whether one leg of a walk passes through a rectangle of the floor. */
function crosses(from: Point, to: Point, rect: Rect): boolean {
  const steps = 80
  for (let step = 0; step <= steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps
    const y = from.y + ((to.y - from.y) * step) / steps
    const inside = x > rect.x + 0.02 && x < rect.x + rect.w - 0.02
      && y > rect.y + 0.02 && y < rect.y + rect.h - 0.02
    if (inside) return true
  }
  return false
}

/** Whether a leg CROSSES a rectangle: standing in your own spot at either end
 *  of it is not crossing it. */
function plows(from: Point, to: Point, rect: Rect): boolean {
  const startsInside = crosses(from, from, rect)
  const endsInside = crosses(to, to, rect)
  return !startsInside && !endsInside && crosses(from, to, rect)
}

describe('where a member sits', () => {
  it('keeps the room wide rather than deep, however many members it seats', () => {
    expect(rowsFor(1)).toBe(1)
    expect(rowsFor(3)).toBe(1)
    expect(rowsFor(4)).toBe(2)
    expect(rowsFor(9)).toBe(3)
  })

  it('keeps every desk inside the desk field', () => {
    for (let count = 1; count <= 9; count += 1) {
      for (const desk of desks(count)) {
        expect(desk.x).toBeGreaterThan(FIELD.x)
        expect(desk.x).toBeLessThan(FIELD.x + FIELD.w)
        expect(desk.y).toBeGreaterThan(FIELD.y)
        expect(desk.y).toBeLessThan(FIELD.y + FIELD.h)
      }
    }
  })

  it('gives every member a desk of its own, and the same one every render', () => {
    const places = desks(9).map(desk => `${desk.x},${desk.y}`)
    expect(new Set(places).size).toBe(9)
    expect(deskOf(4, 9)).toEqual(deskOf(4, 9))
  })

  it('fills a row before it starts the next, and centers a short last row', () => {
    const [first, second, wrapped] = [deskOf(0, 6), deskOf(1, 6), deskOf(3, 6)]
    expect(second!.x).toBeGreaterThan(first!.x)
    expect(second!.row).toBe(0)
    expect(wrapped!.row).toBe(1)
    expect(wrapped!.y).toBeGreaterThan(first!.y)

    const middle = deskOf(4, 5)
    expect(middle.row).toBe(1)
    expect(middle.x).toBeGreaterThan(deskOf(3, 5).x)
  })

  it('draws a desk further back smaller, so the room has depth', () => {
    expect(deskOf(0, 3).scale).toBe(1)
    expect(deskOf(0, 6).scale).toBeLessThan(deskOf(3, 6).scale)
  })

  it('packs the crew tighter as the rows grow crowded', () => {
    expect(deskOf(0, 8).scale).toBeLessThan(deskOf(0, 6).scale)
  })
})

describe('where a visitor stands', () => {
  it('stops beside its host, on the side it came from, clear of the host desk', () => {
    const host = deskOf(1, 3)
    const left = visitAt(host, 0)
    const right = visitAt(host, 100)
    expect(left.x).toBeLessThan(host.x)
    expect(right.x).toBeGreaterThan(host.x)
    for (const spot of [left, right]) {
      expect(crosses(spot, spot, footprintOf(host))).toBe(false)
    }
  })

  it('stands a step in front, so neither of them is hidden behind the other', () => {
    const host = deskOf(0, 3)
    expect(visitAt(host, 100).y).toBeGreaterThan(host.y)
  })

  it('hands the break corner three places to stand, and shares them beyond that', () => {
    const spots = [breakAt(0), breakAt(1), breakAt(2)].map(spot => `${spot.x},${spot.y}`)
    expect(new Set(spots).size).toBe(3)
    expect(breakAt(3)).toEqual(breakAt(0))
  })
})

describe('walking the floor', () => {
  it('never sends a walk through any piece of furniture', () => {
    const floor = desks(9)
    const obstacles = obstaclesOf(floor)
    for (const [seat, desk] of floor.entries()) {
      const route = routeBetween(floor[0]!, visitAt(desk, floor[0]!.x), obstacles)
      if (seat === 0) continue
      expect(route[route.length - 1]).toEqual(visitAt(desk, floor[0]!.x))
      for (let index = 1; index < route.length; index += 1) {
        for (const rect of obstacles) {
          expect(plows(route[index - 1]!, route[index]!, rect), `seat ${seat}, leg ${index}`).toBe(false)
        }
      }
    }
  })

  it('takes the straight line when the floor between two places is clear', () => {
    const obstacles = obstaclesOf(desks(3))
    const from = { x: 15, y: 91 }
    const to = { x: 45, y: 91 }
    expect(routeBetween(from, to, obstacles)).toEqual([from, to])
  })

  it('detours around a piece of furniture standing in the way', () => {
    const wall = { x: 40, y: 40, w: 4, h: 20 }
    const route = routeBetween({ x: 30, y: 50 }, { x: 54, y: 50 }, [wall])
    expect(route.length).toBeGreaterThan(2)
    for (let index = 1; index < route.length; index += 1) {
      expect(crosses(route[index - 1]!, route[index]!, wall)).toBe(false)
    }
  })

  it('keeps a step of clear floor while it passes a piece of furniture', () => {
    // The straight line clears the furniture itself but shaves the buffer a
    // walker keeps around it: the route has to swing wide, not thread the
    // gap between the buffer and the furniture it belongs to.
    const crates = [
      { x: 30, y: 30, w: 10, h: 10 },
      { x: 50, y: 30, w: 10, h: 10 },
    ]
    const route = routeBetween({ x: 20, y: 28.5 }, { x: 70, y: 28.5 }, crates)
    expect(route.length).toBeGreaterThan(2)
    // 2.35 rather than the full 2.4: a corner sits exactly on the buffer's
    // edge, and grazing an edge is walking, not trespassing.
    const kept = 2.35
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1]!
      const b = route[index]!
      for (let step = 0; step <= 40; step += 1) {
        const x = a.x + ((b.x - a.x) * step) / 40
        const y = a.y + ((b.y - a.y) * step) / 40
        for (const crate of crates) {
          const inside = x > crate.x - kept && x < crate.x + crate.w + kept
            && y > crate.y - kept && y < crate.y + crate.h + kept
          expect(inside, `leg ${index} step ${step}`).toBe(false)
        }
      }
    }
  })

  it('finds its way across the whole room, front row to back row', () => {
    const floor = desks(9)
    const obstacles = obstaclesOf(floor)
    const from = deskOf(0, 9)
    const to = visitAt(deskOf(8, 9), from.x)
    const route = routeBetween(from, to, obstacles)
    expect(route.length).toBeGreaterThan(2)
    expect(route[route.length - 1]).toEqual(to)
    for (let index = 1; index < route.length; index += 1) {
      for (const rect of obstacles) {
        expect(plows(route[index - 1]!, route[index]!, rect)).toBe(false)
      }
    }
  })

  it('walks around the standing furniture of the break corner', () => {
    const [from, to] = [breakAt(2), visitAt(breakAt(0), breakAt(2).x)]
    const route = routeBetween(from, to)
    for (let index = 1; index < route.length; index += 1) {
      for (const rect of ROOM_BLOCKS) {
        expect(plows(route[index - 1]!, route[index]!, rect)).toBe(false)
      }
    }
  })

  it('rounds its corners off, without cutting back through the furniture', () => {
    const wall = { x: 40, y: 40, w: 4, h: 20 }
    const raw = routeBetween({ x: 30, y: 50 }, { x: 54, y: 50 }, [wall])
    const route = smooth(raw, [wall])
    expect(route.length).toBeGreaterThan(2)
    // Rounding a corner off shortens the walk, and never swings it back
    // through the furniture it was avoiding.
    expect(lengthOf(route)).toBeLessThan(lengthOf(raw))
    expect(route[0]).toEqual(raw[0])
    expect(route[route.length - 1]).toEqual(raw[raw.length - 1])
    for (let index = 1; index < route.length; index += 1) {
      expect(plows(route[index - 1]!, route[index]!, wall)).toBe(false)
    }
  })

  it('keeps the front walkway in front of every desk', () => {
    for (const desk of desks(9)) expect(aisleFor(desk.y)).toBeLessThanOrEqual(CORRIDOR)
    expect(aisleFor(CORRIDOR + 10)).toBe(CORRIDOR)
  })

  it('says nothing to walk when the member is already there', () => {
    const desk = deskOf(0, 3)
    expect(routeBetween(desk, { x: desk.x, y: desk.y })).toEqual([desk])
  })

  it('takes longer over a longer leg, and never less than a step', () => {
    expect(walkMs(60)).toBeGreaterThan(walkMs(20))
    expect(walkMs(0.4)).toBe(140)
  })
})

describe('what a member is doing', () => {
  it('keeps a member at its own desk while it is working or has just been asked', () => {
    expect(stationFor(true, 'reported', 0)).toBe('desk')
    expect(stationFor(false, 'got', 0)).toBe('desk')
    expect(stationFor(false, undefined, 0)).toBe('desk')
  })

  it('sends a member to the break corner once it has delivered and owns nothing', () => {
    expect(stationFor(false, 'reported', 0)).toBe('break')
    expect(stationFor(false, 'reported', 2)).toBe('desk')
  })

  it('reads the pose off the same live state', () => {
    expect(poseFor(true, undefined, 0)).toBe('working')
    expect(poseFor(false, 'got', 0)).toBe('reading')
    expect(poseFor(false, undefined, 1)).toBe('reading')
    expect(poseFor(false, 'sent', 0)).toBe('idle')
  })
})


describe('the idle errands', () => {
  it('keeps everybody at their own place when the clock has not turned', () => {
    for (let seat = -1; seat < 9; seat += 1) expect(wanderOf(seat, 0)).toBeUndefined()
  })

  it('sends a wanderer to a real haunt, and most turns nobody anywhere', () => {
    for (let tick = 1; tick < 60; tick += 1) {
      for (let seat = 0; seat < 6; seat += 1) {
        const haunt = wanderOf(seat, tick)
        if (haunt !== undefined) {
          expect(HAUNTS.some(spot => Math.abs(spot.x - haunt.x) < 7 && Math.abs(spot.y - haunt.y) < 1)).toBe(true)
        }
      }
    }
  })

  it('parts two members sent to the same place, and leaves a lone one alone', () => {
    const apart = spread([{ x: 50, y: 50 }, { x: 50, y: 50 }])
    expect(Math.hypot(apart[0]!.x - apart[1]!.x, apart[0]!.y - apart[1]!.y)).toBeGreaterThan(3)
    const alone = spread([{ x: 30, y: 40 }])
    expect(alone[0]).toEqual({ x: 30, y: 40 })
  })
})
