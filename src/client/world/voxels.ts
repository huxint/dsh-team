import {
  BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshLambertMaterial, Object3D,
  type ColorRepresentation, type Material,
} from 'three'

export interface Block {
  x: number; y: number; z: number
  w: number; h: number; d: number
  color: ColorRepresentation
  rx?: number; ry?: number; rz?: number
}

const pose = new Object3D()
// Paints are a small fixed palette of CSS strings; parsing one per box per
// frame dominated the animated voxels' CPU time.
const palette = new Map<ColorRepresentation, Color>()
function paint(value: ColorRepresentation): Color {
  if (value instanceof Color) return value
  let color = palette.get(value)
  if (color === undefined) palette.set(value, color = new Color(value))
  return color
}

export class Voxels {
  readonly blocks: Block[] = []

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: ColorRepresentation, rotation: { rx?: number; ry?: number; rz?: number } = {}): void {
    this.blocks.push({ x, y, z, w, h, d, color, ...rotation })
  }

  build(name: string, material: Material = new MeshLambertMaterial()): InstancedMesh {
    const mesh = new InstancedMesh(new BoxGeometry(), material, Math.max(1, this.blocks.length))
    mesh.name = name
    mesh.count = this.blocks.length
    mesh.castShadow = true
    mesh.receiveShadow = true
    for (let index = 0; index < this.blocks.length; index += 1) {
      const block = this.blocks[index]!
      pose.position.set(block.x, block.y, block.z)
      pose.rotation.set(block.rx ?? 0, block.ry ?? 0, block.rz ?? 0)
      pose.scale.set(block.w, block.h, block.d)
      pose.updateMatrix()
      mesh.setMatrixAt(index, pose.matrix)
      mesh.setColorAt(index, paint(block.color))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    return mesh
  }
}

export class MovingVoxels {
  readonly mesh: InstancedMesh
  private cursor = 0
  private readonly transform = new Matrix4()
  private colorStart = Infinity
  private colorEnd = 0

  constructor(capacity: number, name: string, material: Material = new MeshLambertMaterial()) {
    this.mesh = new InstancedMesh(new BoxGeometry(), material, capacity)
    this.mesh.name = name
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.count = 0
  }

  begin(): void { this.cursor = 0; this.colorStart = Infinity; this.colorEnd = 0 }
  get count(): number { return this.cursor }

  box(parent: Matrix4 | undefined, x: number, y: number, z: number, w: number, h: number, d: number, color: ColorRepresentation, rx = 0, ry = 0, rz = 0): number {
    if (this.cursor >= this.mesh.instanceMatrix.count) throw new Error(`Voxel capacity exceeded: ${this.mesh.name}`)
    pose.position.set(x, y, z)
    pose.rotation.set(rx, ry, rz)
    pose.scale.set(w, h, d)
    pose.updateMatrix()
    if (parent) this.transform.multiplyMatrices(parent, pose.matrix)
    else this.transform.copy(pose.matrix)
    const index = this.cursor++
    this.mesh.setMatrixAt(index, this.transform)
    const next = paint(color)
    const colors = this.mesh.instanceColor
    if (!colors || Math.abs(colors.getX(index) - next.r) > 1e-6
      || Math.abs(colors.getY(index) - next.g) > 1e-6 || Math.abs(colors.getZ(index) - next.b) > 1e-6) {
      this.mesh.setColorAt(index, next)
      this.colorStart = Math.min(this.colorStart, index)
      this.colorEnd = index + 1
    }
    return index
  }

  end(): void {
    this.mesh.count = this.cursor
    if (this.cursor > 0) {
      this.mesh.instanceMatrix.addUpdateRange(0, this.cursor * 16)
      this.mesh.instanceMatrix.needsUpdate = true
    }
    if (this.mesh.instanceColor && this.colorEnd > this.colorStart) {
      this.mesh.instanceColor.setUsage(DynamicDrawUsage)
      this.mesh.instanceColor.addUpdateRange(this.colorStart * 3, (this.colorEnd - this.colorStart) * 3)
      this.mesh.instanceColor.needsUpdate = true
    }
  }
}
