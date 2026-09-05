import { CircleGeometry, Group } from 'three'
import { ROOM } from '../stagecraft.ts'
import { batchMeshes } from './batching.ts'
import { plant, trailingPothos } from './flora.ts'
import { box, cylinder, lathe, named, piece, ring, rounded, sphere, toShell, type Shop } from './kit.ts'
import { acrossOf, BACK } from './shell.ts'
import { paintCalendar, paintClock, paintWhiteboard } from './textures.ts'

export const PENDANTS: readonly { readonly x: number, readonly z: number }[] = [
  { x: -2.75, z: 0.55 },
  { x: -0.35, z: 0.55 },
  { x: 2.95, z: -0.05 },
]

export const PENDANT_DROP = 0.98

export interface Fixtures {
  readonly group: Group
  readonly pendants: readonly Group[]
}

export function buildFixtures(shop: Shop): Fixtures {
  const group = named(new Group(), 'fixtures')
  group.add(calendar(shop, acrossOf(4)))
  group.add(whiteboard(shop, acrossOf(15.5)))
  group.add(hanger(shop, acrossOf(26)))
  group.add(shelf(shop, acrossOf(50)))
  group.add(clock(shop, acrossOf(79)))
  group.add(airConditioner(shop, acrossOf(89.5)))
  toShell(group)
  batchMeshes(group)
  const pendants = PENDANTS.map(at => pendant(shop, at.x, at.z))
  for (const lamp of pendants) group.add(lamp)
  return { group, pendants }
}

function calendar(shop: Shop, x: number): Group {
  const p = shop.palette
  const group = named(new Group(), 'calendar')
  const map = shop.texture(128, 160, paintCalendar(p))
  group.add(box(0.34, 0.44, 0.012, shop.matte(p.white, { map, roughness: 0.9 }), { x, y: 2.02, z: BACK + 0.006 }, { cast: false }))
  group.add(sphere(0.012, shop.matte(p.metalDark, { roughness: 0.4, metalness: 0.6 }), { x, y: 2.25, z: BACK + 0.012 }, { cast: false }))
  return group
}

function whiteboard(shop: Shop, x: number): Group {
  const p = shop.palette
  const group = named(new Group(), 'whiteboard')
  const width = 1.56
  const height = 0.98
  const y = 1.96
  const map = shop.texture(512, 320, paintWhiteboard(p))
  group.add(box(width, height, 0.02, shop.matte(p.white, { map, roughness: 0.4 }), { x, y, z: BACK + 0.02 }, { cast: false }))
  const frame = shop.matte(p.metal, { roughness: 0.45, metalness: 0.5 })
  group.add(box(width + 0.06, 0.03, 0.03, frame, { x, y: y + height / 2 + 0.015, z: BACK + 0.02 }, { cast: false }))
  group.add(box(width + 0.06, 0.03, 0.03, frame, { x, y: y - height / 2 - 0.015, z: BACK + 0.02 }, { cast: false }))
  group.add(box(0.03, height + 0.06, 0.03, frame, { x: x - width / 2 - 0.015, y, z: BACK + 0.02 }, { cast: false }))
  group.add(box(0.03, height + 0.06, 0.03, frame, { x: x + width / 2 + 0.015, y, z: BACK + 0.02 }, { cast: false }))
  const trayY = y - height / 2 - 0.05
  group.add(box(0.9, 0.02, 0.08, frame, { x, y: trayY, z: BACK + 0.05 }))
  group.add(box(0.9, 0.035, 0.012, frame, { x, y: trayY + 0.017, z: BACK + 0.084 }, { cast: false }))
  const markers = [p.hue, p.error, p.leaf]
  markers.forEach((color, index) => {
    group.add(cylinder(0.011, 0.011, 0.11, shop.matte(color, { roughness: 0.5 }), { x: x - 0.32 + index * 0.14, y: trayY + 0.02, z: BACK + 0.05, rz: Math.PI / 2 }, 10, { cast: false }))
  })
  group.add(rounded(0.1, 0.035, 0.045, 0.01, shop.matte(p.plasticDark, { roughness: 0.9 }), { x: x + 0.3, y: trayY + 0.028, z: BACK + 0.05 }, { cast: false }))
  return group
}

