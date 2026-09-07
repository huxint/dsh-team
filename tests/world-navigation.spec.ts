import { describe, expect, it } from 'vitest'
import { deskStation, distance, FACILITIES, FLOOR_HEIGHT, obstacles, POOL_LEVEL, SEA_LEVEL, type Station } from '../src/client/world/layout.ts'
import { Navigation } from '../src/client/world/navigation.ts'

const desks = Array.from({ length: 9 }, (_, index) => deskStation(index))
const stations: readonly Station[] = [...desks, ...FACILITIES]
const navigation = new Navigation(stations)

describe('island navigation', () => {
  it('connects every workstation to each facility and back', () => {
    for (const desk of desks) for (const facility of FACILITIES) {
      const outward = navigation.route(desk.position, desk.floor, facility.id)
      const homeward = navigation.route(facility.position, facility.floor, desk.id)
      expect(outward?.at(-1), `${desk.id} to ${facility.id}`).toMatchObject(facility.position)
      expect(homeward?.at(-1), `${facility.id} to ${desk.id}`).toMatchObject(desk.position)
    }
  })

  it('keeps ordinary walking clear of furniture, pool edges, and gaps in the floor', () => {
    for (const desk of desks) for (const facility of FACILITIES) {
      const route = navigation.route(desk.position, desk.floor, facility.id)!
      for (let index = 1; index < route.length - 1; index += 1) {
        const from = route[index - 1]!
        const to = route[index]!
        if (from.travel !== 'walk' || to.travel !== 'walk' || from.floor !== to.floor) continue
        expect(navigation.clear(from, to, to.floor), `${desk.id} to ${facility.id}: ${JSON.stringify([from, to])}`).toBe(true)
        for (let sample = 0; sample <= 20; sample += 1) {
          const x = from.x + (to.x - from.x) * sample / 20
          const z = from.z + (to.z - from.z) * sample / 20
          const collision = obstacles(to.floor, desks).some(box => x > box.minX - 0.239 && x < box.maxX + 0.239 && z > box.minZ - 0.239 && z < box.maxZ + 0.239)
          expect(collision, `A body intersects furniture between ${JSON.stringify(from)} and ${JSON.stringify(to)}`).toBe(false)
        }
      }
    }
  })

  it('crosses the pool edge at the ladder and enters at the water level', () => {
    const route = navigation.route(desks[0]!.position, 'ground', 'pool-0')!
    const ladder = route.filter(step => step.travel === 'ladder')
    expect(ladder.map(({ x, y, z }) => [x, y, z])).toEqual([[-0.9, 0.1, 3], [-1.5, 0.1, 3], [-1.5, -0.35, 3], [-2, -0.35, 3]])
    expect(route.at(-1)?.y).toBe(POOL_LEVEL)
    expect(route.slice(route.findIndex(step => step.travel === 'swim')).every(step => step.y === POOL_LEVEL)).toBe(true)
  })

  it('uses the dock ladder to enter and leave the sea', () => {
    const outward = navigation.route(desks[3]!.position, 'ground', 'sea-0')!
    const homeward = navigation.route(FACILITIES.find(station => station.id === 'sea-0')!.position, 'sea', 'desk-3')!
    expect(outward.filter(step => step.travel === 'ladder').map(({ x, y, z }) => [x, y, z])).toEqual([[6.2, 0, 9], [6.2, -0.65, 9], [7, -0.65, 9]])
    expect(homeward.filter(step => step.travel === 'ladder').map(({ x, y, z }) => [x, y, z])).toEqual([[6.2, -0.65, 9], [6.2, 0, 9], [5.5, 0, 9]])
    expect(outward.at(-1)?.y).toBe(SEA_LEVEL)
  })

  it('climbs sixteen risers before walking onto the second floor', () => {
    const route = navigation.route(desks[0]!.position, 'ground', 'run-0', 'stairs')!
    const stairs = route.filter(step => step.travel === 'stairs')
    const heights = [...new Set(stairs.map(step => step.y))]
    expect(heights).toHaveLength(17)
    expect(heights[0]).toBe(0)
    expect(heights.at(-1)).toBe(FLOOR_HEIGHT)
    for (let index = 1; index < heights.length; index += 1) expect(heights[index]! - heights[index - 1]!).toBeCloseTo(0.2)
    expect(route.some(step => step.travel === 'elevator')).toBe(false)
    expect(distance(route.at(-1)!, { x: 4, y: 3.42, z: -4.1 })).toBeLessThan(0.001)
  })

  it('routes an elevator trip through matching floor landings', () => {
    const route = navigation.route(desks[0]!.position, 'ground', 'run-0', 'elevator')!
    const index = route.findIndex(step => step.travel === 'elevator')
    expect(index).toBeGreaterThan(0)
    expect(route[index - 1]).toMatchObject({ x: 8, y: 0, z: -0.75 })
    expect(route[index]).toMatchObject({ x: 8, y: 3.2, z: -0.75 })
    expect(route.some(step => step.travel === 'stairs')).toBe(false)
  })

  it('reports unknown destinations without inventing a straight-line route', () => {
    expect(navigation.route(desks[0]!.position, 'ground', 'missing')).toBeUndefined()
  })
})
