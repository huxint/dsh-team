import { Color, Matrix4 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MovingVoxels } from '../src/client/world/voxels.ts'
import { disposeObjects } from '../src/client/world/renderer.ts'

describe('animated voxel buffers', () => {
  it('uploads only used matrices and changed colors, including mutable Color objects', () => {
    const voxels = new MovingVoxels(1000, 'test')
    const color = new Color('red')
    const draw = (x: number) => {
      voxels.begin()
      voxels.box(undefined, x, 0, 0, 1, 1, 1, color)
      voxels.end()
    }
    draw(0)
    const version = voxels.mesh.instanceColor!.version
    // Rendering normally consumes and clears these ranges.
    voxels.mesh.instanceMatrix.clearUpdateRanges()
    voxels.mesh.instanceColor!.clearUpdateRanges()
    draw(2)
    expect(voxels.mesh.instanceColor!.version).toBe(version)
    expect(voxels.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }])
    const matrix = new Matrix4()
    voxels.mesh.getMatrixAt(0, matrix)
    expect(matrix.elements[12]).toBe(2)
    color.set('blue')
    draw(3)
    const actual = new Color()
    voxels.mesh.getColorAt(0, actual)
    expect(actual.equals(color)).toBe(true)
    expect(voxels.mesh.instanceColor!.version).toBeGreaterThan(version)
    expect(voxels.mesh.count).toBe(1)
    disposeObjects(voxels.mesh)
  })

  it('releases instance buffers as well as geometry and material', () => {
    const voxels = new MovingVoxels(1000, 'test')
    const release = vi.fn()
    voxels.mesh.addEventListener('dispose', release)
    disposeObjects(voxels.mesh)
    expect(release).toHaveBeenCalledOnce()
  })
})
