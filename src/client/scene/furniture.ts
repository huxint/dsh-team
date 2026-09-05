/**
 * The standing furniture: the break corner, the service wall and the treadmill.
 *
 * Every piece is placed by its OWN plan rectangle — the same rectangle a walk
 * goes around — so the furniture it is drawn as and the furniture it is walked
 * around as are the same furniture, and nothing can creep off the floor.
 */
import { Group, Vector3 } from 'three'
import { BLOCKS, type Rect } from '../room.ts'
import { ROOM } from '../stagecraft.ts'
import { plant } from './flora.ts'
import { box, capsule, cylinder, lathe, named, plane, ring, rounded, sphere, type Shop } from './kit.ts'
import { paintConsole, paintPaper, paintRug } from './textures.ts'

/** Where one plan rectangle lands in the world: its centre on the floor, and its size. */
export function spotOf(rect: Rect): { readonly x: number, readonly z: number, readonly w: number, readonly d: number } {
  return {
    x: ((rect.x + rect.w / 2 - 50) / 100) * ROOM.width,
    z: ((rect.y + rect.h / 2 - 50) / 100) * ROOM.depth,
    w: (rect.w / 100) * ROOM.width,
    d: (rect.h / 100) * ROOM.depth,
  }
}

/** The rug is furniture nobody walks around, so it has a rectangle of its own. */
export const RUG: Rect = { x: 70, y: 39.5, w: 22.5, h: 20 }

/** Where the floor lamp's bulb is, for the evening light. */
export function lampBulb(): Vector3 {
  const at = spotOf(BLOCKS.lamp)
  return new Vector3(at.x, 1.42, at.z)
}

/** The break corner: the rug, the sofa, the low table, the lamp, the plant and the cooler. */
export function buildLounge(shop: Shop): Group {
  const group = named(new Group(), 'lounge')
  group.add(rug(shop))
  group.add(sofa(shop))
  group.add(table(shop))
  group.add(lamp(shop))
  const big = plant(shop, 'monstera', 1.3)
  const at = spotOf(BLOCKS.plant)
  big.position.set(at.x, 0, at.z)
  big.name = 'plant'
  group.add(big)
  group.add(cooler(shop))
  return group
}

/** The mat the sofa and the table stand on. */
function rug(shop: Shop): Group {
  const p = shop.palette
  const at = spotOf(RUG)
  const group = named(new Group(), 'rug')
  const map = shop.texture(512, 384, paintRug(p))
  group.add(rounded(at.w, 0.02, at.d, 0.01, shop.matte(p.rug, { map, roughness: 1 }), { x: at.x, y: 0.01, z: at.z }, { cast: false }))
  return group
}

/** A two-seater with deep cushions, rounded arms and tapered legs. */
function sofa(shop: Shop): Group {
  const p = shop.palette
  const at = spotOf(BLOCKS.sofa)
  const group = named(new Group(), 'sofa')
  group.position.set(at.x, 0, at.z)
  const width = at.w
  const depth = 0.66
  const fabric = shop.matte(p.fabric, { roughness: 1 })
  const dark = shop.matte(p.fabricDark, { roughness: 1 })
  const legs = shop.matte(p.woodDark, { roughness: 0.6 })
  group.add(rounded(width, 0.26, depth, 0.05, dark, { y: 0.1 + 0.13 }))
  const cushion = (width - 0.34) / 2
  for (const side of [-1, 1]) {
    group.add(rounded(cushion - 0.02, 0.14, depth - 0.18, 0.05, fabric, { x: side * (cushion / 2 + 0.005), y: 0.36 + 0.07, z: 0.06 }))
  }
  group.add(rounded(width - 0.3, 0.5, 0.18, 0.06, fabric, { y: 0.36 + 0.25, z: -depth / 2 + 0.11 }))
  for (const side of [-1, 1]) {
    group.add(rounded(0.16, 0.36, depth, 0.06, dark, { x: side * (width / 2 - 0.08), y: 0.36 + 0.18 }))
  }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    group.add(cylinder(0.02, 0.028, 0.1, legs, { x: x * (width / 2 - 0.1), y: 0.05, z: z * (depth / 2 - 0.08) }, 10))
  }
  // Two throw pillows, leaning on the back.
  group.add(rounded(0.3, 0.3, 0.1, 0.06, shop.matte(p.cushionWarm, { roughness: 1 }), { x: -width / 2 + 0.36, y: 0.6, z: -depth / 2 + 0.28, rz: 0.1, rx: -0.2 }))
  group.add(rounded(0.28, 0.28, 0.1, 0.06, shop.matte(p.cushionCool, { roughness: 1 }), { x: width / 2 - 0.34, y: 0.59, z: -depth / 2 + 0.28, rz: -0.14, rx: -0.2 }))
  return group
}

