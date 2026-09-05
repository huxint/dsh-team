/**
 * One workstation: the desk, the computer on it, the keyboard, the mug, the
 * papers, a small plant, and the chair its owner sits in.
 *
 * The station is built around the place its owner stands: the chair is at the
 * member's own point on the floor, the desk stands a step in front of it
 * toward the back wall, and the monitor faces the room — so the camera sees the
 * screen over the member's shoulder, and the chair's back sits between the
 * camera and the member exactly as far in front as the depth pass thinks.
 */
import { Group, Mesh, type MeshStandardMaterial } from 'three'
import type { Desk } from '../room.ts'
import { toWorld } from '../stagecraft.ts'
import { plant, plantOf } from './flora.ts'
import { box, cylinder, lathe, named, plane, ring, rounded, sphere, type Shop } from './kit.ts'
import { paintKeyboard, paintPaper, paintScreen, type AppKind } from './textures.ts'

/** What a workstation's screen is doing. */
export type ScreenState = 'working' | 'reading' | 'off'

/** Everything a station needs to know about its owner. */
export interface StationSpec {
  readonly id: string
  readonly seat: number
  readonly desk: Desk
  readonly app: AppKind
  readonly screen: ScreenState
  /** Whether the owner is somewhere else right now. */
  readonly empty: boolean
}

/** How high the desk's lid stands, before the station's own scale. */
export const DESK_HEIGHT = 0.74

/** How far above the floor a seated member's hips are: the chair's seat. */
export const SEAT_HEIGHT = 0.5

/** How wide a desk is for a row of this many columns, before scale. */
export function deskWidthFor(columns: number): number {
  return Math.min(1.5, Math.max(0.95, (6 / Math.max(1, columns)) * 0.82))
}

/** How bright the screen glows in each state. */
const GLOW: Record<ScreenState, number> = { working: 1, reading: 0.62, off: 0.08 }

/** A member's own workstation, on the floor at its owner's place. */
export class Station {
  readonly group: Group
  private readonly chair: Group
  private readonly screen: MeshStandardMaterial
  private readonly picture: ReturnType<Shop['texture']>
  private spec: StationSpec

  constructor(private readonly shop: Shop, spec: StationSpec) {
    this.spec = spec
    const p = shop.palette
    const s = spec.desk.scale
    const group = named(new Group(), `station:${spec.id}`)
    group.position.copy(toWorld(spec.desk))
    group.scale.setScalar(s)
    this.group = group

    const width = deskWidthFor(spec.desk.columns)
    const top = DESK_HEIGHT
    const deskZ = -0.5
    const deskDepth = 0.6
    const wood = shop.matte(p.wood, { roughness: 0.65 })
    group.add(named(rounded(width, 0.045, deskDepth, 0.015, wood, { y: top - 0.0225, z: deskZ }), 'desk'))
    const iron = shop.matte(p.metalDark, { roughness: 0.5, metalness: 0.4 })
    for (const side of [-1, 1]) {
      group.add(box(0.05, top - 0.045, deskDepth - 0.1, iron, { x: side * (width / 2 - 0.08), y: (top - 0.045) / 2, z: deskZ }))
    }
    group.add(box(width - 0.2, 0.36, 0.02, shop.matte(p.woodDark, { roughness: 0.8 }), { y: top - 0.24, z: deskZ - deskDepth / 2 + 0.04 }, { cast: false }))

    // The computer, at the back of the lid, facing the room.
    const monitor = named(new Group(), 'monitor')
    monitor.position.set(-0.02, top, deskZ - 0.14)
    monitor.add(cylinder(0.11, 0.12, 0.014, iron, { y: 0.007 }, 20))
    monitor.add(box(0.05, 0.2, 0.03, iron, { y: 0.11, z: -0.02 }))
    monitor.add(rounded(0.62, 0.37, 0.034, 0.012, shop.matte(p.screenBezel, { roughness: 0.4 }), { y: 0.2 + 0.185 }))
    this.picture = shop.texture(256, 146, paintScreen(p, spec.app, spec.screen, p.accent(spec.seat)))
    this.screen = shop.matte(p.screenBezel, {
      emissive: this.picture === null ? p.screenOn : p.white,
      emissiveIntensity: GLOW[spec.screen],
      emissiveMap: this.picture,
      roughness: 0.3,
    })
    monitor.add(plane(0.58, 0.33, this.screen, { y: 0.2 + 0.185, z: 0.018 }, { cast: false, receive: false }))
    monitor.add(sphere(0.006, shop.matte(p.leaf, { emissive: p.leaf, emissiveIntensity: 1 }), { x: 0.27, y: 0.2 + 0.01, z: 0.018 }, { cast: false }))
    group.add(monitor)

    // On the lid around the computer: a keyboard, a mug, papers, a plant.
    const keyboard = named(new Group(), 'keyboard')
    keyboard.position.set(0.02, top, deskZ + 0.17)
    keyboard.add(rounded(0.44, 0.018, 0.15, 0.006, shop.matte(p.plasticDark, { roughness: 0.8 }), { y: 0.009 }, { cast: false }))
    const keys = shop.texture(256, 88, paintKeyboard(p))
    keyboard.add(plane(0.42, 0.13, shop.matte(p.plastic, { map: keys, roughness: 0.7 }), { y: 0.0185, rx: -Math.PI / 2 }, { cast: false, receive: true }))
    group.add(keyboard)

    const mug = named(new Group(), 'mug')
    mug.position.set(width / 2 - 0.16, top, deskZ + 0.12)
    const glaze = shop.matte(p.accent(spec.seat), { roughness: 0.4 })
    mug.add(lathe([[0.03, 0], [0.038, 0.004], [0.04, 0.09], [0.034, 0.093], [0.03, 0.012]], glaze, {}, 18))
    mug.add(ring(0.02, 0.006, glaze, { x: 0.048, y: 0.05, rx: 0, ry: Math.PI / 2 }, { cast: false }))
    group.add(mug)

    const sheet = shop.texture(128, 160, paintPaper(p))
    const papers = named(new Group(), 'papers')
    papers.position.set(-width / 2 + 0.2, top, deskZ + 0.1)
    for (let index = 0; index < 3; index += 1) {
      papers.add(box(0.21, 0.004, 0.28, shop.matte(p.paper, { map: sheet, roughness: 0.9 }), { y: 0.002 + index * 0.004, ry: (index - 1) * 0.12 }, { cast: false }))
    }
    group.add(papers)

    const green = plant(shop, plantOf(spec.seat + 2), 0.3)
    green.position.set(width / 2 - 0.12, top, deskZ - 0.2)
    green.name = 'deskPlant'
    group.add(green)

    this.chair = chair(shop)
    group.add(this.chair)
    this.setEmpty(spec.empty, true)
  }

