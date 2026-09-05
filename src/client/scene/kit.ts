import {
  AlwaysStencilFunc, BoxGeometry, CanvasTexture, CapsuleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, EqualStencilFunc,
  LatheGeometry, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  PlaneGeometry, PointLight, Points, RepeatWrapping, Shape, ShapeGeometry, SphereGeometry, SRGBColorSpace, Texture, TorusGeometry,
  Vector2,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Palette } from './palette.ts'
import { paintGlow } from './textures.ts'

export const FURNITURE_LAYER = 1

export const SHELL_LAYER = 2

export const PROXY_LAYER = 3

export interface At {
  readonly x?: number
  readonly y?: number
  readonly z?: number
  readonly rx?: number
  readonly ry?: number
  readonly rz?: number
}

export interface Casting {
  readonly cast?: boolean
  readonly receive?: boolean
}

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

export type Painter = (ctx: CanvasRenderingContext2D, width: number, height: number) => void

export function canRender(): boolean {
  return typeof document !== 'undefined'
    && (typeof WebGL2RenderingContext !== 'undefined' || typeof WebGLRenderingContext !== 'undefined')
}

export class Shop {
  readonly materials = new Set<Material>()
  readonly textures = new Set<Texture>()
  private readonly canPaint: boolean
  private contactMaterial: MeshBasicMaterial | undefined
  private readonly swatches = new Map<string, MeshStandardMaterial>()

  constructor(readonly palette: Palette, paint = canRender()) {
    this.canPaint = paint
  }

  matte(color: Color, finish: Finish = {}): MeshStandardMaterial {
    // Textured materials need their own identity because screen images are repainted in place.
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

  flat(color: Color, options: { readonly transparent?: boolean, readonly opacity?: number, readonly map?: Texture | null, readonly doubleSide?: boolean } = {}): MeshBasicMaterial {
    const material = new MeshBasicMaterial({ color, toneMapped: false })
    if (options.transparent === true) {
      material.transparent = true
      material.opacity = options.opacity ?? 1
      material.depthWrite = false
    }
    if (options.map !== undefined && options.map !== null) material.map = options.map
    if (options.doubleSide === true) material.side = DoubleSide
    return this.own(material)
  }

  contact(width: number, depth: number, at: At = {}): Mesh {
    this.contactMaterial ??= this.flat(this.palette.screenBezel, {
      map: this.texture(64, 64, paintGlow(this.palette)), transparent: true,
      opacity: this.palette.dark ? 0.25 : 0.18,
    })
    return plane(width, depth, this.contactMaterial, { y: 0.008, rx: -Math.PI / 2, ...at }, { cast: false, receive: false })
  }

  own<T extends Material>(material: T): T {
    this.materials.add(material)
    return material
  }

  texture(width: number, height: number, painter: Painter, repeat?: readonly [number, number]): CanvasTexture | null {
    if (!this.canPaint) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null
    painter(ctx, width, height)
    const texture = new CanvasTexture(canvas)
    // Canvas painters emit CSS colours in sRGB.
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

  repaint(texture: CanvasTexture | null, painter: Painter): void {
    if (texture === null) return
    const canvas = texture.image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    painter(ctx, canvas.width, canvas.height)
    texture.needsUpdate = true
  }

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

  dispose(): void {
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
    this.materials.clear()
    this.textures.clear()
    this.swatches.clear()
  }
}

export function put<T extends Object3D>(object: T, at: At): T {
  object.position.set(at.x ?? 0, at.y ?? 0, at.z ?? 0)
  object.rotation.set(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0)
  return object
}

export function piece(geometry: Mesh['geometry'], material: Material, at: At = {}, casting: Casting = {}): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = casting.cast ?? true
  mesh.receiveShadow = casting.receive ?? true
  mesh.layers.set(FURNITURE_LAYER)
  return put(mesh, at)
}

export function box(width: number, height: number, depth: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new BoxGeometry(width, height, depth), material, at, casting)
}

export function rounded(width: number, height: number, depth: number, radius: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  const edge = Math.min(radius, width / 2, height / 2, depth / 2)
  return piece(new RoundedBoxGeometry(width, height, depth, 3, edge), material, at, casting)
}

export function cylinder(radiusTop: number, radiusBottom: number, height: number, material: Material, at: At = {}, segments = 24, casting?: Casting): Mesh {
  return piece(new CylinderGeometry(radiusTop, radiusBottom, height, segments), material, at, casting)
}

export function ring(radius: number, thickness: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new TorusGeometry(radius, thickness, 8, 28), material, { rx: Math.PI / 2, ...at }, casting)
}

export function sphere(radius: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new SphereGeometry(radius, 20, 14), material, at, casting)
}

export function capsule(radius: number, length: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new CapsuleGeometry(radius, length, 6, 14), material, at, casting)
}

export function plane(width: number, height: number, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new PlaneGeometry(width, height), material, at, casting)
}

export function lathe(profile: readonly (readonly [number, number])[], material: Material, at: At = {}, segments = 24, casting?: Casting): Mesh {
  const points = profile.map(([radius, height]) => new Vector2(radius, height))
  return piece(new LatheGeometry(points, segments), material, at, casting)
}

export function cutout(shape: Shape, material: Material, at: At = {}, casting?: Casting): Mesh {
  return piece(new ShapeGeometry(shape, 8), material, at, casting)
}

export function leafShape(length: number, width: number, notches = 0): Shape {
  const shape = new Shape()
  shape.moveTo(0, 0)
  if (notches === 0) {
    shape.bezierCurveTo(width * 0.55, length * 0.18, width * 0.65, length * 0.65, 0, length)
    shape.bezierCurveTo(-width * 0.65, length * 0.65, -width * 0.55, length * 0.18, 0, 0)
    return shape
  }
  for (const side of [1, -1]) {
    for (let segment = 0; segment <= notches; segment += 1) {
      const from = side === 1 ? segment / (notches + 1) : 1 - segment / (notches + 1)
      const to = side === 1 ? (segment + 1) / (notches + 1) : 1 - (segment + 1) / (notches + 1)
      const middle = (from + to) / 2
      const outer = side * width * 0.62 * Math.sin(middle * Math.PI)
      const inner = side * width * 0.17 * Math.sin(to * Math.PI)
      shape.bezierCurveTo(outer, length * from, outer, length * middle, inner, length * to)
    }
  }
  shape.closePath()
  return shape
}

export function toShell<T extends Object3D>(object: T): T {
  object.traverse(child => { child.layers.set(SHELL_LAYER) })
  return object
}

export function named<T extends Object3D>(object: T, name: string): T {
  object.name = name
  return object
}

export function disposeGeometry(object: Object3D): void {
  object.traverse(child => {
    if (child instanceof Mesh || child instanceof Points) child.geometry.dispose()
    if (child instanceof DirectionalLight || child instanceof PointLight) child.shadow.dispose()
  })
}
