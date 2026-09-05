import { Group, Mesh } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Apply to static subtrees after placement. Named meshes keep their scene identity.
export function batchMeshes(group: Group): void {
  group.updateWorldMatrix(true, true)
  const inverse = group.matrixWorld.clone().invert()
  const batches = new Map<string, Mesh[]>()
  group.traverse(object => {
    if (!(object instanceof Mesh) || object.name !== '' || object.children.length > 0) return
    const material = object.material
    if (Array.isArray(material) || material.transparent) return
    const key = [material.id, object.layers.mask, object.castShadow, object.receiveShadow,
      object.renderOrder, Object.keys(object.geometry.attributes).sort().join(',')].join('|')
    const batch = batches.get(key)
    if (batch === undefined) batches.set(key, [object])
    else batch.push(object)
  })

  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue
    const geometries = meshes.map(mesh => {
      const geometry = mesh.geometry.index === null ? mesh.geometry.clone() : mesh.geometry.toNonIndexed()
      return geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld))
    })
    const geometry = mergeGeometries(geometries)
    for (const part of geometries) part.dispose()
    if (geometry === null) throw new Error('Unable to batch the office geometry')
    const first = meshes[0]!
    const batch = new Mesh(geometry, first.material)
    batch.layers.mask = first.layers.mask
    batch.castShadow = first.castShadow
    batch.receiveShadow = first.receiveShadow
    batch.renderOrder = first.renderOrder
    group.add(batch)
    for (const mesh of meshes) {
      mesh.removeFromParent()
      mesh.geometry.dispose()
    }
  }
}
