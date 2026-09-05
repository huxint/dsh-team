/**
 * The room's ambient life, kept quiet: dust turning in the light shafts, the
 * pendants swaying a little in the air conditioner's breeze, and the office
 * cat, which crosses the front of the room now and again and otherwise sits
 * where it likes. The crew's own motion is the story; this is the room
 * breathing behind it.
 *
 * Everything here is driven by one clock and advanced by `step`, which says
 * whether anything moved — a still room is not redrawn. Under reduced motion
 * nothing here moves at all: the cat sits, the dust hangs, the pendants hang.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, Points, PointsMaterial, Vector3 } from 'three'
import { capsule, cylinder, named, rounded, SHELL_LAYER, sphere, type Shop } from './kit.ts'
import { SUN } from './lights.ts'
import { acrossOf, BACK, WINDOW, WINDOWS } from './shell.ts'
import { paintGlow, seeded } from './textures.ts'

/** How many motes of dust hang in the light. */
const MOTES = 72

/** Where the cat sits when it is not going anywhere. */
const CAT_REST = { x: 3.1, z: 3.05 }

/** Where the cat walks to, across the front of the room. */
const CAT_FAR = { x: -4.4, z: 3.05 }

/** The cat's pace, in world units per second. */
const CAT_PACE = 0.42

/** How long the cat sits between crossings, at each end. */
const CAT_SIT = { rest: 34, far: 9 }

/** What the cat is doing. */
type CatPhase = 'rest' | 'out' | 'far' | 'back'

/** The room's small motions. */
export class Life {
  readonly group: Group
  private readonly cat: Group
  private readonly legs: Group[] = []
  private readonly tail: Group
  private readonly dust: Points | undefined
  private readonly motes: Float32Array | undefined
  private readonly seeds: Float32Array | undefined
  private phase: CatPhase = 'rest'
  private phaseAt = 0
  private clock = 0

  /**
   * @param shop - where the materials come from.
   * @param pendants - the lamps that sway; their pivots are at the ceiling.
   * @param still - whether the reader asked for no motion: the room then holds one pose.
   */
  constructor(shop: Shop, private readonly pendants: readonly Group[], public still: boolean) {
    this.group = named(new Group(), 'life')
    const { cat, legs, tail } = buildCat(shop)
    this.cat = cat
    this.legs = legs
    this.tail = tail
    this.group.add(cat)
    this.cat.position.set(CAT_REST.x, 0, CAT_REST.z)
    this.pose(0)
    if (!shop.palette.dark) {
      const dust = buildDust(shop)
      if (dust !== undefined) {
        this.dust = dust.points
        this.motes = dust.positions
        this.seeds = dust.seeds
        this.group.add(dust.points)
      }
    }
  }

  /**
   * Advance the room by so many seconds.
   * @param seconds - how long since the last step.
   * @returns whether anything moved and the room wants drawing again.
   */
  step(seconds: number): boolean {
    if (this.still) return false
    this.clock += seconds
    const t = this.clock
    this.pendants.forEach((pendant, index) => {
      pendant.rotation.z = Math.sin(t * 0.55 + index * 1.3) * 0.011
      pendant.rotation.x = Math.cos(t * 0.41 + index * 0.7) * 0.007
    })
    this.drift(seconds)
    this.prowl(seconds)
    return true
  }

  /** Free what the life owns; its materials belong to the shop. */
  dispose(): void {
    this.group.traverse(child => {
      if ('geometry' in child && typeof (child as { geometry?: { dispose?: () => void } }).geometry?.dispose === 'function') {
        (child as { geometry: { dispose: () => void } }).geometry.dispose()
      }
    })
  }

