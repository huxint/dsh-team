/**
 * The room's camera: how a place on the flat floor plan becomes a place on the
 * screen, for the WebGL room and the DOM crew alike.
 *
 * `room.ts` owns a flat 0–100 floor plan and knows nothing about how the room
 * is drawn. This module maps that plan into a box of real world units and looks
 * into it through one perspective camera. The same camera renders the walls and
 * the furniture and projects every sprite the DOM stands on the floor, so a
 * member's feet are on the floor the renderer drew, a chair back stands exactly
 * as far in front of its owner as the depth pass thinks it does, and nothing in
 * the room ever has to be measured.
 *
 * The camera is fitted to the stage, not the other way round: whatever the tab's
 * aspect ratio, the whole floor and the top of the back wall stay in view, and a
 * pointer over the room leans the camera by a couple of degrees. Both are pure
 * arithmetic on the camera; the renderer only asks it for matrices.
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import type { Point } from './room.ts'
import type { CSSProperties } from 'react'

export const SHELL = { far: 0.72, top: 23, bottom: 100, bend: 0.55 } as const
export const WALL_TOP = 3
export function depthOf(y: number): number {
  const back = Math.min(1, Math.max(0, 1 - y / 100))
  return back / (back + SHELL.bend * (1 - back))
}
export function widthAt(depth: number): number {
  return 1 + (SHELL.far - 1) * depth
}
export function project(point: Point): { readonly left: number, readonly top: number, readonly scale: number } {
  const depth = depthOf(point.y)
  const scale = widthAt(depth)
  return {
    left: Math.round((50 + (point.x - 50) * scale) * 100) / 100,
    top: Math.round((SHELL.bottom - (SHELL.bottom - SHELL.top) * depth) * 100) / 100,
    scale: Math.round(scale * 100) / 100,
  }
}
export function onWall(x: number): number {
  return Math.round((50 + (x - 50) * SHELL.far) * 100) / 100
}
export function shellVars(): CSSProperties {
  const inset = Math.round(((1 - SHELL.far) / 2) * 100 * 100) / 100
  return {
    '--team-far-inset': `${inset}%`,
    '--team-floor-top': `${SHELL.top}%`,
    '--team-wall-top': `${WALL_TOP}%`,
    '--team-far-width': `${Math.round(SHELL.far * 100 * 100) / 100}%`,
  } as CSSProperties
}

/** The box the floor plan is stretched over, in world units. */
export const ROOM = { width: 10, depth: 7, height: 3.35 } as const

/** How tall a standing member is, in world units. */
export const FIGURE = 1.72

/** How the camera looks into the box. */
export const CAMERA = {
  /** Vertical field of view: narrow, so the perspective stays mild. */
  fov: 28,
  /** How far it looks down, in degrees. */
  pitch: 23,
  /** How far a pointer at the edge of the room turns it, in degrees. */
  lean: 2.2,
  tilt: 1.1,
  /** Air kept between the room and the edge of the stage, as fractions of half the stage. */
  marginX: 0.09,
  marginTop: 0.12,
  marginBottom: 0.15,
} as const

/** A place on the screen: where it goes, and how large one world unit is there. */
export interface Screen {
  /** Percent across the stage. */
  readonly left: number
  /** Percent down the stage. */
  readonly top: number
  /** How many CSS pixels one world unit of height covers at this depth. */
  readonly unit: number
}

/** One member standing on the floor, as the depth pass needs to know it. */
export interface SpriteMark {
  readonly point: Point
  /** The member's own size at its station, before perspective. */
  readonly scale: number
  /** How far above the floor the figure is anchored: a seated member's hips are on a chair. */
  readonly lift: number
}

type Listener = () => void

/** Round geometry so a style, a test and a route all read the same number. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * One place on the floor plan as a place in the world: x across, y up, z toward
 * the viewer. The plan's y grows toward the viewer as well, so the mapping is a
 * plain stretch.
 * @param point - the place on the 0–100 floor plan.
 * @param height - how far above the floor, in world units.
 * @returns the world position.
 */
export function toWorld(point: Point, height = 0): Vector3 {
  return new Vector3(
    ((point.x - 50) / 100) * ROOM.width,
    height,
    ((point.y - 50) / 100) * ROOM.depth,
  )
}

/**
 * The floor plan place under a world position.
 * @param position - anywhere in the world.
 * @returns where it stands on the plan.
 */
export function toPlan(position: Vector3): Point {
  return {
    x: round((position.x / ROOM.width) * 100 + 50),
    y: round((position.z / ROOM.depth) * 100 + 50),
  }
}

/** The corners that have to stay in view: the near edge of the floor and the top of the back wall. */
const FRAME: readonly Vector3[] = [
  new Vector3(-ROOM.width / 2, 0, ROOM.depth / 2),
  new Vector3(ROOM.width / 2, 0, ROOM.depth / 2),
  new Vector3(-ROOM.width / 2, ROOM.height, -ROOM.depth / 2),
  new Vector3(ROOM.width / 2, ROOM.height, -ROOM.depth / 2),
]

