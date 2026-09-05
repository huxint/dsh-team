import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Stagecraft, toPlan, toWorld } from '../src/client/stagecraft.ts'

const corners = [
  [-5.24, -0.28, 3.58], [5.24, -0.28, 3.58],
  [-5.24, -0.28, -3.74], [5.24, -0.28, -3.74],
  [-5.2, 3.4, -3.7], [5.2, 3.4, -3.7],
  [-5.2, 3.4, -2.25], [5.2, 3.4, -2.25],
] as const

describe('room camera', () => {
  it('maps the floor plan into world units and back', () => {
    expect(toWorld({ x: 0, y: 100 }, 1).toArray()).toEqual([-5, 1, 3.5])
    expect(toWorld({ x: 50, y: 50 }).toArray()).toEqual([0, 0, 0])
    expect(toPlan(new Vector3(2.5, 9, -1.75))).toEqual({ x: 75, y: 25 })
  })

  it.each([[1500, 700], [720, 720], [320, 760], [1600, 340]])(
    'keeps the floor and wall edges in a %i × %i tab at maximum parallax', (width, height) => {
      const stage = new Stagecraft()
      stage.resize(width, height)
      for (const x of [-1, 0, 1]) {
        for (const y of [-1, 1]) {
          stage.setLean(x, y)
          stage.step(5)
          for (const corner of corners) {
            const screen = new Vector3(...corner).project(stage.camera)
            expect(Math.abs(screen.x), `horizontal edge at ${corner}`).toBeLessThan(0.99)
            expect(Math.abs(screen.y), `vertical edge at ${corner}`).toBeLessThan(0.99)
            expect(screen.z).toBeGreaterThan(-1)
            expect(screen.z).toBeLessThan(1)
          }
        }
      }
    },
  )

  it('makes a nearby crew member larger than one at the back of the room', () => {
    const stage = new Stagecraft()
    const back = stage.project({ x: 50, y: 15 })
    const front = stage.project({ x: 50, y: 85 })
    expect(front.unit).toBeGreaterThan(back.unit)
    expect(front.top).toBeGreaterThan(back.top)
  })

  it('restores the same framing after repeatedly opening a narrow tab', () => {
    const stage = new Stagecraft()
    stage.resize(1280, 700)
    const before = stage.project({ x: 19, y: 78 })
    for (let resize = 0; resize < 5; resize += 1) {
      stage.resize(320, 760)
      stage.resize(1280, 700)
    }
    expect(stage.project({ x: 19, y: 78 })).toEqual(before)
  })

  it('holds the last valid framing while its tab has zero size', () => {
    const stage = new Stagecraft()
    const before = stage.project({ x: 19, y: 78 })
    stage.resize(0, 0)
    expect(stage.project({ x: 19, y: 78 })).toEqual(before)
  })

  it('returns to the resting camera when reduced motion is enabled', () => {
    const stage = new Stagecraft()
    const resting = stage.camera.position.clone()
    stage.setLean(1, -1)
    stage.step(1)
    expect(stage.camera.position.equals(resting)).toBe(false)

    stage.setReducedMotion(true)
    stage.setLean(-1, 1)
    stage.step(1)
    expect(stage.camera.position.toArray()).toEqual(resting.toArray())
  })

  it('keeps reduced motion active after a hidden tab becomes visible', () => {
    const stage = new Stagecraft()
    stage.setReducedMotion(true)
    stage.setVisible(false)
    expect(stage.getActivity()).toBe('hidden')
    stage.setVisible(true)
    expect(stage.getActivity()).toBe('still')
  })
})
