/**
 * The room's building kit: the few shapes every piece of furniture is made of,
 * the shop that owns their materials, and the way pieces are placed.
 *
 * Everything standing in the room is a rounded box, a cylinder, a sphere or a
 * flat shape, in one of a small set of shared materials. That is deliberate:
 * a toy diorama is read as one object because every piece in it is cut from
 * the same few forms and lit by the same light, and a kit this small is what
 * keeps a coffee machine and a sofa looking like they came from the same shop.
 *
 * Furniture lives on its own render layer, because the depth pass draws
 * furniture alone: whatever a member could stand behind has to be findable
 * without the walls, the floor and the light shafts coming along.
 */
import {
  AlwaysStencilFunc, BoxGeometry, CanvasTexture, CapsuleGeometry, Color, CylinderGeometry, DoubleSide, EqualStencilFunc,
  ExtrudeGeometry, Group, LatheGeometry, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  PlaneGeometry, RepeatWrapping, Shape, ShapeGeometry, SphereGeometry, SRGBColorSpace, Texture, TorusGeometry,
  Vector2,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Point } from '../room.ts'
import { toWorld } from '../stagecraft.ts'
import type { Palette } from './palette.ts'

/** The render layer furniture stands on: everything a member could stand behind. */
export const FURNITURE_LAYER = 1

/** The render layer for the walls, the floor and everything nobody stands behind. */
export const SHELL_LAYER = 2

/** The render layer of the members' stand-ins, drawn by the depth pass alone. */
export const PROXY_LAYER = 3

/** Where a piece goes, and how it is turned. */
export interface At {
  readonly x?: number
  readonly y?: number
  readonly z?: number
  readonly rx?: number
  readonly ry?: number
  readonly rz?: number
}

/** What a piece does with light. */
export interface Casting {
  readonly cast?: boolean
  readonly receive?: boolean
}

/** How a matte material may depart from painted wood and fabric. */
export interface Finish {
  readonly roughness?: number
  readonly metalness?: number
  readonly emissive?: Color
  readonly emissiveIntensity?: number
  readonly transparent?: boolean
  readonly opacity?: number
  readonly doubleSide?: boolean
  readonly map?: Texture | null
  readonly emissiveMap?: Texture | null
}

/** Draw into a 2D canvas; the texture is what is left on it. */
export type Painter = (ctx: CanvasRenderingContext2D, width: number, height: number) => void

/** Whether this page can draw a WebGL room at all; without one no texture is worth painting. */
export function canRender(): boolean {
  return typeof document !== 'undefined'
    && (typeof WebGL2RenderingContext !== 'undefined' || typeof WebGLRenderingContext !== 'undefined')
}

/**
 * The shop every piece of the room is made in. It owns the materials and the
 * textures, so the depth pass can turn the stencil test on across all of them
 * at once and a rebuild can free everything it made.
 */
export class Shop {
  readonly materials = new Set<Material>()
  readonly textures = new Set<Texture>()
  private readonly canPaint: boolean
  /** Plain matte materials by colour and finish, so a hundred wooden pieces share one. */
  private readonly swatches = new Map<string, MeshStandardMaterial>()

  /**
   * @param palette - the colours this shop paints in.
   * @param paint - whether canvas textures are worth painting; off where nothing will render them.
   */
  constructor(readonly palette: Palette, paint = canRender()) {
    this.canPaint = paint
  }

  /**
   * A matte material in one colour: the room is furnished in painted wood and
   * fabric, not chrome, so nothing here is shiny unless it says so. Plain
   * finishes are shared: ask twice for the same wood and you get the same material.
   */
  matte(color: Color, finish: Finish = {}): MeshStandardMaterial {
    const plain = finish.map === undefined && finish.emissiveMap === undefined
    const key = plain
      ? [
        color.getHexString(), finish.roughness ?? 0.86, finish.metalness ?? 0,
        finish.emissive?.getHexString() ?? '-', finish.emissiveIntensity ?? 1,
        finish.transparent === true ? finish.opacity ?? 1 : '-', finish.doubleSide === true ? 'd' : 's',
      ].join('|')
      : undefined
    if (key !== undefined) {
      const held = this.swatches.get(key)
      if (held !== undefined) return held
    }
    const material = new MeshStandardMaterial({
      color,
      roughness: finish.roughness ?? 0.86,
      metalness: finish.metalness ?? 0,
    })
    if (finish.emissive !== undefined) {
      material.emissive = finish.emissive
      material.emissiveIntensity = finish.emissiveIntensity ?? 1
    }
    if (finish.transparent === true) {
      material.transparent = true
      material.opacity = finish.opacity ?? 1
    }
    if (finish.doubleSide === true) material.side = DoubleSide
    if (finish.map !== undefined && finish.map !== null) material.map = finish.map
    if (finish.emissiveMap !== undefined && finish.emissiveMap !== null) material.emissiveMap = finish.emissiveMap
    if (key !== undefined) this.swatches.set(key, material)
    return this.own(material)
  }