  /** Whether this station can be updated in place for the new spec, or has to be rebuilt. */
  matches(spec: StationSpec): boolean {
    const held = this.spec
    return held.id === spec.id && held.seat === spec.seat
      && held.desk.x === spec.desk.x && held.desk.y === spec.desk.y
      && held.desk.scale === spec.desk.scale && held.desk.columns === spec.desk.columns
  }

  /** Bring the station up to date with what its owner is doing. */
  update(spec: StationSpec): void {
    const held = this.spec
    this.spec = spec
    if (held.screen !== spec.screen || held.app !== spec.app) {
      this.shop.repaint(this.picture, paintScreen(this.shop.palette, spec.app, spec.screen, this.shop.palette.accent(spec.seat)))
      this.screen.emissiveIntensity = GLOW[spec.screen]
    }
    if (held.empty !== spec.empty) this.setEmpty(spec.empty, false)
  }

  /** Let the working screen breathe; returns whether it moved. */
  pulse(time: number): boolean {
    if (this.spec.screen !== 'working') return false
    this.screen.emissiveIntensity = 0.94 + 0.06 * Math.sin(time * 1.7 + this.spec.seat)
    return true
  }

  /** Every mesh of the station, for the depth pass and the tests. */
  meshes(): Mesh[] {
    const out: Mesh[] = []
    this.group.traverse(child => { if (child instanceof Mesh) out.push(child) })
    return out
  }

  /** Free the station's geometry; its materials belong to the shop. */
  dispose(): void {
    this.group.removeFromParent()
    this.group.traverse(child => { if (child instanceof Mesh) child.geometry.dispose() })
  }

  /** An empty chair is pushed back and turned a little, the way somebody leaves one. */
  private setEmpty(empty: boolean, _initial: boolean): void {
    this.chair.position.set(0, 0, empty ? 0.16 : 0)
    this.chair.rotation.y = empty ? 0.42 : 0
  }
}

/** A task chair facing the desk: its back toward the room, on a five-star base. */
function chair(shop: Shop): Group {
  const p = shop.palette
  const group = named(new Group(), 'chair')
  const iron = shop.matte(p.metalDark, { roughness: 0.45, metalness: 0.5 })
  const shell = shop.matte(p.chair, { roughness: 0.85 })
  const trim = shop.matte(p.chairDark, { roughness: 0.85 })
  for (let spoke = 0; spoke < 5; spoke += 1) {
    const angle = (spoke / 5) * Math.PI * 2 + Math.PI / 10
    const arm = rounded(0.05, 0.03, 0.26, 0.012, iron, { x: Math.cos(angle) * 0.12, y: 0.035, z: Math.sin(angle) * 0.12, ry: -angle + Math.PI / 2 })
    group.add(arm)
    group.add(sphere(0.022, trim, { x: Math.cos(angle) * 0.24, y: 0.022, z: Math.sin(angle) * 0.24 }, { cast: false }))
  }
  group.add(cylinder(0.026, 0.03, SEAT_HEIGHT - 0.1, iron, { y: (SEAT_HEIGHT - 0.1) / 2 + 0.04 }, 12))
  group.add(rounded(0.46, 0.08, 0.44, 0.03, shell, { y: SEAT_HEIGHT - 0.04 }))
  group.add(box(0.06, 0.16, 0.03, trim, { y: SEAT_HEIGHT + 0.06, z: 0.2 }))
  const back = rounded(0.44, 0.4, 0.06, 0.03, shell, { y: SEAT_HEIGHT + 0.24, z: 0.21 })
  back.name = 'chairBack'
  group.add(back)
  group.add(box(0.44, 0.07, 0.064, trim, { y: SEAT_HEIGHT + 0.16, z: 0.21 }, { cast: false }))
  for (const side of [-1, 1]) {
    group.add(rounded(0.06, 0.03, 0.26, 0.012, trim, { x: side * 0.25, y: SEAT_HEIGHT + 0.2, z: 0.02 }))
    group.add(box(0.03, 0.18, 0.03, iron, { x: side * 0.25, y: SEAT_HEIGHT + 0.09, z: 0.08 }))
  }
  return group
}
