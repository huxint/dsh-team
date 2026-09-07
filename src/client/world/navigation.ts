import {
  distance, FLOOR_HEIGHT, inset, inside, LIFT, obstacles, point, POOL_LEVEL, SEA_LEVEL,
  STAIR_COUNT, surfaces, WALK_RADIUS, type Bounds, type Floor, type Position, type Station, type Travel, type Waypoint,
} from './layout.ts'

interface Node { id: number; position: Position; floor: Floor; edges: Edge[] }
interface Edge { to: number; cost: number; travel: Travel; via?: readonly Position[] }
const GRID = 0.5
const LEVELS: readonly [Floor, number][] = [['ground', 0], ['terrace', FLOOR_HEIGHT], ['pool', POOL_LEVEL], ['sea', SEA_LEVEL]]

function intersection(from: Position, to: Position, bounds: Bounds): [number, number] | undefined {
  let enter = 0
  let exit = 1
  for (const [origin, delta, low, high] of [[from.x, to.x - from.x, bounds.minX, bounds.maxX], [from.z, to.z - from.z, bounds.minZ, bounds.maxZ]]) {
    if (Math.abs(delta!) < 1e-9) {
      if (origin! < low! || origin! > high!) return undefined
      continue
    }
    const first = (low! - origin!) / delta!
    const last = (high! - origin!) / delta!
    enter = Math.max(enter, Math.min(first, last))
    exit = Math.min(exit, Math.max(first, last))
    if (enter > exit) return undefined
  }
  return [enter, exit]
}

export class Navigation {
  private readonly nodes: Node[] = []
  private readonly stationNodes = new Map<string, number>()
  private readonly blocks: Record<Floor, ReturnType<typeof obstacles>>
  private readonly floors: Record<Floor, Bounds[]>
  private readonly minX: number

  constructor(stations: readonly Station[]) {
    this.minX = Math.min(-9.5, ...stations.filter(station => station.activity === 'work').map(station => station.position.x - 1.6))
    this.blocks = Object.fromEntries(LEVELS.map(([floor]) => [floor, obstacles(floor, stations.filter(station => station.activity === 'work')).map(bounds => inset(bounds, -WALK_RADIUS + 1e-6))])) as typeof this.blocks
    this.floors = Object.fromEntries(LEVELS.map(([floor]) => [floor, surfaces(floor)])) as typeof this.floors
    if (this.minX < -9.5) this.floors.ground.push({ minX: this.minX + WALK_RADIUS, maxX: -9, minZ: -10 + WALK_RADIUS, maxZ: 0.6 - WALK_RADIUS })
    for (const [floor, y] of LEVELS) {
      const grid = new Map<string, number>()
      for (let x = Math.ceil((this.minX + WALK_RADIUS) / GRID) * GRID; x <= 17; x += GRID) {
        for (let z = -9.5; z <= 10; z += GRID) {
          const position = point(x, y, z)
          if (!this.walkable(position, floor)) continue
          grid.set(`${x},${z}`, this.add(position, floor))
        }
      }
      for (const id of grid.values()) {
        const node = this.nodes[id]!
        for (const [dx, dz] of [[GRID, 0], [0, GRID], [GRID, GRID], [GRID, -GRID]]) {
          const next = grid.get(`${node.position.x + dx!},${node.position.z + dz!}`)
          if (next === undefined || !this.clear(node.position, this.nodes[next]!.position, floor)) continue
          this.connect(id, next, floor === 'pool' || floor === 'sea' ? 'swim' : 'walk')
        }
      }
    }

    const bottom = this.attach(point(1.5, 0, 0), 'ground')
    const top = this.attach(point(2.5, FLOOR_HEIGHT, -5.75), 'terrace')
    const steps: Position[] = [point(1.5, 0, -0.5)]
    for (let step = 1; step <= STAIR_COUNT; step += 1) {
      const z = -0.5 - (step - 1) * 5.5 / STAIR_COUNT
      steps.push(point(1.5, step * FLOOR_HEIGHT / STAIR_COUNT, z))
      steps.push(point(1.5, step * FLOOR_HEIGHT / STAIR_COUNT, z - 5.5 / STAIR_COUNT))
    }
    steps.push(point(2, FLOOR_HEIGHT, -6))
    this.connect(bottom, top, 'stairs', steps)

    this.connect(this.attach(point(LIFT.x, 0, LIFT.landingZ), 'ground'), this.attach(point(LIFT.x, FLOOR_HEIGHT, LIFT.landingZ), 'terrace'), 'elevator')
    this.connect(this.attach(point(-0.5, 0, 3), 'ground'), this.attach(point(-2, POOL_LEVEL, 3), 'pool'), 'ladder', [point(-0.9, 0.1, 3), point(-1.5, 0.1, 3), point(-1.5, POOL_LEVEL, 3)])
    this.connect(this.attach(point(5.5, 0, 9), 'ground'), this.attach(point(7, SEA_LEVEL, 9), 'sea'), 'ladder', [point(6.2, 0, 9), point(6.2, SEA_LEVEL, 9)])

    for (const station of stations) {
      const approach = this.attach(station.approach, station.floor)
      if (distance(station.approach, station.position) < 0.01) this.stationNodes.set(station.id, approach)
      else {
        const destination = this.add(station.position, station.floor)
        this.connect(approach, destination, station.floor === 'pool' || station.floor === 'sea' ? 'swim' : 'walk')
        this.stationNodes.set(station.id, destination)
      }
    }
  }

