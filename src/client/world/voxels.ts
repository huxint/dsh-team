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
const color = new Color()

export class Voxels {
  readonly blocks: Block[] = []

  box(x: number, y: number, z: number, w: number, h: number, d: number, paint: ColorRepresentation, rotation: { rx?: number; ry?: number; rz?: number } = {}): void {
    this.blocks.push({ x, y, z, w, h, d, color: paint, ...rotation })
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
      mesh.setColorAt(index, color.set(block.color))
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

  constructor(capacity: number, name: string, material: Material = new MeshLambertMaterial()) {
    this.mesh = new InstancedMesh(new BoxGeometry(), material, capacity)
    this.mesh.name = name
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.count = 0
  }

  begin(): void { this.cursor = 0 }
  get count(): number { return this.cursor }

  box(parent: Matrix4 | undefined, x: number, y: number, z: number, w: number, h: number, d: number, paint: ColorRepresentation, rx = 0, ry = 0, rz = 0): number {
    if (this.cursor >= this.mesh.instanceMatrix.count) throw new Error(`Voxel capacity exceeded: ${this.mesh.name}`)
    pose.position.set(x, y, z)
    pose.rotation.set(rx, ry, rz)
    pose.scale.set(w, h, d)
    pose.updateMatrix()
    if (parent) this.transform.multiplyMatrices(parent, pose.matrix)
    else this.transform.copy(pose.matrix)
    const index = this.cursor++
    this.mesh.setMatrixAt(index, this.transform)
    this.mesh.setColorAt(index, color.set(paint))
    return index
  }

  end(): void {
    this.mesh.count = this.cursor
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}