/** The low table in front of the sofa, with a magazine and a cup left on it. */
function table(shop: Shop): Group {
  const p = shop.palette
  const at = spotOf(BLOCKS.table)
  const group = named(new Group(), 'table')
  group.position.set(at.x, 0, at.z)
  const width = at.w
  const depth = 0.46
  const height = 0.4
  group.add(rounded(width, 0.04, depth, 0.02, shop.matte(p.wood, { roughness: 0.6 }), { y: height - 0.02 }))
  const legs = shop.matte(p.woodDark, { roughness: 0.6 })
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    group.add(cylinder(0.016, 0.024, height - 0.04, legs, { x: x * (width / 2 - 0.08), y: (height - 0.04) / 2, z: z * (depth / 2 - 0.07), rz: x * 0.06, rx: -z * 0.06 }, 10))
  }
  const paper = shop.texture(128, 160, paintPaper(p))
  group.add(box(0.2, 0.008, 0.27, shop.matte(p.accent(4), { roughness: 0.6 }), { x: -width * 0.2, y: height + 0.004, z: 0.02, ry: 0.25 }, { cast: false }))
  group.add(box(0.17, 0.004, 0.23, shop.matte(p.paper, { map: paper, roughness: 0.9 }), { x: -width * 0.2 + 0.03, y: height + 0.01, z: 0.03, ry: 0.1 }, { cast: false }))
  const china = shop.matte(p.white, { roughness: 0.3 })
  group.add(cylinder(0.05, 0.05, 0.006, china, { x: width * 0.22, y: height + 0.003, z: 0.04 }, 20, { cast: false }))
  group.add(lathe([[0.025, 0], [0.034, 0.004], [0.038, 0.06], [0.034, 0.064], [0.028, 0.064], [0.025, 0.01]], china, { x: width * 0.22, y: height + 0.006, z: 0.04 }, 18))
  group.add(ring(0.016, 0.005, china, { x: width * 0.22 + 0.045, y: height + 0.038, z: 0.04, rx: 0, ry: Math.PI / 2 }, { cast: false }))
  return group
}

/** A floor lamp at the corner's edge. */
function lamp(shop: Shop): Group {
  const p = shop.palette
  const at = spotOf(BLOCKS.lamp)
  const group = named(new Group(), 'lamp')
  group.position.set(at.x, 0, at.z)
  const iron = shop.matte(p.metalDark, { roughness: 0.5, metalness: 0.5 })
  group.add(cylinder(0.13, 0.15, 0.025, iron, { y: 0.0125 }, 24))
  group.add(cylinder(0.014, 0.014, 1.3, iron, { y: 0.65 }, 10))
  const shade = lathe([[0.17, 0], [0.165, 0.01], [0.12, 0.3], [0.11, 0.31]], shop.matte(p.shade, { roughness: 0.8, doubleSide: true }), { y: 1.28 }, 28, { cast: false })
  group.add(shade)
  group.add(ring(0.11, 0.006, iron, { y: 1.59 }, { cast: false }))
  const bulb = sphere(0.04, shop.matte(p.bulb, { emissive: p.bulb, emissiveIntensity: 0.4, roughness: 0.3 }), { y: 1.42 }, { cast: false, receive: false })
  bulb.name = 'bulb'
  group.add(bulb)
  return group
}

