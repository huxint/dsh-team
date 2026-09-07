import { Matrix4, Object3D, type Raycaster } from 'three'
import { appearance } from './appearance.ts'
import { stairHeight } from './layout.ts'
import type { Resident } from './simulation.ts'
import { MovingVoxels } from './voxels.ts'

const root = new Object3D()
const bone = new Object3D()
const joint = new Matrix4()

export class Characters {
  readonly voxels = new MovingVoxels(65 * 64, 'residents')
  private readonly ranges: { id: string; start: number; end: number }[] = []

  draw(residents: ReadonlyMap<string, Resident>, time: number, selected: string | undefined, focus: string | undefined, floor: 'all' | 'ground' | 'terrace'): void {
    const v = this.voxels
    v.begin()
    this.ranges.length = 0
    for (const actor of residents.values()) {
      if (floor === 'ground' && actor.position.y >= 2.9) continue
      const clothes = appearance(actor.member.seat)
      const swim = actor.motion === 'pool' || actor.motion === 'sea' || actor.motion === 'swim'
      const seated = actor.motion === 'work' || actor.motion === 'relax' || actor.motion === 'camp' || actor.motion === 'read'
      const run = actor.motion === 'run'
      const walking = actor.motion === 'walk' || actor.motion === 'stairs' || actor.motion === 'ladder'
      const stride = (time * (run ? 13 : 7) + actor.phase)
      const gait = Math.sin(stride) * (run ? 0.85 : walking ? 0.5 : 0)
      const hip = seated ? 0.59 : 0.46
      const bodyY = seated ? 0.87 : 0.71
      const headY = seated ? 1.27 : 1.11
      root.position.set(actor.position.x, actor.position.y + (swim ? 0.12 : 0), actor.position.z)
      if (swim) {
        root.position.x -= Math.sin(actor.facing) * 0.5
        root.position.z -= Math.cos(actor.facing) * 0.5
      }
      root.rotation.set(0, actor.facing, 0)
      root.rotateX(swim ? Math.PI / 2 : 0)
      root.scale.setScalar(1)
      root.updateMatrix()
      const parent = root.matrix
      const start = v.box(parent, 0, bodyY, 0, 0.4, 0.42, 0.26, swim ? clothes.skin : clothes.shirt)
      v.box(parent, 0, hip, 0, 0.33, 0.15, 0.27, swim ? clothes.shirt : clothes.trousers)
      v.box(parent, 0, bodyY + 0.23, 0, 0.14, 0.09, 0.14, clothes.skin)
      v.box(parent, 0, headY, 0.025, 0.43, 0.4, 0.38, clothes.skin)
      v.box(parent, 0, headY + 0.205, 0.005, 0.45, 0.1, 0.4, clothes.hair)
      v.box(parent, 0, headY + 0.025, -0.172, 0.44, 0.34, 0.06, clothes.hair)
      v.box(parent, -0.13, headY + 0.14, 0.206, 0.2, 0.13, 0.06, clothes.hair)
      for (const side of [-1, 1]) {
        v.box(parent, side * 0.233, headY - 0.025, 0.03, 0.05, 0.115, 0.12, clothes.skin)
        v.box(parent, side * 0.091, headY + 0.015, 0.222, 0.042, 0.06, 0.028, '#273b41')
        v.box(parent, side * 0.092, headY + 0.034, 0.239, 0.014, 0.018, 0.008, '#fff9ed')
        v.box(parent, side * 0.137, headY - 0.067, 0.218, 0.052, 0.027, 0.014, '#df9c87')
      }
      v.box(parent, 0, headY - 0.066, 0.237, 0.054, 0.04, 0.04, clothes.skin)
      v.box(parent, 0, headY - 0.12, 0.222, 0.061, 0.018, 0.015, '#955f52')
      if (!swim && clothes.hat) {
        v.box(parent, 0, headY + 0.295, 0, 0.43, 0.1, 0.39, clothes.trim)
        v.box(parent, 0, headY + 0.22, 0.1, 0.55, 0.065, 0.55, clothes.trim)
      }
      if (clothes.glasses || swim) {
        for (const side of [-1, 1]) {
          v.box(parent, side * 0.096, headY + 0.014, 0.234, 0.15, 0.102, 0.035, swim ? clothes.shirt : '#35484b')
          v.box(parent, side * 0.096, headY + 0.014, 0.257, 0.104, 0.057, 0.012, swim ? '#b4e4df' : '#bed6cf')
        }
        v.box(parent, 0, headY + 0.015, 0.251, 0.06, 0.025, 0.026, '#35484b')
      }
      if (!swim) {
        v.box(parent, 0, bodyY + 0.09, 0.138, 0.055, 0.25, 0.025, clothes.trim)
        v.box(parent, 0.11, bodyY + 0.05, 0.144, 0.08, 0.07, 0.022, clothes.trim)
        v.box(parent, 0, hip + 0.073, 0.147, 0.08, 0.055, 0.022, '#d4bd8e')
      }
      for (const side of [-1, 1]) {
        const swing = swim ? Math.sin(time * 4.5 + actor.phase + side * Math.PI / 2) * 0.3 : side * gait
        bone.position.set(side * 0.103, hip, 0)
        bone.rotation.set(seated ? -Math.PI / 2 : swing, 0, 0)
        bone.scale.setScalar(1)
        bone.updateMatrix()
        joint.multiplyMatrices(parent, bone.matrix)
        if (seated) {
          v.box(joint, 0, -0.12, 0, 0.145, 0.24, 0.17, clothes.trousers)
          v.box(parent, side * 0.103, hip - 0.265, 0.24, 0.14, 0.51, 0.16, clothes.trousers)
          v.box(parent, side * 0.103, hip - 0.53, 0.285, 0.18, 0.1, 0.26, '#f4ead6')
        } else if (swim) {
          v.box(joint, 0, -0.12, 0, 0.145, 0.24, 0.17, clothes.shirt)
          v.box(joint, 0, -0.325, 0, 0.135, 0.18, 0.155, clothes.skin)
          v.box(joint, 0, -0.41, 0.048, 0.175, 0.09, 0.24, clothes.skin)
        } else {
          const phase = stride + (side === 1 ? Math.PI : 0)
          const footZ = walking || run ? Math.cos(phase) * (run ? 0.21 : 0.18) : 0
          const lift = walking || run ? Math.max(0, -Math.sin(phase)) * (run ? 0.17 : 0.1) : 0
          const worldX = actor.position.x + Math.sin(actor.facing) * footZ + Math.cos(actor.facing) * side * 0.103
          const worldZ = actor.position.z + Math.cos(actor.facing) * footZ - Math.sin(actor.facing) * side * 0.103
          const tread = actor.motion === 'stairs' && worldX > 0.75 && worldX < 2.25 && worldZ < -0.5 && worldZ > -6
            ? Math.max(actor.position.y - 0.06, stairHeight(worldZ)) - actor.position.y : 0
          const ankleY = 0.095 + lift + tread
          const dy = ankleY - hip
          const length = Math.max(0.01, Math.hypot(dy, footZ))
          const along = (0.23 ** 2 - 0.22 ** 2 + length ** 2) / (2 * length)
          const bend = Math.sqrt(Math.max(0, 0.23 ** 2 - along ** 2))
          const kneeY = hip + dy / length * along + footZ / length * bend
          const kneeZ = footZ / length * along - dy / length * bend
          v.box(parent, side * 0.103, (hip + kneeY) / 2, kneeZ / 2, 0.145, 0.23, 0.17, clothes.trousers, -Math.atan2(kneeZ, hip - kneeY))
          v.box(parent, side * 0.103, (kneeY + ankleY) / 2, (kneeZ + footZ) / 2, 0.135, 0.22, 0.155, clothes.trousers, -Math.atan2(footZ - kneeZ, kneeY - ankleY))
          v.box(parent, side * 0.103, ankleY - 0.035, footZ + 0.035, 0.175, 0.09, 0.24, '#f4ead6')
          v.box(parent, side * 0.103, ankleY - 0.075, footZ + 0.04, 0.18, 0.02, 0.245, '#acaf9f')
        }
        const typing = actor.motion === 'work' && actor.member.running ? Math.sin(time * 10 + side) * 0.08 : 0
        const eating = actor.motion === 'snack' && side === 1
        const waving = actor.motion === 'talk' && side === -1
        const gardening = actor.motion === 'garden' && side === 1
        const dribbling = actor.motion === 'play' && side === 1
        const armAngle = swim ? -Math.PI / 2 + Math.sin(time * 4 + side * Math.PI / 2) * 1.2
          : eating ? -2.35 + Math.sin(time * 2.2) * 0.2
          : gardening ? -1.05
          : dribbling ? -0.3 - Math.sin(time * 8.17 + actor.phase) * 0.5
          : actor.motion === 'read' ? -1.25
          : seated ? (actor.motion === 'work' ? -1.35 + typing : -0.3)
          : waving ? -1.3 + Math.sin(time * 3) * 0.25
          : -side * gait * 0.8 - (run ? 0.5 : 0)
        bone.position.set(side * 0.27, bodyY + 0.15, 0)
        bone.rotation.set(armAngle, 0, swim ? side * 0.24 : side * 0.06)
        bone.updateMatrix()
        joint.multiplyMatrices(parent, bone.matrix)
        v.box(joint, 0, -0.1, 0, 0.135, 0.24, 0.17, swim ? clothes.skin : clothes.shirt)
        v.box(joint, 0, -0.27, 0, 0.112, 0.14, 0.125, clothes.skin)
        v.box(joint, 0, -0.355, 0.015, 0.13, 0.11, 0.14, clothes.skin)
        if (eating) {
          v.box(joint, 0, -0.43, 0.04, 0.18, 0.13, 0.16, '#e3b771')
          v.box(joint, 0, -0.42, 0.12, 0.18, 0.025, 0.015, '#719865')
        }
        if (gardening) {
          v.box(joint, 0, -0.43, 0.02, 0.23, 0.24, 0.22, '#689ea0')
          v.box(joint, 0, -0.54, 0.14, 0.08, 0.14, 0.21, '#91bdb2')
        }
      }
      if (actor.motion === 'read') {
        v.box(parent, 0, 0.91, 0.32, 0.42, 0.04, 0.25, clothes.shirt, -0.45)
        v.box(parent, 0, 0.932, 0.32, 0.37, 0.02, 0.23, '#f3e8c9', -0.45)
      }
      if (selected === actor.member.id || focus === actor.member.id) {
        const y = actor.position.y + 0.025
        const paint = selected === actor.member.id ? '#f4ca79' : '#bce5d5'
        for (const side of [-1, 1]) {
          for (const end of [-1, 1]) {
            v.box(undefined, actor.position.x + side * 0.38, y, actor.position.z + end * 0.31, 0.06, 0.04, 0.2, paint)
            v.box(undefined, actor.position.x + side * 0.31, y, actor.position.z + end * 0.38, 0.2, 0.04, 0.06, paint)
          }
        }
      }
      this.ranges.push({ id: actor.member.id, start, end: v.count })
    }
    v.end()
  }

  pick(ray: Raycaster): { id: string; distance: number } | undefined {
    const hit = ray.intersectObject(this.voxels.mesh)[0]
    if (hit?.instanceId === undefined) return undefined
    const id = this.ranges.find(range => hit.instanceId! >= range.start && hit.instanceId! < range.end)?.id
    return id === undefined ? undefined : { id, distance: hit.distance }
  }
}