  /** An unlit material: the sky outside, a light shaft, a glow — things that are light rather than lit. */
  flat(color: Color, options: { readonly transparent?: boolean, readonly opacity?: number, readonly map?: Texture | null, readonly doubleSide?: boolean } = {}): MeshBasicMaterial {
    const material = new MeshBasicMaterial({ color })
    if (options.transparent === true) {
      material.transparent = true
      material.opacity = options.opacity ?? 1
      material.depthWrite = false
    }
    if (options.map !== undefined && options.map !== null) material.map = options.map
    if (options.doubleSide === true) material.side = DoubleSide
    return this.own(material)
  }

  /** Register a material made elsewhere, so the shop still owns it. */
  own<T extends Material>(material: T): T {
    this.materials.add(material)
    return material
  }

  /**
   * A texture painted on a canvas, when this page can render one. In sRGB, the
   * colour space the palette's CSS strings are written in.
   * @param width - canvas width in texels.
   * @param height - canvas height in texels.
   * @param painter - what to draw.
   * @param repeat - how many times it tiles across and down, if it tiles.
   * @returns the texture, or nothing where no room will be drawn.
   */
  texture(width: number, height: number, painter: Painter, repeat?: readonly [number, number]): CanvasTexture | null {
    if (!this.canPaint) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null
    painter(ctx, width, height)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4
    if (repeat !== undefined) {
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      texture.repeat.set(repeat[0], repeat[1])
    }
    this.textures.add(texture)
    return texture
  }

  /**
   * Paint a texture's canvas again in place, for a picture that changed.
   * @param texture - one of this shop's canvas textures; nothing happens for none.
   * @param painter - what to draw now.
   */
  repaint(texture: CanvasTexture | null, painter: Painter): void {
    if (texture === null) return
    const canvas = texture.image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    painter(ctx, canvas.width, canvas.height)
    texture.needsUpdate = true
  }

  /**
   * Turn the depth pass's stencil test on or off across everything the shop
   * made. On, a material only paints where a member's stand-in was drawn first.
   */
  setStencil(on: boolean): void {
    for (const material of this.materials) {
      material.stencilWrite = on
      if (on) {
        material.stencilWriteMask = 0
        material.stencilFunc = EqualStencilFunc
        material.stencilRef = 1
      } else {
        material.stencilWriteMask = 0xff
        material.stencilFunc = AlwaysStencilFunc
        material.stencilRef = 0
      }
    }
  }

  /** Free everything the shop made. */
  dispose(): void {
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
    this.materials.clear()
    this.textures.clear()
    this.swatches.clear()
  }
}

/** Put a piece where it goes. */
export function put<T extends Object3D>(object: T, at: At): T {
  object.position.set(at.x ?? 0, at.y ?? 0, at.z ?? 0)
  object.rotation.set(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0)
  return object
}

/** One piece of furniture, on the furniture layer, casting and catching light. */
export function piece(geometry: Mesh['geometry'], material: Material, at: At = {}, casting: Casting = {}): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = casting.cast ?? true
  mesh.receiveShadow = casting.receive ?? true
  mesh.layers.set(FURNITURE_LAYER)
  return put(mesh, at)
}

/** A box. */
export function box(width: number, height: number, depth: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new BoxGeometry(width, height, depth), material, at, casting)
}

/** A box with its edges rounded off, which is most of what a toy is. */
export function rounded(width: number, height: number, depth: number, radius: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  const edge = Math.min(radius, width / 2, height / 2, depth / 2)
  return piece(new RoundedBoxGeometry(width, height, depth, 3, edge), material, at, casting)
}

