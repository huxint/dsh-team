/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorldRenderer } from '../src/client/world/renderer.ts'

// Keep the real scene, simulation and controls; only the GPU boundary is fake.
vi.mock('three', async importOriginal => {
  const three = await importOriginal<typeof import('three')>()
  return {
    ...three,
    WebGLRenderer: class {
      shadowMap = { enabled: true, type: 0, autoUpdate: false, needsUpdate: false }
      info = { render: { calls: 0, triangles: 0 } }
      ratio = 1
      render = vi.fn(() => { this.shadowMap.needsUpdate = false })
      setPixelRatio(value: number) { this.ratio = value }
      getPixelRatio() { return this.ratio }
      setSize() {}
      dispose() {}
      forceContextLoss() {}
    },
  }
})

let world: WorldRenderer
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
  // Model a 144 Hz screen: idle rendering must still stay near 30/15 Hz.
  const refresh = 1000 / 144
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), refresh))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  world = new WorldRenderer(document.createElement('canvas'), [], () => {}, () => {})
  world.resize(1000, 600)
  world.setActivity(true, false, true, true)
})
afterEach(() => {
  world.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('world power budget', () => {
  it('caps ambient work on high-refresh displays and reduces it when unfocused', () => {
    vi.advanceTimersByTime(2000)
    expect(vi.mocked(world.renderer.render).mock.calls.length).toBeGreaterThanOrEqual(58)
    expect(vi.mocked(world.renderer.render).mock.calls.length).toBeLessThanOrEqual(62)
    expect(world.simulation.seconds).toBeCloseTo(2, 1)
    vi.mocked(world.renderer.render).mockClear()
    world.setActivity(true, false, true, false)
    vi.advanceTimersByTime(2000)
    expect(vi.mocked(world.renderer.render).mock.calls.length).toBeGreaterThanOrEqual(28)
    expect(vi.mocked(world.renderer.render).mock.calls.length).toBeLessThanOrEqual(32)
  })

  it('cancels pending wakeups while hidden, then resumes without catching up hidden time', () => {
    vi.advanceTimersByTime(100)
    world.setActivity(false, false, true)
    const seconds = world.simulation.seconds
    vi.mocked(world.renderer.render).mockClear()
    expect(vi.getTimerCount()).toBe(0)
    world.invalidate()
    vi.advanceTimersByTime(60_000)
    expect(world.renderer.render).not.toHaveBeenCalled()
    expect(world.simulation.seconds).toBe(seconds)
    world.setActivity(true, false, true)
    vi.advanceTimersByTime(50)
    expect(world.renderer.render).toHaveBeenCalled()
    expect(world.simulation.seconds - seconds).toBeLessThan(0.1)
  })

  it.each([true, false])('draws only on demand with reduced motion=%s or manual pause', reduced => {
    world.setActivity(true, reduced, reduced)
    vi.advanceTimersByTime(100)
    expect(vi.getTimerCount()).toBe(0)
    const draw = vi.spyOn(world.characters, 'draw')
    vi.mocked(world.renderer.render).mockClear()
    world.setActivity(true, reduced, reduced)
    vi.advanceTimersByTime(1000)
    expect(world.renderer.render).not.toHaveBeenCalled()
    world.view.zoom(1.2)
    world.redraw()
    vi.advanceTimersByTime(100)
    expect(world.renderer.render).toHaveBeenCalled()
    expect(draw).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops scheduling after context loss and disposal', () => {
    vi.advanceTimersByTime(100)
    world.contextLost = true
    world.setActivity(true, false, true)
    expect(vi.getTimerCount()).toBe(0)
    world.contextLost = false
    world.setActivity(true, false, true)
    expect(vi.getTimerCount()).toBe(1)
    world.dispose()
    expect(vi.getTimerCount()).toBe(0)
    world.invalidate()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles a resize in one frame when motion is reduced', () => {
    world.setActivity(true, true, true)
    vi.advanceTimersByTime(100)
    vi.mocked(world.renderer.render).mockClear()
    world.resize(390, 760)
    vi.advanceTimersByTime(100)
    expect(world.renderer.render).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
