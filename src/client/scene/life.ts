import { AdditiveBlending, BufferAttribute, BufferGeometry, CatmullRomCurve3, Group, Points, PointsMaterial, TubeGeometry, Vector3 } from 'three'
import { cylinder, disposeGeometry, named, piece, rounded, SHELL_LAYER, sphere, type Shop } from './kit.ts'
import { SUN } from './lights.ts'
import { acrossOf, BACK, WINDOW, WINDOWS } from './shell.ts'
import { paintGlow, seeded } from './textures.ts'

const MOTES = 72

const CAT_REST = { x: 3.1, z: 3.05 }

const CAT_FAR = { x: -4.4, z: 3.05 }

const CAT_PACE = 0.42

const CAT_SIT = { rest: 34, far: 9 }

type CatPhase = 'rest' | 'out' | 'far' | 'back'

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

  constructor(shop: Shop, private readonly pendants: readonly Group[], public still: boolean) {
    this.group = named(new Group(), 'life')
    const { cat, legs, tail } = buildCat(shop)
    this.cat = cat
    this.legs = legs
    this.tail = tail
    this.group.add(cat)
    this.cat.position.set(CAT_REST.x, 0, CAT_REST.z)
    this.cat.rotation.y = -0.6
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

  get catWalking(): boolean {
    return this.phase === 'out' || this.phase === 'back'
  }

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

  dispose(): void {
    this.group.removeFromParent()
    disposeGeometry(this.group)
  }

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
    ; (this.dust.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
  }

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
        this.cat.rotation.y = to.x < from.x ? -Math.PI / 2 : Math.PI / 2
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

  private pose(walking: number): void {
    const body = this.cat.getObjectByName('catBody')
    if (body !== undefined) body.rotation.x = -0.42 * (1 - walking)
    const head = this.cat.getObjectByName('catHead')
    if (head !== undefined) head.position.y = 0.32 + 0.04 * (1 - walking)
    this.tail.rotation.x = walking > 0 ? -0.6 : 0
    if (walking === 0) this.tail.rotation.z = 0
  }
}

function buildCat(shop: Shop): { cat: Group, legs: Group[], tail: Group } {
  const p = shop.palette
  const cat = named(new Group(), 'cat')
  const fur = shop.matte(p.cat, { roughness: 1 })
  const dark = shop.matte(p.catDark, { roughness: 1 })
  const cream = shop.matte(p.paper, { roughness: 1 })
  cat.add(shop.contact(0.6, 0.7))
  const body = named(new Group(), 'catBody')
  body.position.y = 0.2
  const torso = sphere(0.1, fur)
  torso.scale.set(0.9, 1.05, 1.75)
  body.add(torso)
  for (const z of [-0.075, -0.015, 0.045]) {
    body.add(rounded(0.12, 0.018, 0.025, 0.008, dark, { y: 0.09, z }, { cast: false }))
  }
  cat.add(body)

  const head = named(new Group(), 'catHead')
  head.position.set(0, 0.32, 0.16)
  head.add(sphere(0.082, fur))
  for (const side of [-1, 1]) {
    head.add(cylinder(0, 0.032, 0.07, fur, { x: side * 0.048, y: 0.073, z: -0.004, rz: side * -0.22 }, 4))
    head.add(cylinder(0, 0.019, 0.04, dark, { x: side * 0.048, y: 0.075, z: 0.013, rz: side * -0.22 }, 4, { cast: false }))
    head.add(sphere(0.024, cream, { x: side * 0.018, y: -0.021, z: 0.066 }, { cast: false }))
    head.add(sphere(0.012, shop.matte(p.screenBezel), { x: side * 0.034, y: 0.014, z: 0.071 }, { cast: false }))
    head.add(sphere(0.0035, cream, { x: side * 0.034 - 0.003, y: 0.018, z: 0.081 }, { cast: false }))
    for (const offset of [-1, 1]) {
      head.add(cylinder(0.001, 0.001, 0.06, cream, { x: side * 0.07, y: -0.014 + offset * 0.006, z: 0.066, rz: side * (Math.PI / 2 + offset * 0.12) }, 3, { cast: false }))
    }
  }
  head.add(sphere(0.008, dark, { y: -0.012, z: 0.089 }, { cast: false }))
  cat.add(head)

  const legs: Group[] = []
  for (const [x, z] of [[-0.055, 0.095], [0.055, 0.095], [-0.055, -0.1], [0.055, -0.1]] as const) {
    const hip = new Group()
    hip.position.set(x, 0.13, z)
    hip.add(cylinder(0.018, 0.022, 0.12, fur, { y: -0.06 }, 8))
    hip.add(sphere(0.025, cream, { y: -0.11, z: 0.009 }, { cast: false }))
    legs.push(hip)
    cat.add(hip)
  }
  const tail = new Group()
  tail.position.set(0, 0.06, -0.13)
  const curl = new CatmullRomCurve3([
    new Vector3(0, 0, 0), new Vector3(-0.04, 0, -0.13),
    new Vector3(-0.15, -0.02, -0.1), new Vector3(-0.16, -0.02, 0.08),
  ])
  tail.add(piece(new TubeGeometry(curl, 12, 0.017, 6, false), fur, {}, { cast: false }))
  tail.add(sphere(0.018, dark, { x: -0.16, y: -0.02, z: 0.08 }, { cast: false }))
  cat.add(tail)
  return { cat, legs, tail }
}

function buildDust(shop: Shop): { points: Points, positions: Float32Array, seeds: Float32Array } | undefined {
  const glow = shop.texture(64, 64, paintGlow(shop.palette))
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
