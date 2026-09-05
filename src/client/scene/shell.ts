/**
 * The box you are looking into: the floor, three walls, the ceiling, the two
 * windows in the back wall and the sky beyond them.
 *
 * The shell is built from boxes with thickness rather than from planes, so a
 * window is a hole in a wall you can see the reveal of, and so the walls and
 * the ceiling block the sun: the only daylight in the room comes through the
 * openings, which is what puts two bright patches on the floor and leaves the
 * rest of the room to the soft light.
 */
import { Group, Mesh, MeshBasicMaterial } from 'three'
import { ROOM } from '../stagecraft.ts'
import { box, named, plane, rounded, toShell, type Shop } from './kit.ts'
import { paintFloor, paintSky, paintWainscot } from './textures.ts'

/** Where the two windows hang, across the floor plan (0–100), so a member can wander over to one. */
export const WINDOWS: readonly number[] = [36.5, 65]

/** The shape of one window opening, in world units. */
export const WINDOW = {
  width: 1.4,
  height: 1.1,
  /** How high the sill sits above the floor. */
  sill: 0.72,
} as const

/** How thick the walls are, which is how deep the window reveals go. */
export const WALL_THICKNESS = 0.24

/** The world x of a place across the floor plan. */
export function acrossOf(planX: number): number {
  return ((planX - 50) / 100) * ROOM.width
}

/** The plane of the back wall's inner face. */
export const BACK = -ROOM.depth / 2

/** How far one floorboard tile of the texture covers, in world units. */
const FLOOR_TILE = 1.25

/**
 * The shell, standing on the origin: the floor is the plane y = 0 and the back
 * wall's inner face is z = BACK.
 * @param shop - where the materials come from.
 * @returns the shell, everything in it on the shell layer.
 */
export function buildShell(shop: Shop): Group {
  const p = shop.palette
  const group = named(new Group(), 'shell')
  const { width, depth, height } = ROOM
  const t = WALL_THICKNESS

  // The floor: boards running across the room.
  const floorMap = shop.texture(512, 512, paintFloor(p), [width / FLOOR_TILE, depth / FLOOR_TILE])
  const floor = box(width + t * 2, 0.12, depth + t, shop.matte(p.floor, { map: floorMap, roughness: 0.8 }), { y: -0.06, z: -t / 2 }, { cast: false, receive: true })
  floor.name = 'floor'
  group.add(floor)

  // The ceiling, closing the box over your head; it keeps the sun out.
  group.add(named(box(width + t * 2, 0.12, depth + t, shop.matte(p.ceiling, { roughness: 0.95 }), { y: height + 0.06, z: -t / 2 }), 'ceiling'))

  // The side walls, each as one slab.
  const wallPaint = shop.matte(p.wall, { roughness: 0.94 })
  group.add(named(box(t, height, depth + t, wallPaint, { x: -width / 2 - t / 2, y: height / 2, z: -t / 2 }), 'wall:left'))
  group.add(named(box(t, height, depth + t, wallPaint, { x: width / 2 + t / 2, y: height / 2, z: -t / 2 }), 'wall:right'))

  // The back wall, in pieces around the two window openings.
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
  group.add(back)

  // The wainscot and the skirting, carried around all three walls.
  const wainscotMap = shop.texture(256, 256, paintWainscot(p), [width / 1.1, 1])
  const wainscotHeight = 0.92
  const wainscotPaint = shop.matte(p.wainscot, { map: wainscotMap, roughness: 0.85 })
  group.add(box(width, wainscotHeight, 0.03, wainscotPaint, { y: wainscotHeight / 2, z: BACK + 0.015 }, { cast: false }))
  const sideWainscot = shop.texture(256, 256, paintWainscot(p), [depth / 1.1, 1])
  const sidePaint = shop.matte(p.wainscot, { map: sideWainscot, roughness: 0.85 })
  group.add(box(0.03, wainscotHeight, depth, sidePaint, { x: -width / 2 + 0.015, y: wainscotHeight / 2 }, { cast: false }))
  group.add(box(0.03, wainscotHeight, depth, sidePaint, { x: width / 2 - 0.015, y: wainscotHeight / 2 }, { cast: false }))
  const skirt = shop.matte(p.skirting, { roughness: 0.7 })
  group.add(box(width, 0.1, 0.05, skirt, { y: 0.05, z: BACK + 0.025 }, { cast: false }))
  group.add(box(0.05, 0.1, depth, skirt, { x: -width / 2 + 0.025, y: 0.05 }, { cast: false }))
  group.add(box(0.05, 0.1, depth, skirt, { x: width / 2 - 0.025, y: 0.05 }, { cast: false }))
  // A rail along the top of the wainscot.
  const rail = shop.matte(p.woodLight, { roughness: 0.7 })
  group.add(box(width, 0.04, 0.05, rail, { y: wainscotHeight + 0.02, z: BACK + 0.025 }, { cast: false }))
  group.add(box(0.05, 0.04, depth, rail, { x: -width / 2 + 0.025, y: wainscotHeight + 0.02 }, { cast: false }))
  group.add(box(0.05, 0.04, depth, rail, { x: width / 2 - 0.025, y: wainscotHeight + 0.02 }, { cast: false }))

  // The windows: frame, mullion, glass, sill and the world beyond.
  const skyMap = shop.texture(512, 512, paintSky(p))
  WINDOWS.forEach((at, index) => {
    group.add(window(shop, acrossOf(at), skyMap, index))
  })

  return toShell(group)
}

