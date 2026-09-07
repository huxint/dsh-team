import { describe, expect, it } from 'vitest'
import { Mesh, Raycaster, Vector3 } from 'three'
import { createIsland } from '../src/client/world/island.ts'
import { deskStation } from '../src/client/world/layout.ts'
import { disposeObjects } from '../src/client/world/renderer.ts'

const desks = Array.from({ length: 9 }, (_, index) => deskStation(index))

describe('the physical island', () => {
  it('builds a pool basin below the surrounding deck', () => {
    const island = createIsland(desks)
    island.group.updateMatrixWorld(true)
    const floor = new Raycaster(new Vector3(-4.5, 2, 3), new Vector3(0, -1, 0)).intersectObject(island.group, true)[0]!
    const deck = new Raycaster(new Vector3(-1.25, 2, 3), new Vector3(0, -1, 0)).intersectObject(island.group, true)[0]!
    expect(floor.point.y).toBeLessThan(-0.9)
    expect(deck.point.y).toBeGreaterThanOrEqual(0)
    expect(deck.point.y - floor.point.y).toBeGreaterThan(1)
    disposeObjects(island.group)
  })

  it('supports each stair tread at the height used by walking residents', () => {
    const island = createIsland(desks)
    island.group.updateMatrixWorld(true)
    for (let step = 0; step < 16; step += 1) {
      const z = -0.5 - (step + 0.5) * 5.5 / 16
      const hit = new Raycaster(new Vector3(1.5, 5, z), new Vector3(0, -1, 0)).intersectObject(island.group, true)[0]!
      expect(hit.point.y).toBeCloseTo((step + 1) * 0.2, 4)
    }
    disposeObjects(island.group)
  })

  it('leaves an opening through the terrace for the elevator cabin', () => {
    const island = createIsland(desks)
    island.group.updateMatrixWorld(true)
    const shaft = new Raycaster(new Vector3(8, 3.35, -2), new Vector3(0, -1, 0))
    expect(shaft.intersectObject(island.upper, true)).toHaveLength(0)
    disposeObjects(island.group)
  })

  it('disposes every shared geometry and material once when the world closes', () => {
    const island = createIsland(desks)
    const resources = new Set<{ addEventListener: (type: 'dispose', callback: () => void) => void }>()
    island.group.traverse(object => {
      if (!(object instanceof Mesh)) return
      resources.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material)
    })
    const released = new Map<object, number>()
    for (const resource of resources) resource.addEventListener('dispose', () => { released.set(resource, (released.get(resource) ?? 0) + 1) })
    disposeObjects(island.group)
    expect(released.size).toBe(resources.size)
    expect([...released.values()].every(count => count === 1)).toBe(true)
  })
})
