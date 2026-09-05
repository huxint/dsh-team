import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import type { Point } from './room.ts'

export const ROOM = { width: 10, depth: 7, height: 3.35 } as const

export const FIGURE = 1.72

// Angles are degrees; margins are fractions of the half viewport.
export const CAMERA = {
  fov: 29,
  pitch: 28,
  yaw: 7,
  lean: 2.2,
  tilt: 1.1,
  marginX: 0.12,
  marginTop: 0.15,
  marginBottom: 0.13,
} as const

/** Positions are percentages; unit is CSS pixels per world unit of height. */
export interface Screen {
  readonly left: number
  readonly top: number
  readonly unit: number
}

export interface SpriteMark {
  readonly point: Point
  readonly scale: number
}

type Listener = () => void

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function toWorld(point: Point, height = 0): Vector3 {
  return new Vector3(
    ((point.x - 50) / 100) * ROOM.width,
    height,
    ((point.y - 50) / 100) * ROOM.depth,
  )
}

export function toPlan(position: Vector3): Point {
  return {
    x: round((position.x / ROOM.width) * 100 + 50),
    y: round((position.z / ROOM.depth) * 100 + 50),
  }
}

// The plinth and tall wall returns bound the visible diorama.
const FRAME: readonly Vector3[] = [-1, 1].flatMap(side => [
  new Vector3(side * (ROOM.width / 2 + 0.24), -0.28, ROOM.depth / 2 + 0.08),
  new Vector3(side * (ROOM.width / 2 + 0.24), -0.28, -ROOM.depth / 2 - 0.24),
  new Vector3(side * (ROOM.width / 2 + 0.2), ROOM.height + 0.05, -ROOM.depth / 2 - 0.2),
  new Vector3(side * (ROOM.width / 2 + 0.2), ROOM.height + 0.05, -ROOM.depth / 2 + 1.25),
])

const FIT_PASSES = 8

const LEAN_RATE = 6

const LEAN_SETTLED = 0.002

export class Stagecraft {
  readonly camera = new PerspectiveCamera(CAMERA.fov, 16 / 9, 0.1, 300)

  readonly sprites = new Map<string, SpriteMark>()

  private height = 675
  private distance = 24
  private readonly target = new Vector3(0, 1.4, 0)
  private leanX = 0
  private leanY = 0
  private wantX = 0
  private wantY = 0
  private readonly cameraListeners = new Set<Listener>()
  private readonly spriteListeners = new Set<Listener>()
  private readonly activityListeners = new Set<Listener>()
  private visible = true
  private reducedMotion = false
  private readonly scratch = new Vector3()

  constructor() {
    this.resize(1200, this.height)
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this.height = height
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.fit()
    this.pose()
    this.notifyCamera()
  }

  setLean(x: number, y: number): void {
    if (this.reducedMotion) return
    this.wantX = MathUtils.clamp(x, -1, 1)
    this.wantY = MathUtils.clamp(y, -1, 1)
  }

  leaning(): boolean {
    return this.wantX !== this.leanX || this.wantY !== this.leanY
  }

  readonly getActivity = (): 'hidden' | 'still' | 'active' =>
    !this.visible ? 'hidden' : this.reducedMotion ? 'still' : 'active'