function hanger(shop: Shop, x: number): Group {
  const p = shop.palette
  const group = named(new Group(), 'hanger')
  const iron = shop.matte(p.metalDark, { roughness: 0.6, metalness: 0.4 })
  const armY = 2.52
  group.add(box(0.03, 0.34, 0.03, iron, { x, y: armY - 0.15, z: BACK + 0.015 }, { cast: false }))
  group.add(box(0.03, 0.03, 0.34, iron, { x, y: armY, z: BACK + 0.17 }, { cast: false }))
  group.add(box(0.03, 0.03, 0.22, iron, { x, y: armY - 0.11, z: BACK + 0.13, rx: -0.75 }, { cast: false }))
  const hook = BACK + 0.32
  const potTop = armY - 0.14
  for (let chain = 0; chain < 3; chain += 1) {
    const angle = (chain / 3) * Math.PI * 2 + 0.4
    group.add(cylinder(0.003, 0.003, 0.14, iron, { x: x + Math.cos(angle) * 0.05, y: armY - 0.07, z: hook + Math.sin(angle) * 0.05 }, 4, { cast: false }))
  }
  const pothos = trailingPothos(shop, 0.95)
  pothos.position.set(x, potTop - 0.18, hook)
  group.add(pothos)
  return group
}

function shelf(shop: Shop, x: number): Group {
  const p = shop.palette
  const group = named(new Group(), 'shelf')
  const y = 2.04
  const width = 1.2
  const depth = 0.24
  group.add(box(width, 0.035, depth, shop.matte(p.wood, { roughness: 0.7 }), { x, y, z: BACK + depth / 2 }))
  const iron = shop.matte(p.metalDark, { roughness: 0.6, metalness: 0.4 })
  for (const side of [-1, 1]) {
    group.add(box(0.025, 0.16, 0.025, iron, { x: x + side * 0.42, y: y - 0.1, z: BACK + 0.0125 }, { cast: false }))
    group.add(box(0.025, 0.025, 0.2, iron, { x: x + side * 0.42, y: y - 0.03, z: BACK + 0.1 }, { cast: false }))
  }
  const spines: readonly [number, number, import('three').Color][] = [
    [0.05, 0.29, p.accent(1)], [0.04, 0.27, p.woodDark], [0.045, 0.25, p.accent(3)], [0.035, 0.26, p.paper],
    [0.05, 0.23, p.cushionCool], [0.04, 0.24, p.accent(5)], [0.03, 0.21, p.accent(0)],
  ]
  let cursor = x - 0.54
  const top = y + 0.0175
  for (const [thickness, height, color] of spines) {
    group.add(box(thickness, height, 0.17, shop.matte(color, { roughness: 0.75 }), { x: cursor + thickness / 2, y: top + height / 2, z: BACK + 0.11 }))
    cursor += thickness + 0.004
  }
  group.add(box(0.035, 0.22, 0.16, shop.matte(p.accent(2), { roughness: 0.75 }), { x: cursor + 0.05, y: top + 0.105, z: BACK + 0.11, rz: -0.32 }))
  const gold = shop.matte(p.gold, { roughness: 0.3, metalness: 0.7 })
  const trophyX = x + 0.16
  group.add(cylinder(0.04, 0.05, 0.03, shop.matte(p.woodDark, { roughness: 0.6 }), { x: trophyX, y: top + 0.015, z: BACK + 0.12 }))
  group.add(cylinder(0.008, 0.012, 0.05, gold, { x: trophyX, y: top + 0.055, z: BACK + 0.12 }, 10))
  group.add(lathe([[0.012, 0], [0.03, 0.02], [0.045, 0.08], [0.048, 0.1], [0.04, 0.1], [0.036, 0.085], [0.02, 0.03]], gold, { x: trophyX, y: top + 0.08, z: BACK + 0.12 }, 18))
  for (const side of [-1, 1]) {
    group.add(ring(0.02, 0.005, gold, { x: trophyX + side * 0.05, y: top + 0.14, z: BACK + 0.12, rx: 0, ry: Math.PI / 2 }, { cast: false }))
  }
  const cactus = plant(shop, 'cactus', 0.42)
  cactus.position.set(x + 0.42, top, BACK + 0.12)
  group.add(cactus)
  return group
}

