/** Floor-plan coordinates run from 0 to 100: x across the room, y toward the viewer. */
export interface Point {
  readonly x: number
  readonly y: number
}

export interface Rect extends Point {
  readonly w: number
  readonly h: number
}

export interface Post extends Point {
  readonly gap: number
  readonly scale: number
}

export interface Desk extends Post {
  readonly row: number
  readonly rows: number
  readonly columns: number
}

export const FIELD: Rect = { x: 7, y: 32, w: 60, h: 60 }

export const LOUNGE: Rect = { x: 69, y: 40, w: 29, h: 46 }

export const CORRIDOR = 91

export const LANES = { left: 3.5, right: 68.5 } as const

const AISLE = 5.5

// The scene and route planner share these dimensions in floor-plan units.
export const WORKSTATION = { width: 15, depth: 10.3, offset: -7.15, chairWidth: 6.5, chairDepth: 9 } as const

const NEAR = 0.5

const BAND = 4

const CLEARANCE = 2.4

const MARGIN = 2.5

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function rowsFor(count: number): number {
  if (count <= 3) return 1
  return count <= 8 ? 2 : 3
}

export function deskOf(index: number, count: number): Desk {
  const rows = rowsFor(count)
  const columns = Math.max(1, Math.ceil(count / rows))
  const row = Math.min(rows - 1, Math.floor(index / columns))
  const column = index % columns
  const filled = Math.min(columns, count - row * columns)
  const slack = (columns - filled) / 2
  const cell = FIELD.w / columns
  const depth = rows === 1 ? 1 : row / (rows - 1)
  return {
    x: round(FIELD.x + cell * (column + slack + 0.5)),
    y: round(FIELD.y + FIELD.h * ((row + 0.5) / rows)),
    gap: round(cell / 2),
    scale: round((0.84 + 0.16 * depth) * Math.min(1, 3 / columns)),
    row,
    rows,
    columns,
  }
}

export function breakAt(index: number): Post {
  const spots: readonly Point[] = [
    { x: LOUNGE.x + 8, y: LOUNGE.y + 29 },
    { x: LOUNGE.x + 15, y: LOUNGE.y + 33 },
    { x: LOUNGE.x + 14, y: LOUNGE.y + 23 },
  ]
  const spot = spots[index % spots.length] ?? spots[0]!
  return { x: round(spot.x), y: round(spot.y), gap: 7, scale: 0.9 }
}

export function visitAt(host: Post, fromX: number): Point {
  const side = fromX < host.x ? -1 : 1
  return { x: round(clamp(host.x + side * host.gap, 4, 96)), y: round(host.y + 2) }
}

export function footprintOf(post: Post): Rect {
  return {
    x: round(post.x - WORKSTATION.width * post.scale / 2),
    y: round(post.y + (WORKSTATION.offset - WORKSTATION.depth / 2) * post.scale),
    w: round(WORKSTATION.width * post.scale),
    h: round(WORKSTATION.depth * post.scale),
  }
}

export function aisleFor(y: number): number {
  return round(Math.min(CORRIDOR, y + AISLE))
}

export const BLOCKS = {
  sofa: { x: LOUNGE.x + 2.3, y: LOUNGE.y + 1, w: 14.5, h: 7 },
  table: { x: LOUNGE.x + 4.9, y: LOUNGE.y + 11, w: 10, h: 4.5 },
  plant: { x: LOUNGE.x + 21, y: LOUNGE.y + 2, w: 6, h: 6 },
  cooler: { x: LOUNGE.x + 22, y: LOUNGE.y + 12, w: 6, h: 6.5 },
  lamp: { x: LOUNGE.x + 0.5, y: LOUNGE.y + 8, w: 3, h: 3 },
  treadmill: { x: 86, y: 70, w: 11, h: 15 },
  utility: { x: 0.5, y: 41, w: 11, h: 22 },
} as const satisfies Record<string, Rect>

export const ROOM_BLOCKS: readonly Rect[] = Object.values(BLOCKS)

export function obstaclesOf(posts: Iterable<Post>): readonly Rect[] {
  return [...ROOM_BLOCKS, ...[...posts].flatMap(post => [
    footprintOf(post),
    // A member can leave its chair while the tabletop behind it still blocks the route.
    {
      x: round(post.x - WORKSTATION.chairWidth * post.scale / 2),
      y: round(post.y - 3.3 * post.scale),
      w: round(WORKSTATION.chairWidth * post.scale),
      h: round(WORKSTATION.chairDepth * post.scale),
    },
  ])]
}

function inflate(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 }
}

function inside(point: Point, rect: Rect): boolean {
  return point.x > rect.x && point.x < rect.x + rect.w
    && point.y > rect.y && point.y < rect.y + rect.h
}

