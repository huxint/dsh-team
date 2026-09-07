import { OrthographicCamera, Vector3 } from 'three'
import { TRAY, type Position } from './layout.ts'

export const CAMERA_LIMITS = { minZoom: 0.65, maxZoom: 8, minPolar: 0.22, maxPolar: 1.27 } as const
const TARGET = new Vector3(4, 0.2, -0.15)

export class WorldCamera {
  readonly camera = new OrthographicCamera(-20, 20, 12, -12, 0.1, 180)
  readonly target = TARGET.clone()
  width = 1200
  height = 700
  private span = 31
  private centerX = 4
  private resting = true

  constructor() { this.reset(); this.resize(this.width, this.height) }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this.width = width
    this.height = height
    const aspect = width / height
    if (this.resting) this.place()
    let horizontal = 0
    for (const side of [-1, 1]) for (const z of [TRAY.minZ, TRAY.maxZ]) {
      const corner = new Vector3(this.centerX + side * this.span / 2, -2, z).applyMatrix4(this.camera.matrixWorldInverse)
      horizontal = Math.max(horizontal, Math.abs(corner.x))
    }
    const halfHeight = Math.max(12.4, horizontal * 1.07 / aspect)
    this.camera.left = -halfHeight * aspect
    this.camera.right = halfHeight * aspect
    this.camera.top = halfHeight
    this.camera.bottom = -halfHeight
    this.camera.updateProjectionMatrix()
  }

  reset(): void {
    this.resting = true
    this.target.copy(TARGET)
    this.target.x = this.centerX
    this.camera.zoom = 1
    this.place()
    this.resize(this.width, this.height)
  }

  setBounds(minX: number, maxX: number): void {
    this.span = maxX - minX
    this.centerX = (minX + maxX) / 2
    this.resize(this.width, this.height)
  }

  zoom(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return
    this.resting = false
    this.camera.zoom = Math.min(CAMERA_LIMITS.maxZoom, Math.max(CAMERA_LIMITS.minZoom, this.camera.zoom * factor))
    this.camera.updateProjectionMatrix()
  }

  interact(): void { this.resting = false }

  private place(): void {
    const direction = this.width / this.height < 0.8 ? new Vector3(38, 42, 3) : new Vector3(25, 23, 30)
    this.camera.position.copy(direction.normalize().multiplyScalar(48)).add(this.target)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.target)
    this.camera.updateMatrixWorld()
  }

  project(position: Position, target = new Vector3()): Vector3 {
    target.set(position.x, position.y, position.z).project(this.camera)
    target.x = (target.x + 1) * this.width / 2
    target.y = (1 - target.y) * this.height / 2
    return target
  }
}