/** The water cooler against the right wall: a cabinet with a jug on top. */
function cooler(shop: Shop): Group {
  const p = shop.palette
  const at = spotOf(BLOCKS.cooler)
  const group = named(new Group(), 'cooler')
  group.position.set(at.x, 0, at.z)
  const cabinetHeight = 0.96
  group.add(rounded(0.4, cabinetHeight, 0.4, 0.03, shop.matte(p.plastic, { roughness: 0.5 }), { y: cabinetHeight / 2 }))
  group.add(box(0.3, 0.26, 0.02, shop.matte(p.plasticDark, { roughness: 0.9 }), { y: 0.66, z: 0.19 }, { cast: false }))
  const iron = shop.matte(p.metal, { roughness: 0.4, metalness: 0.6 })
  for (const [x, color] of [[-0.07, p.error], [0.07, p.hue]] as const) {
    group.add(cylinder(0.012, 0.012, 0.06, iron, { x, y: 0.72, z: 0.2, rx: Math.PI / 2 }, 10, { cast: false }))
    group.add(cylinder(0.02, 0.02, 0.02, shop.matte(color, { roughness: 0.5 }), { x, y: 0.77, z: 0.22 }, 12, { cast: false }))
  }
  group.add(box(0.26, 0.02, 0.1, shop.matte(p.plasticDark, { roughness: 0.9 }), { y: 0.55, z: 0.17 }, { cast: false }))
  group.add(sphere(0.007, shop.matte(p.leaf, { emissive: p.leaf, emissiveIntensity: 1.2 }), { x: -0.14, y: 0.9, z: 0.2 }, { cast: false }))
  // The jug: a shell of glass, and the water standing in it.
  const glass = shop.matte(p.glass, { transparent: true, opacity: 0.35, roughness: 0.15, metalness: 0.1 })
  group.add(lathe([[0.1, 0], [0.16, 0.05], [0.18, 0.25], [0.16, 0.42], [0.08, 0.5], [0.05, 0.52], [0.05, 0.56]], glass, { y: cabinetHeight }, 24, { cast: false }))
  group.add(lathe([[0.09, 0], [0.15, 0.05], [0.17, 0.24], [0.15, 0.36], [0, 0.36]], shop.matte(p.hue, { transparent: true, opacity: 0.55, roughness: 0.2 }), { y: cabinetHeight + 0.005 }, 24, { cast: false }))
  group.add(cylinder(0.055, 0.055, 0.03, shop.matte(p.hue, { roughness: 0.5 }), { y: cabinetHeight + 0.57 }, 16, { cast: false }))
  return group
}

/** The filing cabinet, the printer and the coffee machine along the left wall. */
export function buildUtility(shop: Shop): Group {
  const p = shop.palette
  const at = spotOf(BLOCKS.utility)
  const group = named(new Group(), 'utility')
  const wallX = -ROOM.width / 2
  // The cabinet, at the back of the run.
  const cabinet = named(new Group(), 'cabinet')
  cabinet.position.set(wallX + 0.29, 0, at.z - at.d / 2 + 0.3)
  const steel = shop.matte(p.metal, { roughness: 0.5, metalness: 0.3 })
  cabinet.add(rounded(0.5, 1.08, 0.56, 0.015, steel, { y: 0.54 }))
  for (let drawer = 0; drawer < 3; drawer += 1) {
    const y = 0.2 + drawer * 0.33
    cabinet.add(box(0.44, 0.29, 0.015, shop.matte(p.plastic, { roughness: 0.5 }), { y, z: 0.285 }, { cast: false }))
    cabinet.add(box(0.12, 0.02, 0.02, shop.matte(p.metalDark, { roughness: 0.4, metalness: 0.5 }), { y: y + 0.09, z: 0.3 }, { cast: false }))
    cabinet.add(box(0.07, 0.03, 0.005, shop.matte(p.paper, { roughness: 0.9 }), { x: -0.14, y: y + 0.09, z: 0.294 }, { cast: false }))
  }
  cabinet.add(box(0.3, 0.06, 0.22, shop.matte(p.accent(4), { roughness: 0.8 }), { x: 0.05, y: 1.11, z: 0.05, ry: 0.15 }))
  group.add(cabinet)
  // The printer on its stand.
  const printer = named(new Group(), 'printer')
  printer.position.set(wallX + 0.3, 0, at.z + 0.02)
  printer.add(box(0.52, 0.68, 0.5, shop.matte(p.wood, { roughness: 0.7 }), { y: 0.34 }))
  printer.add(box(0.46, 0.02, 0.44, shop.matte(p.woodDark, { roughness: 0.7 }), { y: 0.36, z: 0.02 }, { cast: false }))
  printer.add(rounded(0.46, 0.2, 0.42, 0.03, shop.matte(p.plastic, { roughness: 0.5 }), { y: 0.78 }))
  printer.add(rounded(0.4, 0.03, 0.34, 0.01, shop.matte(p.plasticDark, { roughness: 0.9 }), { y: 0.895, z: -0.02 }, { cast: false }))
  const sheet = shop.texture(128, 160, paintPaper(p))
  printer.add(box(0.26, 0.006, 0.2, shop.matte(p.paper, { map: sheet, roughness: 0.9 }), { y: 0.72, z: 0.27, rx: 0.12 }, { cast: false }))
  printer.add(box(0.12, 0.02, 0.004, shop.matte(p.screenBezel, { emissive: p.hue, emissiveIntensity: 0.8 }), { x: 0.12, y: 0.84, z: 0.212 }, { cast: false }))
  group.add(printer)
  // The coffee machine on its counter, at the front of the run.
  const coffee = named(new Group(), 'coffee')
  coffee.position.set(wallX + 0.29, 0, at.z + at.d / 2 - 0.28)
  coffee.add(box(0.5, 0.86, 0.5, shop.matte(p.woodLight, { roughness: 0.7 }), { y: 0.43 }))
  coffee.add(box(0.5, 0.03, 0.52, shop.matte(p.plastic, { roughness: 0.4 }), { y: 0.875, z: 0.01 }, { cast: false }))
  const body = shop.matte(p.metalDark, { roughness: 0.4, metalness: 0.4 })
  coffee.add(rounded(0.3, 0.4, 0.3, 0.02, body, { x: -0.06, y: 0.89 + 0.2, z: -0.06 }))
  coffee.add(box(0.26, 0.05, 0.28, body, { x: -0.06, y: 0.915, z: 0.06 }, { cast: false }))
  const carafe = shop.matte(p.glass, { transparent: true, opacity: 0.35, roughness: 0.15 })
  coffee.add(lathe([[0.06, 0], [0.07, 0.02], [0.065, 0.13], [0.05, 0.16]], carafe, { x: -0.06, y: 0.94, z: 0.06 }, 18, { cast: false }))
  coffee.add(lathe([[0.058, 0], [0.068, 0.02], [0.064, 0.08], [0, 0.08]], shop.matte(p.soil, { roughness: 0.4 }), { x: -0.06, y: 0.945, z: 0.06 }, 18, { cast: false }))
  coffee.add(sphere(0.008, shop.matte(p.warm, { emissive: p.warm, emissiveIntensity: 1.3 }), { x: 0.02, y: 1.2, z: 0.092 }, { cast: false }))
  const mugs = [p.accent(2), p.accent(6), p.white]
  mugs.forEach((color, index) => {
    coffee.add(lathe([[0.028, 0], [0.034, 0.004], [0.036, 0.075], [0.03, 0.078], [0.026, 0.01]], shop.matte(color, { roughness: 0.4 }), { x: 0.16, y: 0.89, z: -0.14 + index * 0.12 }, 14))
  })
  group.add(coffee)
  return group
}

