/**
 * The room's own arithmetic: where every workstation stands, what its owner is
 * doing there, and how a member walks from one place on the floor to another.
 *
 * All of it is pure geometry over the roster — a place comes from a member's
 * index, never from a DOM measurement. A walk is planned on a visibility graph
 * built from the furniture itself: every desk, the sofa, the low table, the
 * cooler and the plant carry a rectangle of floor nobody may cross, the corners
 * of those rectangles are the only places worth turning at, and the shortest
 * chain of clear straight lines between them is the walk. Furniture moves, the
 * routes move with it; nothing is hard-coded to a lane.
 *
 * How the flat plan here becomes the box you look into is `stagecraft.ts`'s
 * job, not this module's: the floor is 0–100 square and knows nothing about
 * perspective.
 */

/** A point on the floor, in the room's own 0–100 space. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** A rectangle of the floor, in the same space. */
export interface Rect extends Point {
  readonly w: number
  readonly h: number
}

/**
 * A place a member stands: the point under its feet, how much clear floor it
 * has beside it (where a visitor stops to talk), and how large it draws there
 * — a desk further back stands smaller, so the room has depth.
 */
export interface Post extends Point {
  readonly gap: number
  readonly scale: number
}

/** One workstation, and the row of desks it belongs to. */
export interface Desk extends Post {
  readonly row: number
  readonly rows: number
  readonly columns: number
}

/** The floor the desks are laid out on. */
export const FIELD: Rect = { x: 7, y: 32, w: 60, h: 60 }

/** The break corner, in the near right of the room. */
export const LOUNGE: Rect = { x: 69, y: 40, w: 29, h: 46 }

/** The walkway across the front of the room: every cross-row trip uses it. */
export const CORRIDOR = 91

/** The two vertical lanes down the sides of the desk field. */
export const LANES = { left: 3.5, right: 68.5 } as const

/** How far in front of a desk its own aisle runs. */
const AISLE = 5.5

/** Half the height of the floor one desk and its chair take up. */
const FOOT_HEIGHT = 4.4

/** Two places closer than this are the same place. */
const NEAR = 0.5

/** Rows of desks that differ by less than this share one aisle. */
const BAND = 4

/** How much clear floor a walker keeps between itself and the furniture. */
const CLEARANCE = 2.4

/** The strip along each wall a route never turns into. */
const MARGIN = 2.5

/** Round geometry so a style, a test and a route all read the same number. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Keep a place on the floor rather than through a wall. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * How many rows of desks a roster of this size stands in. Rows stay wide and
 * shallow: a room reads better across than back, and three rows is as deep as
 * the aisles between them can stay walkable.
 * @param count - how many members the room seats.
 * @returns the number of rows.
 */
export function rowsFor(count: number): number {
  if (count <= 3) return 1
  return count <= 8 ? 2 : 3
}

/**
 * One member's own desk: the same seat for the same roster index, every
 * render. Desks fill left to right and front rows draw larger than back ones.
 * @param index - the member's index on the roster (the leader takes the first).
 * @param count - how many members the room seats.
 * @returns the workstation.
 */
export function deskOf(index: number, count: number): Desk {
  const rows = rowsFor(count)
  const columns = Math.max(1, Math.ceil(count / rows))
  const row = Math.min(rows - 1, Math.floor(index / columns))
  const column = index % columns
  // A short last row is centered under the full ones rather than left-hung.
  const filled = Math.min(columns, count - row * columns)
  const slack = (columns - filled) / 2
  const cell = FIELD.w / columns
  const depth = rows === 1 ? 1 : row / (rows - 1)
  return {
    x: round(FIELD.x + cell * (column + slack + 0.5)),
    y: round(FIELD.y + FIELD.h * ((row + 0.5) / rows)),
    gap: round(cell / 2),
    scale: round((0.84 + 0.16 * depth) * (columns <= 3 ? 1 : columns === 4 ? 0.88 : 0.76)),
    row,
    rows,
    columns,
  }
}

/**
 * Where the break corner puts the nth member taking one. There are three
 * places to stand around the sofa, all of them in front of the furniture and
 * close enough to it to belong to it — a member on a break stands at the
 * coffee table, never in it, and never marooned on the floor below it — and a
 * fourth member shares the first. The rightmost place stays clear of the
 * treadmill in the corner beyond it: somebody standing in the machine's way
 * would be drawn into its deck.
 * @param index - the member's index among those on a break.
 * @returns the place it stands.
 */