// Grazing an edge is allowed; only crossing the interior blocks a leg.
function crossesRect(from: Point, to: Point, rect: Rect): boolean {
  const edge = 0.01
  const left = rect.x + edge
  const right = rect.x + rect.w - edge
  const top = rect.y + edge
  const bottom = rect.y + rect.h - edge
  if (right <= left || bottom <= top) return false
  const dx = to.x - from.x
  const dy = to.y - from.y
  let enter = 0
  let leave = 1
  const clip = (slope: number, distance: number): boolean => {
    if (Math.abs(slope) < 1e-9) return distance >= 0
    const cut = distance / slope
    if (slope < 0) {
      if (cut > leave) return false
      if (cut > enter) enter = cut
    } else {
      if (cut < enter) return false
      if (cut < leave) leave = cut
    }
    return true
  }
  return clip(-dx, from.x - left)
    && clip(dx, right - from.x)
    && clip(-dy, from.y - top)
    && clip(dy, bottom - from.y)
    && leave > enter + 1e-6
}

function laneFor(fromX: number, toX: number): number {
  return (fromX + toX) / 2 < FIELD.x + FIELD.w / 2 ? LANES.left : LANES.right
}

function prune(points: readonly Point[]): readonly Point[] {
  const out: Point[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last !== undefined && Math.abs(last.x - point.x) < NEAR && Math.abs(last.y - point.y) < NEAR) continue
    const before = out[out.length - 2]
    if (
      last !== undefined && before !== undefined
      && ((Math.abs(before.x - last.x) < NEAR && Math.abs(last.x - point.x) < NEAR)
        || (Math.abs(before.y - last.y) < NEAR && Math.abs(last.y - point.y) < NEAR))
    ) {
      out.pop()
    }
    out.push(point)
  }
  return out
}

// Dense rosters can disconnect the visibility graph; an aisle route keeps deliveries moving.
function laneRoute(from: Point, to: Point): readonly Point[] {
  if (Math.abs(from.y - to.y) <= BAND) {
    const aisle = aisleFor(Math.max(from.y, to.y))
    return prune([from, { x: from.x, y: aisle }, { x: to.x, y: aisle }, to])
  }
  const lane = laneFor(from.x, to.x)
  const out = aisleFor(from.y)
  const back = aisleFor(to.y)
  return prune([
    from,
    { x: from.x, y: out },
    { x: lane, y: out },
    { x: lane, y: back },
    { x: to.x, y: back },
    to,
  ])
}

function span(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

function cornersOf(blocks: readonly Rect[]): readonly Point[] {
  const out: Point[] = []
  for (const block of blocks) {
    const grown = inflate(block, CLEARANCE)
    const candidates: Point[] = [
      { x: grown.x, y: grown.y },
      { x: grown.x + grown.w, y: grown.y },
      { x: grown.x, y: grown.y + grown.h },
      { x: grown.x + grown.w, y: grown.y + grown.h },
    ]
    for (const corner of candidates) {
      const spot = { x: clamp(corner.x, MARGIN, 100 - MARGIN), y: clamp(corner.y, MARGIN, 100 - MARGIN) }
      if (blocks.some(other => inside(spot, inflate(other, CLEARANCE * 0.6)))) continue
      out.push(spot)
    }
  }
  return out
}

export function routeBetween(
  from: Point,
  to: Point,
  obstacles: readonly Rect[] = ROOM_BLOCKS,
): readonly Point[] {
  if (Math.abs(from.x - to.x) < NEAR && Math.abs(from.y - to.y) < NEAR) return [from]
  // Furniture containing an endpoint must allow its occupant to enter or leave.
  const blocks = obstacles.filter(rect => {
    const grown = inflate(rect, CLEARANCE * 0.5)
    return !inside(from, grown) && !inside(to, grown)
  })
  // Visitors can stand inside a clearance buffer, but routes cannot transit through it.
  const clear = (a: Point, b: Point): boolean => !blocks.some(rect => {
    if (crossesRect(a, b, rect)) return true
    const grown = inflate(rect, CLEARANCE)
    return !inside(a, grown) && !inside(b, grown) && crossesRect(a, b, grown)
  })
  if (clear(from, to)) return [from, to]

  const nodes: Point[] = [from, ...cornersOf(blocks), to]
  const goal = nodes.length - 1
  const best = nodes.map(() => Infinity)
  const via = nodes.map(() => -1)
  const done = nodes.map(() => false)
  best[0] = 0
  for (; ;) {
    let at = -1
    for (let index = 0; index < nodes.length; index += 1) {
      const cost = best[index]!
      if (!done[index] && cost < (at < 0 ? Infinity : best[at]!)) at = index
    }
    if (at < 0 || at === goal) break
    done[at] = true
    const here = nodes[at]!
    for (let index = 0; index < nodes.length; index += 1) {
      if (done[index] || index === at || !clear(here, nodes[index]!)) continue
      const cost = best[at]! + span(here, nodes[index]!)
      if (cost < best[index]!) {
        best[index] = cost
        via[index] = at
      }
    }
  }
  if (best[goal] === Infinity) return laneRoute(from, to)

  const path: Point[] = []
  for (let at = goal; at >= 0; at = via[at]!) {
    path.unshift(nodes[at]!)
    if (at === 0) break
  }
  return prune(path)
}

const SHOULDER = 2.2

const ARC = 3

export function smooth(points: readonly Point[], blocks: readonly Rect[] = []): readonly Point[] {
  if (points.length < 3) return points
  const out: Point[] = [points[0]!]
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1]!
    const corner = points[index]!
    const after = points[index + 1]!
    const back = Math.min(SHOULDER, span(before, corner) * 0.4)
    const on = Math.min(SHOULDER, span(corner, after) * 0.4)
    if (back < 0.2 || on < 0.2) {
      out.push(corner)
      continue
    }
    const start = along(corner, before, back)
    const end = along(corner, after, on)
    if (blocks.some(rect => crossesRect(start, end, rect))) {
      out.push(corner)
      continue
    }
    out.push(start)
    for (let step = 1; step < ARC; step += 1) out.push(bend(start, corner, end, step / ARC))
    out.push(end)
  }
  out.push(points[points.length - 1]!)
  return out
}