  /** Let the dust fall slowly and swirl, wrapping back to the top of the shaft. */
  private drift(seconds: number): void {
    if (this.dust === undefined || this.motes === undefined || this.seeds === undefined) return
    const t = this.clock
    for (let index = 0; index < MOTES; index += 1) {
      const seed = this.seeds[index]!
      const i = index * 3
      this.motes[i]! += Math.sin(t * 0.7 + seed * 12) * 0.018 * seconds
      this.motes[i + 1]! -= (0.022 + seed * 0.02) * seconds
      this.motes[i + 2]! += Math.cos(t * 0.5 + seed * 9) * 0.015 * seconds
      if (this.motes[i + 1]! < 0.05) {
        // Back to the top of its shaft, at a new place across it.
        const window = index % WINDOWS.length
        const x = acrossOf(WINDOWS[window]!) + (seed - 0.5) * WINDOW.width
        const y = WINDOW.sill + 0.2 + ((seed * 7) % 1) * (WINDOW.height - 0.3)
        const along = ((seed * 13) % 1) * 0.35
        const at = new Vector3(x, y, BACK).addScaledVector(SUN, (y / -SUN.y) * along)
        this.motes[i] = at.x
        this.motes[i + 1] = at.y
        this.motes[i + 2] = at.z
      }
    }
    ;(this.dust.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
  }

  /** The cat's round: sit, cross the room, sit, come back. */
  private prowl(seconds: number): void {
    this.phaseAt += seconds
    const crossing = Math.hypot(CAT_FAR.x - CAT_REST.x, CAT_FAR.z - CAT_REST.z) / CAT_PACE
    switch (this.phase) {
      case 'rest':
        if (this.phaseAt > CAT_SIT.rest) this.enter('out')
        break
      case 'far':
        if (this.phaseAt > CAT_SIT.far) this.enter('back')
        break
      case 'out':
      case 'back': {
        const through = Math.min(1, this.phaseAt / crossing)
        const from = this.phase === 'out' ? CAT_REST : CAT_FAR
        const to = this.phase === 'out' ? CAT_FAR : CAT_REST
        this.cat.position.set(from.x + (to.x - from.x) * through, 0, from.z + (to.z - from.z) * through)
        this.cat.rotation.y = to.x < from.x ? Math.PI : 0
        const stride = (this.phaseAt * CAT_PACE) / 0.22
        this.legs.forEach((leg, index) => { leg.rotation.x = Math.sin(stride * Math.PI * 2 + (index % 2) * Math.PI) * 0.45 })
        this.tail.rotation.z = Math.sin(this.clock * 3) * 0.2
        this.pose(through < 1 ? 1 : 0)
        if (through >= 1) this.enter(this.phase === 'out' ? 'far' : 'rest')
        break
      }
      default:
        break
    }
  }

  private enter(phase: CatPhase): void {
    this.phase = phase
    this.phaseAt = 0
    if (phase === 'rest' || phase === 'far') {
      const at = phase === 'rest' ? CAT_REST : CAT_FAR
      this.cat.position.set(at.x, 0, at.z)
      this.cat.rotation.y = phase === 'rest' ? -0.6 : 0.5
      for (const leg of this.legs) leg.rotation.x = 0
      this.pose(0)
    }
  }

  /** Sitting (0) or walking (1): a sitting cat is up on its haunches with its tail round its feet. */
  private pose(walking: number): void {
    const body = this.cat.getObjectByName('catBody')
    if (body !== undefined) body.rotation.x = -0.55 * (1 - walking)
    const head = this.cat.getObjectByName('catHead')
    if (head !== undefined) head.position.y = 0.3 + 0.05 * (1 - walking)
    this.tail.rotation.set(0, walking > 0 ? 0 : 1.4, walking > 0 ? 0.3 : 0.9)
  }
}

/** The office cat, built from a capsule, a sphere, two cones and a tail. */
function buildCat(shop: Shop): { cat: Group, legs: Group[], tail: Group } {
  const p = shop.palette
  const cat = named(new Group(), 'cat')
  const fur = shop.matte(p.cat, { roughness: 0.95 })
  const dark = shop.matte(p.catDark, { roughness: 0.95 })
  const body = capsule(0.085, 0.2, fur, { y: 0.19, rx: Math.PI / 2 })
  body.name = 'catBody'
  cat.add(body)
  for (const z of [-0.06, 0.0, 0.06]) {
    cat.add(rounded(0.12, 0.03, 0.03, 0.012, dark, { y: 0.27, z }, { cast: false }))
  }
  const head = sphere(0.075, fur, { y: 0.3, z: 0.18 })
  head.name = 'catHead'
  cat.add(head)
  for (const side of [-1, 1]) {
    cat.add(cylinder(0.001, 0.03, 0.06, fur, { x: side * 0.045, y: 0.37, z: 0.17, rz: side * -0.25 }, 8, { cast: false }))
    cat.add(sphere(0.011, shop.matte(p.leaf, { emissive: p.leaf, emissiveIntensity: 0.6 }), { x: side * 0.03, y: 0.31, z: 0.245 }, { cast: false }))
  }
  cat.add(sphere(0.012, shop.matte(p.error, { roughness: 0.6 }), { y: 0.28, z: 0.255 }, { cast: false }))
  const legs: Group[] = []
  for (const [x, z] of [[-0.05, 0.08], [0.05, 0.08], [-0.05, -0.08], [0.05, -0.08]] as const) {
    const hip = new Group()
    hip.position.set(x, 0.14, z)
    hip.add(cylinder(0.02, 0.022, 0.14, fur, { y: -0.07 }, 8))
    legs.push(hip)
    cat.add(hip)
  }
  const tail = new Group()
  tail.position.set(0, 0.22, -0.16)
  tail.add(cylinder(0.014, 0.02, 0.24, fur, { y: 0.12 }, 8, { cast: false }))
  tail.add(sphere(0.02, dark, { y: 0.25 }, { cast: false }))
  cat.add(tail)
  return { cat, legs, tail }
}

/** Motes of dust seeded into the two shafts of daylight. */
function buildDust(shop: Shop): { points: Points, positions: Float32Array, seeds: Float32Array } | undefined {
  const glow = shop.texture(64, 64, paintGlow())
  if (glow === null) return undefined
  const random = seeded(101)
  const positions = new Float32Array(MOTES * 3)
  const seeds = new Float32Array(MOTES)
  for (let index = 0; index < MOTES; index += 1) {
    const seed = random()
    seeds[index] = seed
    const window = index % WINDOWS.length
    const x = acrossOf(WINDOWS[window]!) + (random() - 0.5) * WINDOW.width
    const y = WINDOW.sill + 0.1 + random() * (WINDOW.height - 0.2)
    const at = new Vector3(x, y, BACK).addScaledVector(SUN, (y / -SUN.y) * random() * 0.95)
    positions[index * 3] = at.x
    positions[index * 3 + 1] = at.y
    positions[index * 3 + 2] = at.z
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const material = shop.own(new PointsMaterial({
    color: shop.palette.sun,
    map: glow,
    size: 0.05,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
  }))
  const points = new Points(geometry, material)
  points.name = 'dust'
  points.layers.set(SHELL_LAYER)
  points.renderOrder = 11
  return { points, positions, seeds }
}