export function breakAt(index: number): Post {
  const spots: readonly Point[] = [
    { x: LOUNGE.x + 8, y: LOUNGE.y + 29 },
    { x: LOUNGE.x + 15, y: LOUNGE.y + 33 },
    { x: LOUNGE.x + 14, y: LOUNGE.y + 23 },
  ]
  const spot = spots[index % spots.length] ?? spots[0]!
  return { x: round(spot.x), y: round(spot.y), gap: 7, scale: 0.9 }
}

/**
 * Where a visitor stops to talk: beside its host, on the side it arrived from,
 * one step in front so neither of them is hidden behind the other.
 * @param host - the place the member being visited stands.
 * @param fromX - where the visitor is coming from.
 * @returns the place the visitor stands while it talks.
 */
export function visitAt(host: Post, fromX: number): Point {
  const side = fromX < host.x ? -1 : 1
  return { x: round(clamp(host.x + side * host.gap, 4, 96)), y: round(host.y + 2) }
}

/** The floor one desk and its chair take up; a route must not cross it. */
export function footprintOf(post: Post): Rect {
  return {
    x: round(post.x - post.gap * 0.84),
    y: round(post.y - FOOT_HEIGHT),
    w: round(post.gap * 1.68),
    h: FOOT_HEIGHT * 2,
  }
}

/** The walkway in front of whatever stands at this depth. */
export function aisleFor(y: number): number {
  return round(Math.min(CORRIDOR, y + AISLE))
}

/* ------------------------------------------------------------- the furniture */

/**
 * The standing furniture of the break corner, in the same 0–100 plan the desks
 * use. These are the floor rectangles the pieces occupy, which is what a walk
 * has to know about them; the stylesheet draws them inside the projected
 * lounge box at the matching fractions of it.
 */
export const BLOCKS = {
  /** The sofa, along the back of the corner. */
  sofa: { x: LOUNGE.x + 2.3, y: LOUNGE.y + 1, w: 14.5, h: 7 },
  /** The low table in front of it. */
  table: { x: LOUNGE.x + 4.9, y: LOUNGE.y + 11, w: 10, h: 4.5 },
  /** The plant, in the far corner. */
  plant: { x: LOUNGE.x + 21, y: LOUNGE.y + 2, w: 6, h: 6 },
  /** The water cooler, against the right wall. */
  cooler: { x: LOUNGE.x + 22, y: LOUNGE.y + 12, w: 6, h: 6.5 },
  /** The floor lamp at the corner's edge. */
  lamp: { x: LOUNGE.x + 0.5, y: LOUNGE.y + 8, w: 3, h: 3 },
  /**
   * The treadmill, in the front-right corner: the wellness zone, in front of
   * the lounge and out of every walkway.
   */
  treadmill: { x: 86, y: 70, w: 11, h: 15 },
  /**
   * The filing cabinet, printer and coffee machine, clustered against the
   * left wall beside the desks, and the floor a walker keeps clear of them.
   */
  utility: { x: 0.5, y: 41, w: 11, h: 22 },
} as const satisfies Record<string, Rect>

/** The standing furniture as one list, for the walks. */
export const ROOM_BLOCKS: readonly Rect[] = Object.values(BLOCKS)

/**
 * Everything a walk goes around: the standing furniture of the room plus one
 * rectangle per workstation.
 * @param posts - the desks currently on the floor.
 * @returns every rectangle of floor a route must stay out of.
 */
export function obstaclesOf(posts: Iterable<Post>): readonly Rect[] {
  return [...ROOM_BLOCKS, ...[...posts].map(footprintOf)]
}

/** A rectangle grown by the clearance a walker keeps around it. */
function inflate(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 }
}

/** Whether a point lies inside a rectangle. */
function inside(point: Point, rect: Rect): boolean {
  return point.x > rect.x && point.x < rect.x + rect.w
    && point.y > rect.y && point.y < rect.y + rect.h
}

/**
 * Whether a straight leg passes through the inside of a rectangle. Running
 * along an edge is not crossing it: a walker may graze the furniture it has
 * just left without the route being called blocked.
 */
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
  /** Clip the leg against one of the four slabs; false when it misses entirely. */
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