/** How many passes the fit takes; perspective makes each one nearly exact. */
const FIT_PASSES = 8

/** How fast the lean follows the pointer: the share of the gap closed per second. */
const LEAN_RATE = 6

/** A lean this close to where it is heading has arrived. */
const LEAN_SETTLED = 0.002

/**
 * The camera over the room, and everything that reads it.
 *
 * One instance per stage. The renderer draws through `camera`; the DOM crew ask
 * `project` where to stand and subscribe to be told when the camera moved; the
 * walk loop reports where each member is standing so the depth pass can hold a
 * proxy there.
 */
export class Stagecraft {
  readonly camera = new PerspectiveCamera(CAMERA.fov, 16 / 9, 0.1, 300)

  /** Whether a pointer over the room is allowed to lean the camera. */
  parallax = true

  /** Where every member is standing right now, by member id. */
  readonly sprites = new Map<string, SpriteMark>()

  private width = 1200
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
    this.resize(this.width, this.height)
  }

  /** The stage's size in CSS pixels, as last told. */
  get viewport(): { readonly width: number, readonly height: number } {
    return { width: this.width, height: this.height }
  }

  /**
   * The stage changed size: refit the camera so the room still fills it.
   * @param width - CSS pixels across.
   * @param height - CSS pixels down.
   */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this.width = width
    this.height = height
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.fit()
    this.pose()
    this.notifyCamera()
  }

  /**
   * Where the pointer is over the room, from -1 to 1 on each axis; the camera
   * leans toward it over the next few frames. Off the room, pass zeros.
   */
  setLean(x: number, y: number): void {
    if (!this.parallax) return
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
    this.visible = visible
    for (const listener of this.activityListeners) listener()
  }

  setReducedMotion(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion
    this.parallax = !reducedMotion
    if (reducedMotion) {
      this.wantX = this.wantY = this.leanX = this.leanY = 0
      this.pose()
      this.notifyCamera()
    }
    for (const listener of this.activityListeners) listener()
  }

  /**
   * Advance the lean toward where the pointer put it.
   * @param seconds - how long since the last step.
   * @returns whether the camera is still moving.
   */
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

  /**
   * One place on the floor plan, as a place on the stage.
   * @param point - the place on the 0–100 floor plan.
   * @param height - how far above the floor the anchored point is.
   * @returns where it draws, and how large a world unit is there.
   */
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

  /** Percent down the stage where the back wall meets the floor, on the centre line. */
  floorLine(): number {
    return this.project({ x: 50, y: 0 }).top
  }

  /** Percent down the stage where the back wall meets the ceiling, on the centre line. */
  wallTop(): number {
    return this.project({ x: 50, y: 0 }, ROOM.height).top
  }

  /** Be told whenever the camera moves; the disposer stops the telling. */
  subscribe(listener: Listener): () => void {
    this.cameraListeners.add(listener)
    return () => { this.cameraListeners.delete(listener) }
  }

  /** Be told whenever a member moves; the disposer stops the telling. */
  onSprites(listener: Listener): () => void {
    this.spriteListeners.add(listener)
    return () => { this.spriteListeners.delete(listener) }
  }

  /** Where one member is standing now, for the depth pass. */
  markSprite(id: string, point: Point, scale: number, lift = 0): void {
    const held = this.sprites.get(id)
    if (held !== undefined && held.point.x === point.x && held.point.y === point.y && held.scale === scale && held.lift === lift) return
    this.sprites.set(id, { point: { x: point.x, y: point.y }, scale, lift })
    for (const listener of this.spriteListeners) listener()
  }

  /** A member left the room. */
  dropSprite(id: string): void {
    if (!this.sprites.delete(id)) return
    for (const listener of this.spriteListeners) listener()
  }

  private notifyCamera(): void {
    for (const listener of this.cameraListeners) listener()
  }

  /**
   * Stand the camera where its distance, lean and target put it, looking at
   * the target.
   */
  private pose(yaw = CAMERA.lean * this.leanX, pitch = CAMERA.pitch + CAMERA.tilt * this.leanY): void {
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

  /**
   * Fit the room into the stage: back the camera off until the floor's near
   * edge and the wall's top edge both fit, then raise or lower its aim until
   * the room sits in the middle of the frame. Done without lean, so the lean
   * is a departure from a fitted picture rather than a part of it.
   */
  private fit(): void {
    const wantTop = 1 - CAMERA.marginTop
    const wantBottom = -1 + CAMERA.marginBottom
    for (let pass = 0; pass < FIT_PASSES; pass += 1) {
      this.pose(0, CAMERA.pitch)
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
      this.pose(0, CAMERA.pitch)
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