function along(corner: Point, toward: Point, distance: number): Point {
  const length = span(corner, toward) || 1
  return {
    x: round(corner.x + ((toward.x - corner.x) / length) * distance),
    y: round(corner.y + ((toward.y - corner.y) / length) * distance),
  }
}

function bend(start: Point, corner: Point, end: Point, at: number): Point {
  const rest = 1 - at
  return {
    x: round(rest * rest * start.x + 2 * rest * at * corner.x + at * at * end.x),
    y: round(rest * rest * start.y + 2 * rest * at * corner.y + at * at * end.y),
  }
}

export function walkMs(distance: number, speed = 34): number {
  return Math.max(140, Math.round((distance / speed) * 1000))
}

export function lengthOf(points: readonly Point[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) total += span(points[index - 1]!, points[index]!)
  return round(total)
}

export const HAUNTS: readonly Post[] = [
  { x: 93, y: 58, gap: 5, scale: 0.92 },
  { x: 34, y: 20, gap: 6, scale: 0.86 },
  { x: 58, y: 20, gap: 6, scale: 0.86 },
  { x: 88, y: 47, gap: 5, scale: 0.9 },
]

function hash(a: number, b: number): number {
  let value = Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}

export function wanderOf(seat: number, tick: number): Post | undefined {
  if (tick === 0) return undefined
  if (hash(seat, tick) < 0.62) return undefined
  const pick = Math.floor(hash(seat, tick + 7919) * HAUNTS.length)
  const haunt = HAUNTS[Math.min(HAUNTS.length - 1, pick)]
  if (haunt === undefined) return undefined
  const step = ((seat + 1) % 3) - 1
  return { ...haunt, x: round(clamp(haunt.x + step * 4.5, MARGIN, 100 - MARGIN)) }
}

const PERSONAL = 5

export function spread(spots: readonly Point[]): readonly Point[] {
  const out = spots.map(spot => ({ x: spot.x, y: spot.y }))
  for (const [index, spot] of out.entries()) {
    for (let other = index + 1; other < out.length; other += 1) {
      const mate = out[other]!
      const apart = span(spot, mate)
      if (apart >= PERSONAL) continue
      const push = (PERSONAL - apart) / 2
      // Coincident positions separate along x, with roster order breaking the tie.
      const dx = apart < 0.01 ? 1 : (mate.x - spot.x) / apart
      const dy = apart < 0.01 ? 0 : (mate.y - spot.y) / apart
      spot.x = clamp(spot.x - dx * push, MARGIN, 100 - MARGIN)
      spot.y = clamp(spot.y - dy * push, MARGIN, 100 - MARGIN)
      mate.x = clamp(mate.x + dx * push, MARGIN, 100 - MARGIN)
      mate.y = clamp(mate.y + dy * push, MARGIN, 100 - MARGIN)
    }
  }
  return out.map(spot => ({ x: round(spot.x), y: round(spot.y) }))
}

export type Touch = 'got' | 'sent' | 'reported'

export type Station = 'desk' | 'break'

export type Pose = 'working' | 'reading' | 'idle'

export function stationFor(running: boolean, touch: Touch | undefined, openTasks: number): Station {
  if (running || touch === 'got') return 'desk'
  return touch === 'reported' && openTasks === 0 ? 'break' : 'desk'
}

export function poseFor(running: boolean, touch: Touch | undefined, openTasks: number): Pose {
  if (running) return 'working'
  return touch === 'got' || openTasks > 0 ? 'reading' : 'idle'
}