/** The treadmill in the front-right corner, facing the back wall. */
export function buildTreadmill(shop: Shop): Group {
  const p = shop.palette
  const at = spotOf(BLOCKS.treadmill)
  const group = named(new Group(), 'treadmill')
  group.position.set(at.x, 0, at.z)
  const frame = shop.matte(p.metalDark, { roughness: 0.5, metalness: 0.4 })
  const deckLength = 1.5
  group.add(rounded(0.7, 0.12, deckLength, 0.04, frame, { y: 0.08 }))
  group.add(box(0.52, 0.012, deckLength - 0.34, shop.matte(p.plasticDark, { roughness: 1 }), { y: 0.146, z: 0.1 }, { cast: false }))
  group.add(rounded(0.7, 0.22, 0.34, 0.06, shop.matte(p.plastic, { roughness: 0.5 }), { y: 0.2, z: -deckLength / 2 + 0.2 }))
  for (const side of [-1, 1]) {
    group.add(cylinder(0.022, 0.022, 1.15, frame, { x: side * 0.3, y: 0.31 + 0.575, z: -deckLength / 2 + 0.12, rx: -0.12 }, 10))
    group.add(rounded(0.04, 0.04, 0.62, 0.015, frame, { x: side * 0.3, y: 1.0, z: -deckLength / 2 + 0.44 }))
  }
  group.add(rounded(0.62, 0.06, 0.28, 0.02, shop.matte(p.plastic, { roughness: 0.5 }), { y: 1.42, z: -deckLength / 2 + 0.1, rx: -0.5 }))
  const display = shop.texture(128, 64, paintConsole(p))
  group.add(plane(0.42, 0.16, shop.matte(p.screenBezel, { emissive: p.white, emissiveIntensity: 0.8, emissiveMap: display, roughness: 0.3 }), { y: 1.45, z: -deckLength / 2 + 0.16, rx: -0.5 }, { cast: false, receive: false }))
  group.add(box(0.03, 0.02, 0.012, shop.matte(p.error, { emissive: p.error, emissiveIntensity: 0.6 }), { x: 0.16, y: 1.395, z: -deckLength / 2 + 0.24, rx: -0.5 }, { cast: false }))
  group.add(capsule(0.03, 0.08, shop.matte(p.accent(3), { roughness: 0.4 }), { x: -0.2, y: 1.42, z: -deckLength / 2 + 0.28 }))
  return group
}
