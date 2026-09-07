/** Resident positions mark the feet on land and the waterline while swimming. */
export interface Position { x: number; y: number; z: number }
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export type Floor = 'ground' | 'terrace' | 'pool' | 'sea'
export type Activity = 'work' | 'relax' | 'pool' | 'sea' | 'run' | 'snack' | 'lookout' | 'play' | 'garden' | 'camp' | 'read'
export type Travel = 'walk' | 'stairs' | 'ladder' | 'swim' | 'elevator'
export interface Waypoint extends Position { floor: Floor; travel: Travel }
export interface Station {
  id: string
  activity: Activity
  position: Position
  approach: Position
  floor: Floor
  facing: number
}

export const LAND: Bounds = { minX: -9.5, maxX: 17.5, minZ: -10, maxZ: 7 }
export const TRAY: Bounds = { minX: -11.5, maxX: 19.5, minZ: -12, maxZ: 11.7 }
export const TREES = [
  { x: -8.8, z: -6.2, height: 4.1, lean: 0.25 }, { x: -8.7, z: 6.1, height: 3.7, lean: -0.3 },
  { x: 8.55, z: 5.1, height: 4.6, lean: -0.4 }, { x: 9, z: -5.9, height: 4.2, lean: 0.2 },
  { x: 16.8, z: 3.5, height: 4.6, lean: -0.1 }, { x: 10.1, z: -9, height: 4.7, lean: -0.2 },
  { x: 16.7, z: -9.2, height: 4.2, lean: 0.1 },
] as const
export const POOL: Bounds = { minX: -7.75, maxX: -1.25, minZ: 0.5, maxZ: 5.5 }
export const TERRACE: Bounds = { minX: 2.25, maxX: 8.75, minZ: -6.25, maxZ: -0.5 }
export const PIER: Bounds = { minX: 4.75, maxX: 6.25, minZ: 6.5, maxZ: 9.5 }
export const SHAFT: Bounds = { minX: 7.25, maxX: 8.75, minZ: -2.75, maxZ: -1.25 }
export const STAIRS: Bounds = { minX: 0.75, maxX: 2.25, minZ: -6, maxZ: -0.5 }
export const FLOOR_HEIGHT = 3.2
export const POOL_LEVEL = -0.35
export const SEA_LEVEL = -0.65
export const WALK_RADIUS = 0.24
export const STAIR_COUNT = 16
export const LIFT = { x: 8, z: -2, landingZ: -0.75, speed: 1.25, doorSeconds: 0.65 }

export const point = (x: number, y: number, z: number): Position => ({ x, y, z })
export const inside = (p: Position, b: Bounds, margin = 0): boolean =>
  p.x > b.minX - margin && p.x < b.maxX + margin && p.z > b.minZ - margin && p.z < b.maxZ + margin
export const distance = (a: Position, b: Position): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

export function deskStation(index: number): Station {
  const column = index % 3
  const row = Math.floor(index % 9 / 3)
  const x = -7.7 + column * 3.2 - Math.floor(index / 9) * 10.3
  const z = -7.75 + row * 2.75
  return { id: `desk-${index}`, activity: 'work', position: point(x, 0, z), approach: point(x + 0.85, 0, z + 0.35), floor: 'ground', facing: Math.PI }
}

export const FACILITIES: readonly Station[] = [
  ...[-3, -4.5, -6].map((x, index): Station => ({
    id: `pool-${index}`, activity: 'pool', floor: 'pool', position: point(x, POOL_LEVEL, 3), approach: point(x, POOL_LEVEL, 3), facing: Math.PI / 2,
  })),
  ...[8, 10].map((x, index): Station => ({
    id: `sea-${index}`, activity: 'sea', floor: 'sea', position: point(x, SEA_LEVEL, 9), approach: point(x, SEA_LEVEL, 9), facing: Math.PI / 2,
  })),
  ...[4, 6].map((x, index): Station => ({
    id: `run-${index}`, activity: 'run', floor: 'terrace', position: point(x, FLOOR_HEIGHT + 0.22, -4.1), approach: point(x, FLOOR_HEIGHT, -2.75), facing: Math.PI,
  })),
  ...[4.25, 6].map((x, index): Station => ({
    id: `snack-${index}`, activity: 'snack', floor: 'ground', position: point(x, 0, -2.7), approach: point(x, 0, -2), facing: Math.PI,
  })),
  ...[3.4, 4.75, 6.1].map((x, index): Station => ({
    id: `relax-${index}`, activity: 'relax', floor: 'ground', position: point(x, 0, 3.55), approach: point(x, 0, 4.3), facing: 0,
  })),
  { id: 'lookout-0', activity: 'lookout', floor: 'terrace', position: point(2.9, FLOOR_HEIGHT, -5.25), approach: point(3, FLOOR_HEIGHT, -5.5), facing: -Math.PI / 2 },
  ...[12, 14.5].map((x, index): Station => ({
    id: `play-${index}`, activity: 'play', floor: 'ground', position: point(x, 0, 1), approach: point(x, 0, 2), facing: Math.PI,
  })),
  { id: 'garden-0', activity: 'garden', floor: 'ground', position: point(13.65, 0, -6.25), approach: point(13.65, 0, -4.5), facing: -Math.PI / 2 },
  { id: 'camp-0', activity: 'camp', floor: 'ground', position: point(12, 0, 6), approach: point(11.5, 0, 6.4), facing: Math.PI * 0.75 },
  { id: 'camp-1', activity: 'camp', floor: 'ground', position: point(14.6, 0, 6), approach: point(15, 0, 6.4), facing: -Math.PI * 0.75 },
  { id: 'read-0', activity: 'read', floor: 'ground', position: point(4.8, 0, -8.35), approach: point(4.8, 0, -7.7), facing: 0 },
  { id: 'read-1', activity: 'read', floor: 'ground', position: point(6, 0, -8.35), approach: point(6, 0, -7.7), facing: 0 },
]