function clock(shop: Shop, x: number): Group {
  const p = shop.palette
  const group = named(new Group(), 'clock')
  const y = 2.38
  const iron = shop.matte(p.metalDark, { roughness: 0.5, metalness: 0.5 })
  group.add(cylinder(0.215, 0.215, 0.045, iron, { x, y, z: BACK + 0.0225, rx: Math.PI / 2 }, 36, { cast: false }))
  const face = shop.texture(256, 256, paintClock(p))
  group.add(piece(new CircleGeometry(0.2, 40), shop.matte(p.white, { map: face, roughness: 0.6 }), { x, y, z: BACK + 0.046 }, { cast: false, receive: false }))
  group.add(ring(0.205, 0.012, iron, { x, y, z: BACK + 0.046, rx: 0 }, { cast: false }))
  return group
}

function airConditioner(shop: Shop, x: number): Group {
  const p = shop.palette
  const group = named(new Group(), 'ac')
  const y = 2.8
  group.add(rounded(0.92, 0.3, 0.22, 0.05, shop.matte(p.plastic, { roughness: 0.5 }), { x, y, z: BACK + 0.11 }))
  group.add(box(0.84, 0.045, 0.02, shop.matte(p.plasticDark, { roughness: 0.9 }), { x, y: y - 0.09, z: BACK + 0.22 }, { cast: false }))
  group.add(box(0.84, 0.018, 0.07, shop.matte(p.plastic, { roughness: 0.5 }), { x, y: y - 0.135, z: BACK + 0.2, rx: 0.55 }, { cast: false }))
  group.add(box(0.12, 0.03, 0.005, shop.matte(p.screenBezel, { emissive: p.hue, emissiveIntensity: 0.9 }), { x: x + 0.34, y: y + 0.02, z: BACK + 0.222 }, { cast: false }))
  group.add(sphere(0.008, shop.matte(p.leaf, { emissive: p.leaf, emissiveIntensity: 1.2 }), { x: x + 0.42, y: y - 0.04, z: BACK + 0.222 }, { cast: false }))
  return group
}

function pendant(shop: Shop, x: number, z: number): Group {
  const p = shop.palette
  const group = named(new Group(), 'pendant')
  group.position.set(x, ROOM.height, z)
  const iron = shop.matte(p.metalDark, { roughness: 0.5, metalness: 0.5 })
  group.add(cylinder(0.05, 0.05, 0.02, iron, { y: -0.01 }, 16, { cast: false }))
  group.add(cylinder(0.006, 0.006, PENDANT_DROP - 0.2, iron, { y: -(PENDANT_DROP - 0.2) / 2 }, 6, { cast: false }))
  const shade = lathe([[0.24, 0], [0.22, 0.01], [0.16, 0.12], [0.07, 0.22], [0.04, 0.26], [0.02, 0.27]], shop.matte(p.shade, { roughness: 0.7, doubleSide: true }), { y: -PENDANT_DROP - 0.02 }, 28, { cast: false })
  shade.name = 'shade'
  group.add(shade)
  const bulb = sphere(0.045, shop.matte(p.bulb, { emissive: p.bulb, emissiveIntensity: p.dark ? 1.2 : 0.15, roughness: 0.3 }), { y: -PENDANT_DROP + 0.05 }, { cast: false, receive: false })
  bulb.name = 'bulb'
  group.add(bulb)
  return group
}
