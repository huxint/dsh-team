import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { WorldCamera } from '../src/client/world/camera.ts'
import { daylight } from '../src/client/world/daylight.ts'

describe('world camera', () => {
  it('zooms around the center without changing the viewing angle', () => {
    const view = new WorldCamera()
    const a = view.project({ x: -2, y: 0, z: 0 })
    const b = view.project({ x: 2, y: 0, z: 0 })
    const initial = a.distanceTo(b)
    const eye = view.camera.position.clone()
    view.zoom(2)
    expect(view.project({ x: -2, y: 0, z: 0 }).distanceTo(view.project({ x: 2, y: 0, z: 0 }))).toBeCloseTo(initial * 2)
    expect(view.camera.position).toEqual(eye)
  })

  it('bounds the zoom and ignores invalid zoom factors', () => {
    const view = new WorldCamera()
    view.zoom(100)
    expect(view.camera.zoom).toBe(8)
    view.zoom(0.0001)
    expect(view.camera.zoom).toBe(0.65)
    for (const factor of [0, -1, NaN, Infinity]) view.zoom(factor)
    expect(view.camera.zoom).toBe(0.65)
  })

  it('restores the same framing across resize and reset cycles', () => {
    const view = new WorldCamera()
    view.resize(1500, 740)
    const position = view.project({ x: -7, y: 0, z: 3 })
    for (let resize = 0; resize < 4; resize += 1) {
      view.zoom(2)
      view.resize(390, 740)
      view.resize(1500, 740)
      view.reset()
    }
    expect(view.project({ x: -7, y: 0, z: 3 })).toEqual(position)
    view.resize(0, 0)
    expect(view.project({ x: -7, y: 0, z: 3 })).toEqual(position)
  })

  it('keeps the exhibition tray inside a wide or narrow viewport', () => {
    const view = new WorldCamera()
    for (const [width, height] of [[1500, 740], [390, 740], [800, 500]]) {
      view.resize(width!, height!)
      for (const x of [-11.7, 19.7]) for (const z of [-12.2, 11.9]) {
        const point = new Vector3(x, -2.1, z).project(view.camera)
        expect(Math.abs(point.x)).toBeLessThan(1)
        expect(Math.abs(point.y)).toBeLessThan(1)
      }
    }
  })
})

describe('island daylight', () => {
  it('puts the sun above the horizon at noon and the moon above it at midnight', () => {
    expect(daylight(12).sun.y).toBeGreaterThan(18)
    expect(daylight(12).moon.y).toBeLessThan(-18)
    expect(daylight(12).light).toBe(1)
    expect(daylight(0).sun.y).toBeLessThan(-18)
    expect(daylight(0).moon.y).toBeGreaterThan(18)
    expect(daylight(0).light).toBe(0)
  })

  it('returns to the same orbit and light after a full day', () => {
    const morning = daylight(7)
    const tomorrow = daylight(31)
    expect(morning.sun.distanceTo(tomorrow.sun)).toBeLessThan(1e-12)
    expect(morning.light).toBeCloseTo(tomorrow.light)
    expect(morning.sun.x + morning.moon.x).toBeCloseTo(0)
    expect(morning.sun.y + morning.moon.y).toBeCloseTo(0)
  })
})