/** A cylinder, or a cone when the two radii differ; standing up unless turned. */
export function cylinder(radiusTop: number, radiusBottom: number, height: number, material: Material, at: At = {}, segments = 24, casting?: Casting): Mesh {
  return piece(new CylinderGeometry(radiusTop, radiusBottom, height, segments), material, at, casting)
}

/** A tube open at both ends, for shades and rims. */
export function tube(radiusTop: number, radiusBottom: number, height: number, material: Material, at: At = {}, segments = 24): Mesh {
  return piece(new CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, true), material, at)
}

/** A ring lying flat, for rims and coasters. */
export function ring(radius: number, thickness: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new TorusGeometry(radius, thickness, 8, 28), material, { rx: Math.PI / 2, ...at }, casting)
}

/** A sphere, or a flattened one. */
export function sphere(radius: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new SphereGeometry(radius, 20, 14), material, at, casting)
}

/** A capsule standing on end: a bottle, a cactus arm, a cushion. */
export function capsule(radius: number, length: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new CapsuleGeometry(radius, length, 6, 14), material, at, casting)
}

/** A flat rectangle. */
export function plane(width: number, height: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new PlaneGeometry(width, height), material, at, casting)
}

/**
 * A shape turned on a lathe: a pot, a mug, a lamp base. Points run from the
 * bottom up, as (radius, height) pairs.
 */
export function lathe(profile: readonly (readonly [number, number])[], material: Material, at: At = {}, segments = 24, casting?: Casting): Mesh {
  const points = profile.map(([radius, height]) => new Vector2(radius, height))
  return piece(new LatheGeometry(points, segments), material, at, casting)
}

/** A flat shape cut from an outline, drawn in the xy plane. */
export function cutout(shape: Shape, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new ShapeGeometry(shape, 8), material, at, casting)
}

/** An outline given a little thickness, so it has an edge to catch the light. */
export function slab(shape: Shape, depth: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 }), material, at, casting)
}

/** A rounded rectangle outline, for slabs and cutouts. */
export function roundedRect(width: number, height: number, radius: number): Shape {
  const shape = new Shape()
  const r = Math.min(radius, width / 2, height / 2)
  const x = -width / 2
  const y = -height / 2
  shape.moveTo(x + r, y)
  shape.lineTo(x + width - r, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + height - r)
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  shape.lineTo(x + r, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  return shape
}

/**
 * A leaf outline: a pointed oval, notched when asked, drawn from its stem at
 * the origin up to its tip at `length`.
 */
export function leafShape(length: number, width: number, notches = 0): Shape {
  const shape = new Shape()
  shape.moveTo(0, 0)
  shape.bezierCurveTo(width * 0.55, length * 0.2, width * 0.62, length * 0.7, 0, length)
  if (notches > 0) {
    // Cut back into the far side so the leaf reads as split, not as a blob.
    for (let index = notches; index >= 1; index -= 1) {
      const along = (index / (notches + 1)) * length
      shape.lineTo(-width * 0.14, along + length * 0.04)
      shape.lineTo(-width * 0.6, along)
    }
    shape.lineTo(-width * 0.5, length * 0.14)
    shape.lineTo(0, 0)
  } else {
    shape.bezierCurveTo(-width * 0.62, length * 0.7, -width * 0.55, length * 0.2, 0, 0)
  }
  return shape
}

/** A group standing at a place on the floor plan, so many pieces can move as one. */
export function standAt(point: Point, height = 0): Group {
  const group = new Group()
  group.position.copy(toWorld(point, height))
  return group
}

/** Let a piece and everything in it ignore the depth pass: it belongs to the walls. */
export function toShell<T extends Object3D>(object: T): T {
  object.traverse(child => { child.layers.set(SHELL_LAYER) })
  return object
}

/** Name a piece, and everything under it stays findable by that name. */
export function named<T extends Object3D>(object: T, name: string): T {
  object.name = name
  return object
}

/**
 * Free the geometry of a subtree. Materials and textures are owned by the shop
 * that made them and go with it.
 */
export function disposeGeometry(object: Object3D): void {
  object.traverse(child => {
    if (child instanceof Mesh) child.geometry.dispose()
  })
}
