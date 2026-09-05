/**
 * How the room is lit.
 *
 * By day the only daylight is the sun through the two windows: the walls and
 * the ceiling are solid, so it lands as two bright patches on the floor with
 * dust turning in the shafts above them, and the rest of the room is carried
 * by a soft sky light and a gentle fill from the viewer's side. In the evening
 * the sun is gone: the pendants and the floor lamp are lit, the screens glow,
 * and what comes through the windows is moonlight.
 */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, PointLight, Vector3,
} from 'three'
import { ROOM } from '../stagecraft.ts'
import { PENDANT_DROP, PENDANTS } from './fixtures.ts'
import { lampBulb } from './furniture.ts'
import { FURNITURE_LAYER, named, SHELL_LAYER, type Shop } from './kit.ts'
import { mix } from './palette.ts'
import { acrossOf, BACK, WINDOW, WINDOWS } from './shell.ts'
import { paintShaft } from './textures.ts'

/** Which way the sun travels: in through the back wall, down, and a little to the right. */
export const SUN = new Vector3(0.26, -0.74, 0.62).normalize()

/** The lights, and the shafts they draw in the air. */
export interface Rig {
  readonly group: Group
  /** The light that casts the room's shadows: the sun by day, the moon by night. */
  readonly key: DirectionalLight
}

/**
 * The rig for one theme.
 * @param shop - where the shaft material comes from.
 * @returns the lights, all of them on every layer so both passes see them.
 */
export function buildLights(shop: Shop): Rig {
  const p = shop.palette
  const group = named(new Group(), 'lights')
  const dark = p.dark

  const sky = new HemisphereLight(mix(p.page, p.hue, 0.35), p.floor, dark ? 0.55 : 1.15)
  sky.position.set(0, ROOM.height, 0)
  group.add(sky)

  const key = new DirectionalLight(p.sun, dark ? 0.9 : 3.4)
  key.position.copy(SUN).multiplyScalar(-22).add(new Vector3(0, 1.2, -1))
  key.target.position.set(0, 1.2, -1)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -8
  key.shadow.camera.right = 8
  key.shadow.camera.top = 8
  key.shadow.camera.bottom = -8
  key.shadow.camera.near = 8
  key.shadow.camera.far = 40
  key.shadow.camera.updateProjectionMatrix()
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.03
  key.shadow.radius = 3
  group.add(key)
  group.add(key.target)

  // A fill from the viewer's side, so the fronts of things are never black.
  const fill = new DirectionalLight(mix(p.white, p.hue, dark ? 0.35 : 0.12), dark ? 0.35 : 0.85)
  fill.position.set(2.5, 6, 9)
  fill.target.position.set(0, 1, 0)
  group.add(fill)
  group.add(fill.target)

  if (dark) {
    // The room's own lights come on: three pendants and the floor lamp.
    for (const at of PENDANTS) {
      const bulb = new PointLight(p.lamp, 14, 8, 2)
      bulb.position.set(at.x, ROOM.height - PENDANT_DROP + 0.05, at.z)
      group.add(bulb)
    }
    const lamp = new PointLight(mix(p.lamp, p.warm, 0.3), 7, 5, 2)
    lamp.position.copy(lampBulb())
    group.add(lamp)
    // A faint light down from the ceiling, so the shadows the pendants would cast read as one soft one.
    const top = new DirectionalLight(p.lamp, 0.4)
    top.position.set(0.5, 10, 1)
    top.target.position.set(0, 0, 0.5)
    group.add(top)
    group.add(top.target)
  }

  for (const light of group.children) light.layers.enableAll()

  group.add(shafts(shop))
  return { group, key }
}

/**
 * The light in the air: one soft prism per window, from the opening down the
 * sun's line to the floor, drawn additively so where two faces overlap the
 * shaft is brightest. Moonlight is the same shaft, fainter.
 */
function shafts(shop: Shop): Group {
  const p = shop.palette
  const group = named(new Group(), 'shafts')
  const map = shop.texture(128, 256, paintShaft())
  const material = shop.own(new MeshBasicMaterial({
    color: p.sun,
    map,
    transparent: true,
    opacity: p.dark ? 0.1 : 0.26,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  }))
  for (const at of WINDOWS) {
    const x = acrossOf(at)
    const corners = [
      new Vector3(x - WINDOW.width / 2, WINDOW.sill, BACK),
      new Vector3(x + WINDOW.width / 2, WINDOW.sill, BACK),
      new Vector3(x + WINDOW.width / 2, WINDOW.sill + WINDOW.height, BACK),
      new Vector3(x - WINDOW.width / 2, WINDOW.sill + WINDOW.height, BACK),
    ]
    const landings = corners.map(corner => corner.clone().addScaledVector(SUN, corner.y / -SUN.y))
    // Four side faces of the prism, each a quad from a window edge to its landing.
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    for (let edge = 0; edge < 4; edge += 1) {
      const a = corners[edge]!
      const b = corners[(edge + 1) % 4]!
      const la = landings[edge]!
      const lb = landings[(edge + 1) % 4]!
      const base = positions.length / 3
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, lb.x, lb.y, lb.z, la.x, la.y, la.z)
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
    geometry.setIndex(indices)
    const shaft = new Mesh(geometry, material)
    shaft.name = 'shaft'
    shaft.layers.set(SHELL_LAYER)
    shaft.renderOrder = 10
    group.add(shaft)
    group.userData.landings ??= []
    ;(group.userData.landings as Vector3[][]).push(landings)
  }
  return group
}

/** Whether an object is a light, for tests. */
export function isLight(object: unknown): boolean {
  return object instanceof DirectionalLight || object instanceof PointLight || object instanceof HemisphereLight
}

/** The layer every light shines on, for tests that check a light reaches both passes. */
export const LIT_LAYERS = [FURNITURE_LAYER, SHELL_LAYER] as const