/** One window set into the back wall, and the sky behind it. */
function window(shop: Shop, x: number, skyMap: ReturnType<Shop['texture']>, index: number): Group {
  const p = shop.palette
  const group = named(new Group(), 'window')
  const t = WALL_THICKNESS
  const { width, height, sill } = WINDOW
  const centre = sill + height / 2
  const frame = shop.matte(p.plastic, { roughness: 0.5 })
  const bar = 0.05
  // The frame sits in the middle of the reveal.
  const frameZ = BACK + 0.035
  group.add(box(width + bar * 2, bar, 0.07, frame, { x, y: sill + height + bar / 2, z: frameZ }))
  group.add(box(width + bar * 2, bar, 0.07, frame, { x, y: sill - bar / 2, z: frameZ }))
  group.add(box(bar, height + bar * 2, 0.07, frame, { x: x - width / 2 - bar / 2, y: centre, z: frameZ }))
  group.add(box(bar, height + bar * 2, 0.07, frame, { x: x + width / 2 + bar / 2, y: centre, z: frameZ }))
  group.add(box(0.035, height, 0.05, frame, { x, y: centre, z: frameZ }))
  group.add(box(width, 0.035, 0.05, frame, { x, y: sill + height * 0.62, z: frameZ }))
  // The glass, barely there, and never in the sun's way.
  const glass = plane(width, height, shop.matte(p.glass, { transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0.2 }), { x, y: centre, z: frameZ + 0.005 }, { cast: false, receive: false })
  group.add(glass)
  // The sill: a ledge into the room, with its lip.
  group.add(box(width + 0.2, 0.05, t + 0.12, shop.matte(p.woodLight, { roughness: 0.6 }), { x, y: sill - 0.025, z: BACK + 0.06 }))
  // The head of the reveal, so the opening reads as cut through a thick wall.
  const reveal = shop.matte(p.paper, { roughness: 0.9 })
  group.add(box(width, 0.02, t, reveal, { x, y: sill + height - 0.01, z: BACK + 0.025 }, { cast: false }))
  group.add(box(0.02, height, t, reveal, { x: x - width / 2 + 0.01, y: centre, z: BACK + 0.025 }, { cast: false }))
  group.add(box(0.02, height, t, reveal, { x: x + width / 2 - 0.01, y: centre, z: BACK + 0.025 }, { cast: false }))
  // The world outside: a picture hung behind the opening, unlit, out of the sun's way.
  const sky = shop.flat(p.white, { map: skyMap === null ? null : index === 0 ? skyMap : mirrored(shop, skyMap) })
  // The backdrop sits on the inner face of the opening. Keeping it within the
  // reveal prevents the solid wall slab behind it from winning the depth test.
  const outside = plane(width, height, sky, { x, y: centre, z: BACK + 0.02 }, { cast: false, receive: false })
  outside.renderOrder = 20
  const outsideMaterial = outside.material
  if (outsideMaterial instanceof MeshBasicMaterial) outsideMaterial.depthTest = false
  outside.name = 'sky'
  group.add(outside)
  // A pair of curtain rails would be too much; a roller blind's bar is enough.
  group.add(rounded(width + 0.16, 0.06, 0.06, 0.03, shop.matte(p.paper, { roughness: 0.8 }), { x, y: sill + height + 0.1, z: BACK + 0.04 }))
  group.traverse(child => {
    if (child instanceof Mesh && child !== outside) child.renderOrder = 21
  })
  return group
}

/** The same sky, seen from the other window, so the two do not show one picture twice. */
function mirrored(shop: Shop, texture: NonNullable<ReturnType<Shop['texture']>>): NonNullable<ReturnType<Shop['texture']>> {
  const copy = texture.clone()
  copy.repeat.x = -1
  copy.offset.x = 1
  copy.needsUpdate = true
  shop.textures.add(copy)
  return copy
}

/** Whether an object is part of the shell, for tests. */
export function isShell(object: unknown): object is Mesh {
  return object instanceof Mesh && object.layers.mask === 1 << 2
}
