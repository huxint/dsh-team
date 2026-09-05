import { Group, Mesh, type MeshStandardMaterial } from 'three'
import { WORKSTATION, type Desk } from '../room.ts'
import { ROOM, toWorld } from '../stagecraft.ts'
import { batchMeshes } from './batching.ts'
import { plant, plantOf } from './flora.ts'
import { box, cylinder, lathe, named, plane, ring, rounded, sphere, Shop } from './kit.ts'
import type { Palette } from './palette.ts'
import { paintKeyboard, paintPaper, paintScreen, type AppKind } from './textures.ts'

export type ScreenState = 'working' | 'reading' | 'off'

export interface StationSpec {
  readonly id: string
  readonly seat: number
  readonly desk: Desk
  readonly app: AppKind
  readonly screen: ScreenState
  readonly empty: boolean
}

export const DESK_HEIGHT = 0.74

export const SEAT_HEIGHT = 0.5

const GLOW: Record<ScreenState, number> = { working: 1, reading: 0.62, off: 0.08 }

export class Station {
  readonly shop: Shop
  readonly group: Group
  private readonly chair: Group
  private readonly screen: MeshStandardMaterial
  private readonly picture: ReturnType<Shop['texture']>
  private spec: StationSpec

  constructor(palette: Palette, spec: StationSpec, paint: boolean) {
    // A departing teammate must release its textures independently of the room.
    const shop = new Shop(palette, paint)
    this.shop = shop
    this.spec = spec
    const p = shop.palette
    const s = spec.desk.scale
    const group = named(new Group(), `station:${spec.id}`)
    group.position.copy(toWorld(spec.desk))
    group.scale.setScalar(s)
    this.group = group
    group.add(shop.contact(1.9, 1.5, { z: -0.22 }))
    group.add(shop.contact(0.75, 0.7, { y: 0.009, z: 0.05 }))

    const width = WORKSTATION.width / 100 * ROOM.width
    const top = DESK_HEIGHT
    const deskZ = WORKSTATION.offset / 100 * ROOM.depth
    const deskDepth = WORKSTATION.depth / 100 * ROOM.depth
    const wood = shop.matte(p.wood, { roughness: 0.65 })
    group.add(named(rounded(width, 0.065, deskDepth, 0.028, wood, { y: top - 0.0325, z: deskZ }), 'desk'))
    const iron = shop.matte(p.metalDark, { roughness: 0.55, metalness: 0.2 })
    const legs = shop.matte(p.plastic, { roughness: 0.7 })
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        group.add(cylinder(0.024, 0.033, top - 0.065, legs,
          { x: side * (width / 2 - 0.1), y: (top - 0.065) / 2, z: deskZ + end * (deskDepth / 2 - 0.08) }, 10))
      }
      group.add(rounded(0.055, 0.045, deskDepth - 0.09, 0.018, legs,
        { x: side * (width / 2 - 0.1), y: top - 0.13, z: deskZ }))
    }
    group.add(box(width - 0.2, 0.055, 0.04, legs, { y: top - 0.12, z: deskZ - deskDepth / 2 + 0.08 }, { cast: false }))
    group.add(rounded(0.6, 0.007, 0.28, 0.003, shop.matte(p.rug, { roughness: 1 }), { y: top + 0.0035, z: deskZ + 0.1 }, { cast: false }))

    const monitor = named(new Group(), 'monitor')
    monitor.position.set(-0.2, top, deskZ - 0.16)
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
    this.screen.toneMapped = false
    monitor.add(plane(0.58, 0.33, this.screen, { y: 0.2 + 0.185, z: 0.018 }, { cast: false, receive: false }))
    monitor.add(sphere(0.006, shop.matte(p.leaf, { emissive: p.leaf, emissiveIntensity: 1 }), { x: 0.27, y: 0.2 + 0.01, z: 0.018 }, { cast: false }))
    group.add(monitor)

    const keyboard = named(new Group(), 'keyboard')
    keyboard.position.set(0.02, top, deskZ + 0.17)
    keyboard.add(rounded(0.44, 0.018, 0.15, 0.006, shop.matte(p.plasticDark, { roughness: 0.8 }), { y: 0.009 }, { cast: false }))
    const keys = shop.texture(256, 88, paintKeyboard(p))
    keyboard.add(plane(0.42, 0.13, shop.matte(p.white, { map: keys, roughness: 0.7 }), { y: 0.0185, rx: -Math.PI / 2 }, { cast: false, receive: true }))
    group.add(keyboard)
    const mouse = sphere(0.05, shop.matte(p.plastic, { roughness: 0.45 }), { x: 0.3, y: top + 0.016, z: deskZ + 0.14 }, { cast: false })
    mouse.scale.set(0.62, 0.35, 1)
    group.add(named(mouse, 'mouse'))

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
      papers.add(box(0.21, 0.004, 0.28, shop.matte(p.white, { map: sheet, roughness: 0.9 }), { y: 0.002 + index * 0.004, ry: (index - 1) * 0.12 }, { cast: false }))
    }
    group.add(papers)

    const green = plant(shop, plantOf(spec.seat + 2), 0.3)
    green.position.set(width / 2 - 0.12, top, deskZ - 0.2)
    green.name = 'deskPlant'
    group.add(green)

    batchMeshes(group)
    this.chair = chair(shop)
    batchMeshes(this.chair)
    group.add(this.chair)
    this.setEmpty(spec.empty)
  }

  matches(spec: StationSpec): boolean {
    const held = this.spec
    return held.id === spec.id && held.seat === spec.seat
      && held.desk.x === spec.desk.x && held.desk.y === spec.desk.y
      && held.desk.scale === spec.desk.scale && held.desk.columns === spec.desk.columns
  }

  update(spec: StationSpec): void {
    const held = this.spec
    this.spec = spec
    if (held.screen !== spec.screen || held.app !== spec.app) {
      this.shop.repaint(this.picture, paintScreen(this.shop.palette, spec.app, spec.screen, this.shop.palette.accent(spec.seat)))
      this.screen.emissiveIntensity = GLOW[spec.screen]
    }
    if (held.empty !== spec.empty) this.setEmpty(spec.empty)
  }

  pulse(time: number): boolean {
    if (this.spec.screen !== 'working') return false
    this.screen.emissiveIntensity = 0.94 + 0.06 * Math.sin(time * 1.7 + this.spec.seat)
    return true
  }

  dispose(): void {
    this.group.removeFromParent()
    this.shop.dispose()
    this.group.traverse(child => { if (child instanceof Mesh) child.geometry.dispose() })
  }

  private setEmpty(empty: boolean): void {
    this.chair.position.set(0, 0, empty ? 0.16 : 0)
    this.chair.rotation.y = empty ? 0.42 : 0
  }
}

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