export function obstacles(floor: Floor, desks: readonly Station[]): Bounds[] {
  if (floor === 'ground') return [
    POOL, STAIRS, SHAFT,
    { minX: 3.2, maxX: 7, minZ: -5.8, maxZ: -3.45 },
    { minX: 2.65, maxX: 6.8, minZ: 2.8, maxZ: 3.3 },
    { minX: 11.5, maxX: 13, minZ: -8.35, maxZ: -5.05 },
    { minX: 14.5, maxX: 16.1, minZ: -8.35, maxZ: -5.05 },
    { minX: 12.7, maxX: 13.9, minZ: 4.7, maxZ: 5.65 },
    { minX: 15.65, maxX: 17.15, minZ: 4.15, maxZ: 6.7 },
    { minX: 3.6, maxX: 6.9, minZ: -9.6, maxZ: -8.65 },
    { minX: 10.1, maxX: 11.1, minZ: 4.6, maxZ: 5.5 },
    { minX: 12.85, maxX: 13.4, minZ: -2.35, maxZ: -1.7 },
    { minX: 10.35, maxX: 10.5, minZ: -2.5, maxZ: 3.4 },
    { minX: 16.5, maxX: 16.65, minZ: -2.5, maxZ: 3.4 },
    { minX: 10.35, maxX: 16.65, minZ: -2.5, maxZ: -2.35 },
    { minX: 10.35, maxX: 11.6, minZ: 3.25, maxZ: 3.4 },
    { minX: 14.9, maxX: 16.65, minZ: 3.25, maxZ: 3.4 },
    { minX: 11.05, maxX: 11.18, minZ: -8.9, maxZ: -4.2 },
    { minX: 16.4, maxX: 16.55, minZ: -8.9, maxZ: -4.2 },
    { minX: 11.05, maxX: 16.55, minZ: -8.9, maxZ: -8.75 },
    { minX: -8.6, maxX: 0.1, minZ: -9.95, maxZ: -9.3 },
    { minX: 1.3, maxX: 1.7, minZ: -9.1, maxZ: -8.7 },
    { minX: 7.7, maxX: 8.1, minZ: -9.3, maxZ: -8.9 },
    ...TREES.map(tree => ({ minX: tree.x - 0.19, maxX: tree.x + 0.19, minZ: tree.z - 0.19, maxZ: tree.z + 0.19 })),
    ...desks.map(({ position: p }) => ({ minX: p.x - 1.03, maxX: p.x + 1.03, minZ: p.z - 1.2, maxZ: p.z - 0.4 })),
    ...desks.map(({ position: p }) => ({ minX: p.x - 0.34, maxX: p.x + 0.34, minZ: p.z - 0.28, maxZ: p.z + 0.38 })),
  ]
  if (floor === 'terrace') return [SHAFT, ...[4, 6].map(x => ({ minX: x - 0.65, maxX: x + 0.65, minZ: -5.35, maxZ: -3.4 }))]
  return []
}

export function inset(bounds: Bounds, amount: number): Bounds {
  return { minX: bounds.minX + amount, maxX: bounds.maxX - amount, minZ: bounds.minZ + amount, maxZ: bounds.maxZ - amount }
}

export function surfaces(floor: Floor): Bounds[] {
  if (floor === 'ground') return [inset(LAND, WALK_RADIUS), inset(PIER, WALK_RADIUS)]
  if (floor === 'terrace') return [inset(TERRACE, WALK_RADIUS)]
  if (floor === 'pool') return [inset(POOL, 0.55)]
  return [{ minX: 6.75, maxX: 11.5, minZ: 7.75, maxZ: 10.1 }]
}

export function stairHeight(z: number): number {
  const step = Math.max(0, Math.min(STAIR_COUNT, Math.ceil((-z - 0.5) / (5.5 / STAIR_COUNT))))
  return step * FLOOR_HEIGHT / STAIR_COUNT
}
