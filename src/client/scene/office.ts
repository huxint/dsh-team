/**
 * The office as one scene: the shell, the fixtures, the furniture, the lights,
 * the life, and a workstation per member — built from one palette and rebuilt
 * whenever the theme changes, since every colour and every painted picture in
 * it was mixed from the theme.
 *
 * The stations follow the roster: a member joins, a desk appears; a member's
 * screen changes, its picture is repainted in place. The members themselves
 * are not here — they are the DOM's — but each has a stand-in on the proxy
 * layer, a plane where the member stands, that the depth pass draws first so
 * the furniture in front of a member can be found.
 */
import {
  AlwaysStencilFunc, Group, Mesh, MeshBasicMaterial, PlaneGeometry, ReplaceStencilOp, Scene, Vector3,
} from 'three'
import type { SpriteMark } from '../stagecraft.ts'
import { toWorld } from '../stagecraft.ts'
import { buildFixtures } from './fixtures.ts'
import { buildLounge, buildTreadmill, buildUtility } from './furniture.ts'
import { disposeGeometry, PROXY_LAYER, Shop } from './kit.ts'
import { Life } from './life.ts'
import { buildLights } from './lights.ts'
import type { Palette } from './palette.ts'
import { buildShell } from './shell.ts'
import { Station, type StationSpec } from './workstation.ts'

/** How the office is built. */
export interface OfficeOptions {
  /** Whether canvas textures are worth painting; off where nothing will render them. */
  readonly paint?: boolean
  /** Whether the reader asked for no motion. */
  readonly still?: boolean
}

/** How much wider than a figure its stand-in is, so the stencil covers hood and elbows. */
const PROXY_WIDTH = 1.0

/** How much taller than the floor-to-hood height of a standing figure the stand-in is. */
const PROXY_HEIGHT = 1.85

/** The room, as a scene graph. */
export class Office {
  readonly scene = new Scene()
  palette: Palette
  shop: Shop
  private readonly root = new Group()
  private readonly stations = new Map<string, Station>()
  private specs: readonly StationSpec[] = []
  private life: Life | undefined
  private readonly proxies = new Map<string, Mesh>()
  private readonly proxyMaterial = new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    stencilWrite: true,
    stencilFunc: AlwaysStencilFunc,
    stencilRef: 1,
    stencilZPass: ReplaceStencilOp,
  })
  private readonly proxyGeometry = new PlaneGeometry(1, 1)
  private readonly paint: boolean
  private still: boolean

  constructor(palette: Palette, options: OfficeOptions = {}) {
    this.palette = palette
    this.paint = options.paint ?? true
    this.still = options.still ?? false
    this.shop = new Shop(palette, this.paint)
    this.scene.add(this.root)
    this.build()
  }

  /** Paint the whole room again in a new theme. */
  repaint(palette: Palette): void {
    if (palette === this.palette) return
    this.palette = palette
    this.tearDown()
    this.shop = new Shop(palette, this.paint)
    this.build()
    this.setStations(this.specs)
  }

  /**
   * Seat the roster: one station per spec, kept in place where its desk did not
   * move, rebuilt where it did, and taken away when its owner left the team.
   */
  setStations(specs: readonly StationSpec[]): void {
    this.specs = specs
    const wanted = new Set(specs.map(spec => spec.id))
    for (const [id, station] of this.stations) {
      if (!wanted.has(id)) {
        station.dispose()
        this.stations.delete(id)
      }
    }
    for (const spec of specs) {
      const held = this.stations.get(spec.id)
      if (held !== undefined && held.matches(spec)) {
        held.update(spec)
        continue
      }
      held?.dispose()
      const station = new Station(this.shop, spec)
      this.stations.set(spec.id, station)
      this.root.add(station.group)
    }
  }

  /**
   * Put a stand-in where every member is standing, sized to the figure drawn
   * there, so the depth pass can tell what is in front of whom.
   * @param marks - where each member is, by id.
   * @param eye - where the camera is, so each stand-in faces it.
   */
  setProxies(marks: ReadonlyMap<string, SpriteMark>, eye: Vector3): void {
    for (const [id, proxy] of this.proxies) {
      if (!marks.has(id)) {
        proxy.removeFromParent()
        this.proxies.delete(id)
      }
    }
    for (const [id, mark] of marks) {
      let proxy = this.proxies.get(id)
      if (proxy === undefined) {
        proxy = new Mesh(this.proxyGeometry, this.proxyMaterial)
        proxy.layers.set(PROXY_LAYER)
        proxy.name = `proxy:${id}`
        this.proxies.set(id, proxy)
        this.scene.add(proxy)
      }
      const height = PROXY_HEIGHT * mark.scale
      const at = toWorld(mark.point, mark.lift + height / 2)
      proxy.position.copy(at)
      proxy.scale.set(PROXY_WIDTH * mark.scale, height, 1)
      proxy.rotation.y = Math.atan2(eye.x - at.x, eye.z - at.z)
    }
  }

  /**
   * Advance the room's life by so many seconds.
   * @param seconds - how long since the last step.
   * @param time - the room's clock, for the screens' breathing.
   * @returns whether anything moved.
   */
  step(seconds: number, time: number): boolean {
    let moved = this.life?.step(seconds) ?? false
    if (!this.still) {
      for (const station of this.stations.values()) moved = station.pulse(time) || moved
    }
    return moved
  }

  setStill(still: boolean): void {
    this.still = still
    if (this.life !== undefined) this.life.still = still
  }

  /** Free everything. */
  dispose(): void {
    this.tearDown()
    for (const proxy of this.proxies.values()) proxy.removeFromParent()
    this.proxies.clear()
    this.proxyGeometry.dispose()
    this.proxyMaterial.dispose()
  }

  private build(): void {
    this.root.add(buildShell(this.shop))
    const fixtures = buildFixtures(this.shop)
    this.root.add(fixtures.group)
    this.root.add(buildLounge(this.shop))
    this.root.add(buildUtility(this.shop))
    this.root.add(buildTreadmill(this.shop))
    this.root.add(buildLights(this.shop).group)
    this.life = new Life(this.shop, fixtures.pendants, this.still)
    this.root.add(this.life.group)
  }

  private tearDown(): void {
    for (const station of this.stations.values()) station.dispose()
    this.stations.clear()
    this.life?.dispose()
    this.life = undefined
    for (const child of [...this.root.children]) {
      disposeGeometry(child)
      this.root.remove(child)
    }
    this.shop.dispose()
  }
}
