import { describe, expect, it } from 'vitest'
import { Box3, BoxGeometry, Color, DirectionalLight, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3, WebGLRenderTarget } from 'three'
import { toPlan } from '../src/client/stagecraft.ts'
import { deskOf, footprintOf } from '../src/client/room.ts'
import { Office } from '../src/client/scene/office.ts'
import { mix, paletteOf, parseColor, type Tokens } from '../src/client/scene/palette.ts'
import { buildShell } from '../src/client/scene/shell.ts'
import { Shop } from '../src/client/scene/kit.ts'
import type { StationSpec } from '../src/client/scene/workstation.ts'
import { batchMeshes } from '../src/client/scene/batching.ts'

const tokens: Tokens = {
  page: new Color('#fff'), ink: new Color('#0f1115'), hue: new Color('#4176e6'),
  warm: new Color('#f59e0b'), leaf: new Color('#22c55e'), error: new Color('#ec1313'),
}
const palette = paletteOf(tokens)
const station = (id: string, index = 0, count = 3): StationSpec => ({
  id, seat: index - 1, desk: deskOf(index, count), app: 'code', screen: 'working', empty: false,
})

describe('scene colour', () => {
  it('mixes tokens in sRGB to match the CSS crew', () => {
    expect(mix(new Color('#000'), new Color('#fff'), 0.5).getHexString()).toBe('808080')
  })

  it('reads modern percentage RGB theme tokens', () => {
    expect(parseColor('rgb(100% 0% 50% / 0.9)')?.getHexString()).toBe('ff0080')
  })

  it('rejects malformed colours so the caller can report a missing theme', () => {
    expect(parseColor('#12')).toBeUndefined()
    expect(parseColor('rgb(1 2)')).toBeUndefined()
    expect(parseColor('var(--missing)')).toBeUndefined()
  })

  it('selects evening lighting for a dark shell', () => {
    const evening = paletteOf({ ...tokens, page: new Color('#151517'), ink: new Color('#e1e5ee') })
    expect(evening.dark).toBe(true)
    expect(palette.dark).toBe(false)
    expect(evening.skyTop.getHex()).not.toBe(palette.skyTop.getHex())
  })
})

describe('office geometry', () => {
  it('batches nested furniture while preserving its world position and size', () => {
    const group = new Group()
    group.position.set(10, 1, 0)
    group.scale.setScalar(2)
    const pivot = new Group()
    pivot.position.x = -1
    pivot.rotation.z = Math.PI / 2
    const paint = new MeshBasicMaterial()
    pivot.add(new Mesh(new BoxGeometry(2, 1, 1), paint))
    group.add(pivot)
    const right = new Mesh(new BoxGeometry(1, 1, 1), paint)
    right.position.x = 2
    group.add(right)

    batchMeshes(group)
    const bounds = new Box3().setFromObject(group)
    expect(bounds.min.toArray()).toEqual([7, -1, -1])
    expect(bounds.max.toArray()).toEqual([15, 3, 1])
    expect(group.children.filter(child => child instanceof Mesh)).toHaveLength(1)
  })

  it('shows the sky through a real opening in the back wall', () => {
    const shop = new Shop(palette, false)
    const shell = buildShell(shop)
    shell.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(-1.05, 1.4, 2), new Vector3(0, 0, -1))
    ray.layers.enableAll()
    expect(ray.intersectObject(shell)[0]?.object.name).toBe('sky')
    shop.dispose()
  })

  it('keeps the desk inside the floor footprint that walking routes avoid', () => {
    const office = new Office(palette, { paint: false, still: true })
    const spec = station('alice')
    office.setStations([spec])
    office.scene.updateMatrixWorld(true)
    const desk = office.scene.getObjectByName('station:alice')!.getObjectByName('desk')!
    const bounds = new Box3().setFromObject(desk)
    const footprint = footprintOf(spec.desk)
    const back = toPlan(bounds.min).y
    const front = toPlan(bounds.max).y
    expect(back).toBeGreaterThanOrEqual(footprint.y)
    expect(front).toBeLessThanOrEqual(footprint.y + footprint.h)
    office.dispose()
  })

  it('releases workstation materials when a teammate leaves', () => {
    const office = new Office(palette, { paint: false, still: true })
    office.setStations([station('alice')])
    const chair = office.scene.getObjectByName('station:alice')!.getObjectByName('chairBack') as Mesh
    const material = Array.isArray(chair.material) ? chair.material[0]! : chair.material
    let disposals = 0
    material.addEventListener('dispose', () => { disposals += 1 })
    office.setStations([])
    expect(disposals).toBe(1)
    office.dispose()
  })

  it('releases shadow render targets when the room is unmounted', () => {
    const office = new Office(palette, { paint: false, still: true })
    let light: DirectionalLight | undefined
    office.scene.traverse(object => { if (object instanceof DirectionalLight && object.castShadow) light = object })
    const map = new WebGLRenderTarget(2, 2)
    light!.shadow.map = map
    let disposals = 0
    map.addEventListener('dispose', () => { disposals += 1 })
    office.dispose()
    expect(disposals).toBe(1)
  })
})