  readonly subscribeActivity = (listener: Listener): (() => void) => {
    this.activityListeners.add(listener)
    return () => { this.activityListeners.delete(listener) }
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    for (const listener of this.activityListeners) listener()
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.reducedMotion === reducedMotion) return
    this.reducedMotion = reducedMotion
    if (reducedMotion) {
      this.wantX = this.wantY = this.leanX = this.leanY = 0
      this.pose()
      this.notifyCamera()
    }
    for (const listener of this.activityListeners) listener()
  }

  step(seconds: number): boolean {
    const gapX = this.wantX - this.leanX
    const gapY = this.wantY - this.leanY
    if (Math.abs(gapX) < LEAN_SETTLED && Math.abs(gapY) < LEAN_SETTLED) {
      if (gapX === 0 && gapY === 0) return false
      this.leanX = this.wantX
      this.leanY = this.wantY
      this.pose()
      this.notifyCamera()
      return true
    }
    const share = 1 - Math.exp(-LEAN_RATE * Math.max(0, seconds))
    this.leanX += gapX * share
    this.leanY += gapY * share
    this.pose()
    this.notifyCamera()
    return true
  }

  project(point: Point, height = 0): Screen {
    const at = toWorld(point, height).project(this.camera)
    const foot = toWorld(point, 0).project(this.camera)
    const head = toWorld(point, 1).project(this.camera)
    return {
      left: round(((at.x + 1) / 2) * 100),
      top: round(((1 - at.y) / 2) * 100),
      unit: round((Math.abs(head.y - foot.y) / 2) * this.height),
    }
  }

  subscribe(listener: Listener): () => void {
    this.cameraListeners.add(listener)
    return () => { this.cameraListeners.delete(listener) }
  }

  onSprites(listener: Listener): () => void {
    this.spriteListeners.add(listener)
    return () => { this.spriteListeners.delete(listener) }
  }

  markSprite(id: string, point: Point, scale: number): void {
    const held = this.sprites.get(id)
    if (held !== undefined && held.point.x === point.x && held.point.y === point.y && held.scale === scale) return
    this.sprites.set(id, { point: { x: point.x, y: point.y }, scale })
    for (const listener of this.spriteListeners) listener()
  }

  dropSprite(id: string): void {
    if (!this.sprites.delete(id)) return
    for (const listener of this.spriteListeners) listener()
  }

  private notifyCamera(): void {
    for (const listener of this.cameraListeners) listener()
  }

  private pose(yaw = CAMERA.yaw + CAMERA.lean * this.leanX, pitch = CAMERA.pitch + CAMERA.tilt * this.leanY): void {
    const rotate = MathUtils.degToRad(yaw)
    const dip = MathUtils.degToRad(pitch)
    this.scratch.set(
      Math.sin(rotate) * Math.cos(dip),
      -Math.sin(dip),
      -Math.cos(rotate) * Math.cos(dip),
    )
    this.camera.position.copy(this.target).addScaledVector(this.scratch, -this.distance)
    this.camera.lookAt(this.target)
    this.camera.updateMatrixWorld(true)
  }

  private fit(): void {
    // Reset the aim so repeated wide/narrow resizes cannot accumulate drift.
    this.target.set(0, 1.4, 0)
    this.distance = 24
    const wantTop = 1 - CAMERA.marginTop
    const wantBottom = -1 + CAMERA.marginBottom
    for (let pass = 0; pass < FIT_PASSES; pass += 1) {
      this.pose(CAMERA.yaw, CAMERA.pitch)
      let widest = 0
      let top = -Infinity
      let bottom = Infinity
      for (const corner of FRAME) {
        const ndc = this.scratch.copy(corner).project(this.camera)
        widest = Math.max(widest, Math.abs(ndc.x))
        top = Math.max(top, ndc.y)
        bottom = Math.min(bottom, ndc.y)
      }
      const across = widest / (1 - CAMERA.marginX)
      const down = (top - bottom) / (wantTop - wantBottom)
      this.distance *= Math.max(across, down)
      this.pose(CAMERA.yaw, CAMERA.pitch)
      top = -Infinity
      bottom = Infinity
      for (const corner of FRAME) {
        const ndc = this.scratch.copy(corner).project(this.camera)
        top = Math.max(top, ndc.y)
        bottom = Math.min(bottom, ndc.y)
      }
      const drift = (top + bottom) / 2 - (wantTop + wantBottom) / 2
      const halfHeight = this.distance * Math.tan(MathUtils.degToRad(CAMERA.fov / 2))
      this.target.y += drift * halfHeight
    }
  }
}
