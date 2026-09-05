/**
 * The room's greenery, grown from the kit.
 *
 * A plant used to be three overlapping gradients, which reads as a green cloud
 * in a pot. These are built the way the furniture is: a thrown pot with a
 * rolled rim, soil, and real leaves — flat cutouts hinged where they join the
 * stem, in three greens so the foliage has a lit side and a shaded one.
 *
 * Every kind shares the same pot and the same frame — the pot stands on the
 * origin, foliage grows up out of it — so a plant can be swapped for another
 * anywhere in the room without moving anything around it.
 */
import { Color, Group, Mesh, Shape } from 'three'
import { capsule, cutout, cylinder, lathe, leafShape, sphere, type Shop } from './kit.ts'
import { seeded } from './textures.ts'

/** The plants the room keeps, in the order places take them. */
export const PLANTS = ['monstera', 'sansevieria', 'pothos', 'cactus', 'ficus', 'palm'] as const

/** One kind of plant. */
export type PlantKind = typeof PLANTS[number]

/**
 * Which plant stands in the nth green spot of the room: stable, so the corner
 * you learned is the corner you come back to.
 * @param index - the spot's index.
 * @returns the kind that stands there.
 */
export function plantOf(index: number): PlantKind {
  return PLANTS[((index % PLANTS.length) + PLANTS.length) % PLANTS.length] ?? 'monstera'
}

/** The three greens a plant is painted in, lit to shaded. */
function greens(shop: Shop): readonly Color[] {
  return [shop.palette.leafLit, shop.palette.leaf, shop.palette.leafDark]
}

/**
 * A thrown pot: a tapered body, a rolled rim, soil inside and a saucer under.
 * @param shop - where the materials come from.
 * @param radius - the radius at the rim.
 * @param height - how tall it stands.
 * @returns the pot, standing on the origin.
 */
export function pot(shop: Shop, radius: number, height: number): Group {
  const group = new Group()
  const clay = shop.matte(shop.palette.pot, { roughness: 0.9 })
  const body = lathe([
    [radius * 0.66, 0],
    [radius * 0.72, height * 0.06],
    [radius * 0.92, height * 0.78],
    [radius, height * 0.92],
    [radius * 1.04, height],
    [radius * 0.9, height],
    [radius * 0.86, height * 0.9],
  ], clay, {}, 22)
  group.add(body)
  group.add(cylinder(radius * 0.86, radius * 0.86, height * 0.06, shop.matte(shop.palette.soil, { roughness: 1 }), { y: height * 0.9 }, 22, { cast: false }))
  group.add(cylinder(radius * 0.8, radius * 0.86, height * 0.05, clay, { y: height * 0.02 }, 22, { cast: false }))
  return group
}

/** A leaf on a stem: the stem stands from the soil, the leaf tilts off its top. */
function frond(shop: Shop, shape: Shape, color: Color, at: { x: number, z: number, stem: number, tilt: number, spin: number, roll?: number }): Group {
  const pivot = new Group()
  pivot.position.set(at.x, 0, at.z)
  pivot.rotation.y = at.spin
  if (at.stem > 0.02) {
    pivot.add(cylinder(0.006, 0.009, at.stem, shop.matte(shop.palette.leafDark), { y: at.stem / 2, rx: -at.tilt * 0.25 }, 6, { cast: false }))
  }
  const hinge = new Group()
  hinge.position.set(0, at.stem, 0)
  hinge.rotation.x = -at.tilt
  hinge.rotation.z = at.roll ?? 0
  const leaf = cutout(shape, shop.matte(color, { doubleSide: true, roughness: 0.7 }), {}, { cast: true, receive: false })
  hinge.add(leaf)
  pivot.add(hinge)
  return pivot
}

/**
 * One plant, standing on the origin.
 * @param shop - where the materials come from.
 * @param kind - which plant.
 * @param size - how tall it grows, as a multiple of a knee-high pot plant.
 * @returns the plant.
 */