  walkable(position: Position, floor: Floor): boolean {
    return this.floors[floor].some(bounds => inside(position, bounds)) && !this.blocks[floor].some(bounds => inside(position, bounds))
  }

  clear(from: Position, to: Position, floor: Floor): boolean {
    if (this.blocks[floor].some(bounds => intersection(from, to, bounds) !== undefined)) return false
    const support = this.floors[floor].map(bounds => intersection(from, to, bounds)).filter((range): range is [number, number] => range !== undefined).sort((a, b) => a[0] - b[0])
    let covered = 0
    for (const [enter, exit] of support) {
      if (enter > covered + 1e-8) return false
      covered = Math.max(covered, exit)
    }
    return covered >= 1 - 1e-8
  }

  route(from: Position, floor: Floor, stationId: string, prefer: 'stairs' | 'elevator' = 'stairs'): Waypoint[] | undefined {
    const destination = this.stationNodes.get(stationId)
    if (destination === undefined) return undefined
    const exact = this.nodes.find(node => node.floor === floor && distance(node.position, from) < 0.02)
    const start = exact?.id ?? this.nearest(from, floor)
    if (start === undefined) return undefined
    const open = new Set([start])
    const costs = new Map([[start, 0]])
    const previous = new Map<number, { id: number; edge: Edge }>()
    const goal = this.nodes[destination]!
    while (open.size > 0) {
      let current = -1
      let minimum = Infinity
      for (const id of open) {
        const estimate = costs.get(id)! + distance(this.nodes[id]!.position, goal.position)
        if (estimate < minimum) { minimum = estimate; current = id }
      }
      if (current === destination) break
      open.delete(current)
      for (const edge of this.nodes[current]!.edges) {
        const penalty = edge.travel === 'elevator' ? (prefer === 'elevator' ? 0 : 14) : edge.travel === 'stairs' && prefer === 'elevator' ? 30 : 0
        const cost = costs.get(current)! + edge.cost + penalty
        if (cost >= (costs.get(edge.to) ?? Infinity)) continue
        costs.set(edge.to, cost)
        previous.set(edge.to, { id: current, edge })
        open.add(edge.to)
      }
    }
    if (start !== destination && !previous.has(destination)) return undefined
    const path: { node: Node; edge: Edge }[] = []
    let cursor = destination
    while (cursor !== start) {
      const entry = previous.get(cursor)!
      path.unshift({ node: this.nodes[cursor]!, edge: entry.edge })
      cursor = entry.id
    }
    const result: Waypoint[] = []
    const first = this.nodes[start]!
    if (distance(from, first.position) > 0.02) result.push({ ...first.position, floor: first.floor, travel: floor === 'sea' || floor === 'pool' ? 'swim' : 'walk' })
    for (const { node, edge } of path) {
      for (const position of edge.via ?? []) result.push({ ...position, floor: node.floor, travel: edge.travel })
      result.push({ ...node.position, floor: node.floor, travel: edge.travel })
    }
    return result
  }

  private add(position: Position, floor: Floor): number {
    const id = this.nodes.length
    this.nodes.push({ id, position: { ...position }, floor, edges: [] })
    return id
  }

  private attach(position: Position, floor: Floor): number {
    const existing = this.nodes.find(node => node.floor === floor && distance(node.position, position) < 0.02)
    if (existing) return existing.id
    const candidates = this.nodes.filter(node => node.floor === floor)
      .sort((a, b) => distance(a.position, position) - distance(b.position, position))
    const neighbours: Node[] = []
    for (const candidate of candidates) {
      if (!this.clear(position, candidate.position, floor)) continue
      neighbours.push(candidate)
      if (neighbours.length === 4) break
    }
    const id = this.add(position, floor)
    for (const neighbour of neighbours) this.connect(id, neighbour.id, floor === 'pool' || floor === 'sea' ? 'swim' : 'walk')
    return id
  }

  private nearest(position: Position, floor: Floor): number | undefined {
    let best: number | undefined
    let length = Infinity
    for (const node of this.nodes) {
      if (node.floor !== floor) continue
      const next = distance(position, node.position)
      if (next >= length || !this.clear(position, node.position, floor)) continue
      best = node.id
      length = next
    }
    return best
  }

  private connect(a: number, b: number, travel: Travel, via?: readonly Position[]): void {
    const path = [this.nodes[a]!.position, ...via ?? [], this.nodes[b]!.position]
    const cost = path.slice(1).reduce((sum, position, i) => sum + distance(path[i]!, position), 0)
    this.nodes[a]!.edges.push({ to: b, cost, travel, ...via ? { via } : {} })
    this.nodes[b]!.edges.push({ to: a, cost, travel, ...via ? { via: [...via].reverse() } : {} })
  }
}