/** Which side lane a trip between these two columns goes around by. */
function laneFor(fromX: number, toX: number): number {
  return (fromX + toX) / 2 < FIELD.x + FIELD.w / 2 ? LANES.left : LANES.right
}

/** Drop the legs a walk would not take: zero-length ones, and straight-throughs. */
function prune(points: readonly Point[]): readonly Point[] {
  const out: Point[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last !== undefined && Math.abs(last.x - point.x) < NEAR && Math.abs(last.y - point.y) < NEAR) continue
    const before = out[out.length - 2]
    // Three points on one line are two legs of the same walk: keep the far end.
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

/**
 * The old lane route, kept as the way out when the graph cannot find one: out
 * to your own aisle, down a side lane, in along the destination's aisle. It
 * crosses furniture rather than leaving somebody stranded, which is the right
 * trade for a room that has been packed too tight to walk through.
 */
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

/** How far apart two places are. */
function span(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/**
 * The corners worth turning at: each blocking rectangle's four corners, pushed
 * out by the clearance, dropped when they fall inside another piece or off the
 * floor. A shortest path around rectangles only ever turns at one of these.
 */
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

/**
 * The walk from one place on the floor to another, as the corners it turns.
 *
 * A member leaves its own desk and walks around everything else: the route is
 * the shortest chain of clear straight lines between the corners of the
 * furniture. Whatever the walker is standing in — its own workstation — stops
 * blocking for the length of that trip, because you are allowed to walk out of
 * your own chair.
 * @param from - where the walk starts.
 * @param to - where it ends.
 * @param obstacles - the furniture on the floor; defaults to the fixed pieces.
 * @returns the corners, starting at `from` and ending at `to`.
 */
export function routeBetween(
  from: Point,
  to: Point,
  obstacles: readonly Rect[] = ROOM_BLOCKS,
): readonly Point[] {
  if (Math.abs(from.x - to.x) < NEAR && Math.abs(from.y - to.y) < NEAR) return [from]
  // The two ends stand in their own furniture; that furniture cannot block the
  // trip out of it, or nobody would ever leave a desk.
  const blocks = obstacles.filter(rect => {
    const grown = inflate(rect, CLEARANCE * 0.5)
    return !inside(from, grown) && !inside(to, grown)
  })
  // A leg is blocked when it plows through a piece of furniture, or when it
  // TRANSITS the clearance a walker keeps around one — neither end standing
  // inside that buffer, which a visitor beside a desk does by design. Corners
  // sit on the grown boundary and grazing a boundary is not crossing it, so
  // the corridors between buffers stay walkable.
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
  for (;;) {
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

/** How far into a leg a turn starts rounding off. */
const SHOULDER = 2.2

/** How many samples one rounded corner is drawn from. */
const ARC = 3

/**
 * The same walk with its corners rounded off. A person turning a corner does
 * not stop dead and set off again at a right angle: each turn is replaced by a
 * short arc that starts before the corner and finishes after it, cut back
 * whenever the legs are too short to give it room.
 * @param points - the corners of the walk.
 * @param blocks - furniture the rounded corner still may not cut through.
 * @returns the walk, as points to be followed in a straight line between.
 */
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

/** The point this far from `corner` along the line toward `toward`. */
function along(corner: Point, toward: Point, distance: number): Point {
  const length = span(corner, toward) || 1
  return {
    x: round(corner.x + ((toward.x - corner.x) / length) * distance),
    y: round(corner.y + ((toward.y - corner.y) / length) * distance),
  }
}

/** One sample of the quadratic curve that rounds a corner off. */
function bend(start: Point, corner: Point, end: Point, at: number): Point {
  const rest = 1 - at
  return {
    x: round(rest * rest * start.x + 2 * rest * at * corner.x + at * at * end.x),
    y: round(rest * rest * start.y + 2 * rest * at * corner.y + at * at * end.y),
  }
}

/** How long a walk of this length takes, at a walking pace. */
export function walkMs(distance: number, speed = 34): number {
  return Math.max(140, Math.round((distance / speed) * 1000))
}

/** The whole length of a walk, corner to corner. */
export function lengthOf(points: readonly Point[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) total += span(points[index - 1]!, points[index]!)
  return round(total)
}

/* ------------------------------------------------------------- idle errands */

/**
 * The places a member with nothing on its plate drifts off to: the cooler, the
 * two windows, and the plant in the corner. Somewhere to be that is not a
 * chair — an office where nobody ever gets up is a diorama.
 */
export const HAUNTS: readonly Post[] = [
  /** At the water cooler, filling a cup. */
  { x: 93, y: 58, gap: 5, scale: 0.92 },
  /** At the left-hand window, looking out. */
  { x: 34, y: 20, gap: 6, scale: 0.86 },
  /** At the right-hand window. */
  { x: 58, y: 20, gap: 6, scale: 0.86 },
  /** Stretching by the plant. */
  { x: 88, y: 47, gap: 5, scale: 0.9 },
]

/** A stable number in 0–1 for a pair of integers: the same seat, the same trip. */
function hash(a: number, b: number): number {
  let value = Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}

/**
 * Where a member with nothing to do wanders on the nth turn of the room's
 * clock, if it wanders anywhere at all. Most turns it stays where it is: an
 * office in which everybody is always on their feet is as wrong as one in
 * which nobody ever is.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @param tick - which turn of the room's clock this is.
 * @returns the place it drifts to, or nothing if it stays put.
 */
export function wanderOf(seat: number, tick: number): Post | undefined {
  // The first turn keeps everybody put: nobody arrives in the room already
  // out of its chair.
  if (tick === 0) return undefined
  if (hash(seat, tick) < 0.62) return undefined
  const pick = Math.floor(hash(seat, tick + 7919) * HAUNTS.length)
  const haunt = HAUNTS[Math.min(HAUNTS.length - 1, pick)]
  if (haunt === undefined) return undefined
  // Two members who drift to the same haunt stand beside each other rather than
  // inside each other: each seat keeps its own place at the cooler.
  const step = ((seat + 1) % 3) - 1
  return { ...haunt, x: round(clamp(haunt.x + step * 4.5, MARGIN, 100 - MARGIN)) }
}

/** How far apart two members standing still push each other. */
const PERSONAL = 5

/**
 * The same places with nobody standing inside anybody else. Two members sent
 * to the same corner would otherwise draw one on top of the other; one pass of
 * separation is enough to tell them apart without moving either far enough to
 * leave the spot it was sent to.
 * @param spots - where each member has been told to stand, in roster order.
 * @returns the same list, nudged apart.
 */
export function spread(spots: readonly Point[]): readonly Point[] {
  const out = spots.map(spot => ({ x: spot.x, y: spot.y }))
  for (const [index, spot] of out.entries()) {
    for (let other = index + 1; other < out.length; other += 1) {
      const mate = out[other]!
      const apart = span(spot, mate)
      if (apart >= PERSONAL) continue
      // Two members sent to exactly one point are parted along the floor, not
      // along a zero-length line: the tie is broken by roster order.
      const push = (PERSONAL - apart) / 2
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

/** The last thing that happened to one member in the visible mailbox tail. */
export type Touch = 'got' | 'sent' | 'reported'

/** Where a member is: at its own desk, or taking a break in the corner. */
export type Station = 'desk' | 'break'

/** What a member is doing there. */
export type Pose = 'working' | 'reading' | 'idle'

/**
 * Whether a member is at its desk or on a break. A member keeps its own desk
 * for good — it only leaves it once its own report is the last thing it did
 * and nothing open is left with its name on it.
 * @param running - whether the member is mid-turn.
 * @param touch - the last mailbox event that named it, if any.
 * @param openTasks - how many unfinished tasks name it as assignee.
 * @returns where it stands.
 */
export function stationFor(running: boolean, touch: Touch | undefined, openTasks: number): Station {
  if (running || touch === 'got') return 'desk'
  return touch === 'reported' && openTasks === 0 ? 'break' : 'desk'
}

/**
 * What a member is doing where it stands: mid-turn it works, with mail or open
 * work on its plate it reads, and with neither it idles.
 * @param running - whether the member is mid-turn.
 * @param touch - the last mailbox event that named it, if any.
 * @param openTasks - how many unfinished tasks name it as assignee.
 * @returns the pose.
 */
export function poseFor(running: boolean, touch: Touch | undefined, openTasks: number): Pose {
  if (running) return 'working'
  return touch === 'got' || openTasks > 0 ? 'reading' : 'idle'
}