export function plant(shop: Shop, kind: PlantKind, size = 1): Group {
  const group = new Group()
  group.name = `plant:${kind}`
  const random = seeded(PLANTS.indexOf(kind) * 97 + 13)
  const [lit, mid, dark] = greens(shop)
  const paint = (): Color => [lit!, mid!, dark!][Math.floor(random() * 3)]!
  switch (kind) {
    case 'monstera': {
      group.add(pot(shop, 0.16, 0.26))
      for (let index = 0; index < 7; index += 1) {
        const spin = (index / 7) * Math.PI * 2 + random() * 0.4
        group.add(frond(shop, leafShape(0.44 + random() * 0.14, 0.3 + random() * 0.08, 3), paint(), {
          x: Math.cos(spin) * 0.05, z: Math.sin(spin) * 0.05,
          stem: 0.26 + 0.12 + random() * 0.22, tilt: 0.5 + random() * 0.6, spin: -spin + Math.PI / 2,
        }))
      }
      break
    }
    case 'sansevieria': {
      group.add(pot(shop, 0.12, 0.24))
      for (let index = 0; index < 9; index += 1) {
        const spin = (index / 9) * Math.PI * 2 + random() * 0.3
        const radius = 0.02 + random() * 0.05
        group.add(frond(shop, leafShape(0.42 + random() * 0.32, 0.06 + random() * 0.03), paint(), {
          x: Math.cos(spin) * radius, z: Math.sin(spin) * radius,
          stem: 0.22, tilt: 0.08 + random() * 0.22, spin: -spin + Math.PI / 2, roll: (random() - 0.5) * 0.4,
        }))
      }
      break
    }
    case 'pothos': {
      group.add(pot(shop, 0.13, 0.2))
      // A tumble of hearts spilling over the rim on every side.
      for (let index = 0; index < 12; index += 1) {
        const spin = (index / 12) * Math.PI * 2 + random() * 0.3
        const out = 0.1 + random() * 0.12
        group.add(frond(shop, leafShape(0.11 + random() * 0.06, 0.1 + random() * 0.04), paint(), {
          x: Math.cos(spin) * out, z: Math.sin(spin) * out,
          stem: 0.2 - random() * 0.12, tilt: 1.2 + random() * 0.9, spin: -spin + Math.PI / 2,
        }))
      }
      break
    }
    case 'cactus': {
      group.add(pot(shop, 0.11, 0.2))
      const skin = shop.matte(mid!, { roughness: 0.8 })
      group.add(capsule(0.07, 0.28, skin, { y: 0.2 + 0.2 }))
      group.add(capsule(0.045, 0.1, skin, { x: 0.1, y: 0.42, rz: -0.5 }))
      group.add(capsule(0.045, 0.06, skin, { x: -0.095, y: 0.36, rz: 0.55 }))
      // Ribs, as darker lines up the body, and one bloom on top.
      const rib = shop.matte(dark!, { roughness: 0.8 })
      for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * Math.PI * 2
        group.add(cylinder(0.006, 0.006, 0.3, rib, { x: Math.cos(angle) * 0.068, y: 0.4, z: Math.sin(angle) * 0.068 }, 5, { cast: false }))
      }
      group.add(sphere(0.035, shop.matte(shop.palette.error, { roughness: 0.6 }), { y: 0.62 }))
      group.add(sphere(0.016, shop.matte(shop.palette.warm), { y: 0.645 }))
      break
    }
    case 'ficus': {
      group.add(pot(shop, 0.15, 0.26))
      const trunk = shop.matte(shop.palette.woodDark, { roughness: 0.95 })
      group.add(cylinder(0.02, 0.03, 0.5, trunk, { y: 0.5 }, 8))
      group.add(cylinder(0.014, 0.018, 0.3, trunk, { x: 0.06, y: 0.82, z: 0.02, rz: -0.35 }, 6))
      group.add(cylinder(0.014, 0.018, 0.26, trunk, { x: -0.05, y: 0.8, z: -0.03, rz: 0.4 }, 6))
      const heads: readonly [number, number, number, number][] = [
        [0, 0.98, 0, 0.2], [0.16, 0.9, 0.05, 0.15], [-0.14, 0.88, -0.06, 0.14], [0.02, 1.12, -0.02, 0.13], [-0.04, 0.82, 0.14, 0.11],
      ]
      for (const [x, y, z, radius] of heads) {
        group.add(sphere(radius, shop.matte(paint(), { roughness: 0.75 }), { x, y, z }))
      }
      break
    }
    case 'palm':
    default: {
      group.add(pot(shop, 0.15, 0.26))
      group.add(cylinder(0.025, 0.04, 0.42, shop.matte(shop.palette.pot, { roughness: 0.95 }), { y: 0.26 + 0.21 }, 8))
      for (let index = 0; index < 8; index += 1) {
        const spin = (index / 8) * Math.PI * 2 + random() * 0.3
        group.add(frond(shop, leafShape(0.5 + random() * 0.2, 0.12 + random() * 0.04, 5), paint(), {
          x: Math.cos(spin) * 0.02, z: Math.sin(spin) * 0.02,
          stem: 0.68 + random() * 0.08, tilt: 0.7 + random() * 0.7, spin: -spin + Math.PI / 2,
        }))
      }
      break
    }
  }
  group.scale.setScalar(size)
  return group
}

/**
 * A pothos trailing from a hanging pot: the vines fall past the pot and down
 * the wall, hearts hanging point-down the way a trailing leaf does.
 * @param shop - where the materials come from.
 * @param drop - how far the longest vine hangs below the pot.
 * @returns the plant, its pot's bottom on the origin.
 */
export function trailingPothos(shop: Shop, drop = 0.9): Group {
  const group = new Group()
  group.name = 'plant:pothos'
  const random = seeded(41)
  const [lit, mid, dark] = greens(shop)
  group.add(pot(shop, 0.12, 0.18))
  const vine = shop.matte(dark!, { roughness: 0.9 })
  for (let index = 0; index < 5; index += 1) {
    const length = drop * (0.45 + random() * 0.55)
    const spin = (index / 5) * Math.PI * 2 + random() * 0.5
    const x = Math.cos(spin) * 0.1
    const z = Math.sin(spin) * 0.06 + 0.04
    group.add(cylinder(0.004, 0.005, length, vine, { x, y: 0.16 - length / 2, z, rz: (random() - 0.5) * 0.2 }, 5, { cast: false }))
    const leaves = Math.max(2, Math.round(length / 0.11))
    for (let leaf = 0; leaf < leaves; leaf += 1) {
      const y = 0.16 - (leaf + 0.5) * (length / leaves)
      const hinge = new Group()
      hinge.position.set(x + (random() - 0.5) * 0.04, y, z + 0.02)
      hinge.rotation.set(Math.PI - 0.35 + random() * 0.7, (random() - 0.5) * 1.2, 0)
      hinge.add(cutout(leafShape(0.1 + random() * 0.05, 0.09 + random() * 0.03), shop.matte([lit!, mid!, dark!][leaf % 3]!, { doubleSide: true, roughness: 0.7 }), {}, { cast: true, receive: false }))
      group.add(hinge)
    }
  }
  return group
}

/** Whether an object is a leaf, for tests that count the greenery. */
export function isLeaf(object: unknown): object is Mesh {
  return object instanceof Mesh && object.geometry.type === 'ShapeGeometry'
}
