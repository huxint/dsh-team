import { Group } from 'three'
import { ROOM } from '../stagecraft.ts'
import { box, named, plane, rounded, toShell, type Shop } from './kit.ts'
import { paintFloor, paintSky, paintWainscot } from './textures.ts'

export const WINDOWS: readonly number[] = [36.5, 65]
export const WINDOW = { width: 1.58, height: 1.48, sill: 1.12 } as const
export const WALL_THICKNESS = 0.16
export const BACK = -ROOM.depth / 2
const RETURN_DEPTH = 1.25
const SIDE_HEIGHT = 0.55

export function acrossOf(planX: number): number {
  return ((planX - 50) / 100) * ROOM.width
}

export function buildShell(shop: Shop): Group {
  const p = shop.palette
  const group = named(new Group(), 'shell')
  const { width, depth, height } = ROOM
  const t = WALL_THICKNESS
  group.add(shop.contact(width + 2.8, depth + 2.8, { y: -0.29 }))
  const floorMap = shop.texture(512, 512, paintFloor(p), [width / 2.6, depth / 2.6])
  group.add(named(rounded(width + t * 2 + 0.12, 0.22, depth + t + 0.12, 0.07,
    shop.matte(p.woodLight), { y: -0.16, z: -t / 2 }, { cast: true }), 'plinth'))
  group.add(named(box(width + t * 2, 0.08, depth + t, shop.matte(p.white, { map: floorMap, roughness: 0.88 }),
    { y: -0.04, z: -t / 2 }, { cast: false }), 'floor'))

  const wallPaint = shop.matte(p.wall, { roughness: 1 })
  const trim = shop.matte(p.skirting, { roughness: 0.75 })
  for (const side of [-1, 1]) {
    const x = side * (width / 2 + t / 2)
    const wall = named(new Group(), `wall:${side < 0 ? 'left' : 'right'}`)
    wall.add(box(t, height, RETURN_DEPTH + t, wallPaint, { x, y: height / 2, z: BACK + (RETURN_DEPTH - t) / 2 }))
    wall.add(rounded(t, SIDE_HEIGHT, depth - RETURN_DEPTH, 0.025, wallPaint,
      { x, y: SIDE_HEIGHT / 2, z: RETURN_DEPTH / 2 }))
    wall.add(rounded(t + 0.025, 0.045, depth - RETURN_DEPTH + 0.025, 0.014, trim,
      { x, y: SIDE_HEIGHT + 0.018, z: RETURN_DEPTH / 2 }, { cast: false }))
    wall.add(box(t + 0.025, 0.06, RETURN_DEPTH + t, trim,
      { x, y: height + 0.01, z: BACK + (RETURN_DEPTH - t) / 2 }, { cast: false }))
    group.add(wall)
  }

  const back = named(new Group(), 'wall:back')
  const backPaint = shop.matte(p.wallBack, { roughness: 0.94 })
  const wallZ = BACK - t / 2
  const head = WINDOW.sill + WINDOW.height
  back.add(box(width + t * 2, WINDOW.sill, t, backPaint, { y: WINDOW.sill / 2, z: wallZ }))
  back.add(box(width + t * 2, height - head, t, backPaint, { y: head + (height - head) / 2, z: wallZ }))
  const edges = [-width / 2 - t, ...WINDOWS.flatMap(at => [acrossOf(at) - WINDOW.width / 2, acrossOf(at) + WINDOW.width / 2]), width / 2 + t]
  for (let index = 0; index < edges.length; index += 2) {
    const left = edges[index]!
    const right = edges[index + 1]!
    back.add(box(right - left, WINDOW.height, t, backPaint, { x: (left + right) / 2, y: WINDOW.sill + WINDOW.height / 2, z: wallZ }))
  }
  back.add(box(width + t * 2 + 0.025, 0.06, t + 0.025, trim, { y: height + 0.01, z: wallZ }, { cast: false }))
  group.add(back)

  const panels = shop.texture(256, 256, paintWainscot(p), [width / 1.6, 1])
  const panelPaint = shop.matte(p.white, { map: panels, roughness: 0.92 })
  group.add(box(width, 0.78, 0.03, panelPaint, { y: 0.39, z: BACK + 0.015 }, { cast: false }))
  group.add(box(width, 0.04, 0.055, trim, { y: 0.8, z: BACK + 0.027 }, { cast: false }))
  group.add(box(width, 0.08, 0.04, trim, { y: 0.04, z: BACK + 0.02 }, { cast: false }))
  for (const side of [-1, 1]) {
    group.add(box(0.04, 0.08, depth, trim, { x: side * (width / 2 - 0.02), y: 0.04 }, { cast: false }))
  }

  const skyMap = shop.texture(512, 512, paintSky(p))
  WINDOWS.forEach((at, index) => { group.add(buildWindow(shop, acrossOf(at), skyMap, index)) })
  return toShell(group)
}

function buildWindow(shop: Shop, x: number, skyMap: ReturnType<Shop['texture']>, index: number): Group {
  const p = shop.palette
  const group = named(new Group(), 'window')
  const { width, height, sill } = WINDOW
  const centre = sill + height / 2
  const frame = shop.matte(p.plastic, { roughness: 0.65 })
  const frameZ = BACK + 0.025
  const bar = 0.055
  for (const side of [-1, 1]) {
    group.add(box(width + bar * 2, bar, 0.12, frame, { x, y: centre + side * (height + bar) / 2, z: frameZ }))
    group.add(box(bar, height, 0.12, frame, { x: x + side * (width + bar) / 2, y: centre, z: frameZ }))
    group.add(box(0.025, height, WALL_THICKNESS, frame, { x: x + side * (width / 2 - 0.0125), y: centre, z: BACK - WALL_THICKNESS / 2 }, { cast: false }))
  }
  group.add(box(0.04, height, 0.075, frame, { x, y: centre, z: frameZ }))
  group.add(box(width, 0.04, 0.075, frame, { x, y: sill + height * 0.45, z: frameZ }))
  group.add(rounded(width + 0.24, 0.055, 0.32, 0.018, shop.matte(p.woodLight), { x, y: sill - 0.04, z: BACK + 0.075 }))

  let map = skyMap
  if (map !== null && index > 0) {
    map = map.clone()
    map.repeat.x = -1
    map.offset.x = 1
    map.needsUpdate = true
    shop.textures.add(map)
  }
  // Keeping the sky behind the opening lets frames, furniture, and crew occlude it normally.
  group.add(named(plane(width, height, shop.flat(p.white, { map }), { x, y: centre, z: BACK - WALL_THICKNESS + 0.005 }, { cast: false, receive: false }), 'sky'))
  group.add(rounded(width + 0.18, 0.085, 0.09, 0.035, shop.matte(p.paper), { x, y: sill + height + 0.14, z: BACK + 0.06 }))
  group.add(box(width, 0.17, 0.01, shop.matte(p.paper), { x, y: sill + height - 0.015, z: BACK + 0.065 }, { cast: false }))
  group.add(box(0.008, 0.48, 0.008, shop.matte(p.woodDark), { x: x + width / 2 + 0.1, y: sill + height - 0.15, z: BACK + 0.075 }, { cast: false }))
  return group
}
