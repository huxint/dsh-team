import {
  BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, ShaderMaterial, Uniform, Vector3,
} from 'three'
import { FLOOR_HEIGHT, LAND, POOL, POOL_LEVEL, SEA_LEVEL, TRAY } from './layout.ts'
import type { WorldSimulation } from './simulation.ts'
import { MovingVoxels, Voxels } from './voxels.ts'
import { daylight } from './daylight.ts'

function water(rectangles: readonly (readonly [number, number, number, number])[], level: number, pool: boolean): Mesh<BufferGeometry, ShaderMaterial> {
  const positions: number[] = []
  for (const [x1, x2, z1, z2] of rectangles) positions.push(x1, level, z1, x1, level, z2, x2, level, z2, x1, level, z1, x2, level, z2, x2, level, z1)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { time: new Uniform(0), daylight: new Uniform(1), pool: new Uniform(pool ? 1 : 0) },
    vertexShader: `
      varying vec3 world;
      void main() {
        world = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float daylight;
      uniform float pool;
      varying vec3 world;
      void main() {
        vec2 p = world.xz;
        float swell = sin(p.x * 1.8 + p.y * 1.1 + time * 0.8) * sin(p.y * 2.1 - time * 0.6);
        float caustic = pow(max(0.0, sin(p.x * 6.0 + sin(p.y * 3.0 + time)) * sin(p.y * 5.0 - time * 0.7)), 12.0);
        float glint = pow(max(0.0, sin(p.x * 3.0 + p.y * 4.0 + time) * sin(p.x * 1.4 - p.y * 2.0 - time * 0.5)), 28.0);
        vec3 deep = mix(vec3(0.19, 0.57, 0.61), vec3(0.26, 0.68, 0.72), pool);
        vec3 c = deep + swell * 0.035 + caustic * 0.15 + glint * 0.24;
        c *= mix(vec3(0.28, 0.43, 0.65), vec3(1.0), daylight);
        gl_FragColor = vec4(c, mix(0.93, 0.70, pool));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = pool ? 'pool-water' : 'sea-water'
  mesh.renderOrder = 3
  return mesh
}

export class Environment {
  readonly group = new Group()
  sea = water([[TRAY.minX + 0.1, LAND.minX, TRAY.minZ + 0.1, TRAY.maxZ - 0.1], [LAND.maxX, TRAY.maxX - 0.1, TRAY.minZ + 0.1, TRAY.maxZ - 0.1], [LAND.minX, LAND.maxX, TRAY.minZ + 0.1, LAND.minZ], [LAND.minX, LAND.maxX, LAND.maxZ, TRAY.maxZ - 0.1]], SEA_LEVEL, false)
  readonly pool = water([[POOL.minX + 0.08, POOL.maxX - 0.08, POOL.minZ + 0.08, POOL.maxZ - 0.08]], POOL_LEVEL, true)
  readonly moving = new MovingVoxels(900, 'island-life')
  readonly glass = new MovingVoxels(20, 'lift-glass', new MeshBasicMaterial({ color: '#c3e4dd', transparent: true, opacity: 0.18, depthWrite: false }))
  readonly sky = new MovingVoxels(250, 'sky', new MeshBasicMaterial())
  private readonly boat = new Object3D()
  private readonly frame = new Matrix4()
  private oceanMinX = TRAY.minX

  constructor() {
    const windows = new Voxels()
    for (const x of [7.3, 8.7]) windows.box(x, 2.2, -2, 0.04, 4.3, 1.42, '#c4e5dc')
    windows.box(8, 2.2, -2.7, 1.42, 4.3, 0.04, '#c4e5dc')
    const glazing = windows.build('lift-windows', new MeshBasicMaterial({ transparent: true, opacity: 0.13, depthWrite: false }))
    glazing.castShadow = false
    glazing.receiveShadow = false
    this.glass.mesh.castShadow = false
    this.glass.mesh.renderOrder = 4
    this.sky.mesh.castShadow = false
    this.sky.mesh.receiveShadow = false
    this.group.add(this.sea, this.pool, this.moving.mesh, this.glass.mesh, this.sky.mesh, glazing)
  }

  setBounds(minX: number): void {
    if (minX === this.oceanMinX) return
    this.oceanMinX = minX
    this.sea.removeFromParent()
    this.sea.geometry.dispose()
    this.sea.material.dispose()
    this.sea = water([[minX + 0.1, LAND.minX, TRAY.minZ + 0.1, TRAY.maxZ - 0.1], [LAND.maxX, TRAY.maxX - 0.1, TRAY.minZ + 0.1, TRAY.maxZ - 0.1], [LAND.minX, LAND.maxX, TRAY.minZ + 0.1, LAND.minZ], [LAND.minX, LAND.maxX, LAND.maxZ, TRAY.maxZ - 0.1]], SEA_LEVEL, false)
    this.group.add(this.sea)
  }

  update(simulation: WorldSimulation, cutaway: boolean): void {
    const time = simulation.seconds
    const light = daylight(simulation.hour)
    for (const surface of [this.sea, this.pool]) {
      surface.material.uniforms.time!.value = time
      surface.material.uniforms.daylight!.value = light.light
    }
    const v = this.moving
    v.begin()
    const lift = simulation.elevator
    v.box(undefined, 8, lift.y - 0.065, -2, 1.34, 0.13, 1.34, '#6b9892')
    v.box(undefined, 8, lift.y + 1.13, -2, 1.34, 0.1, 1.34, '#deebdc')
    v.box(undefined, 8, lift.y + 0.62, -2.64, 1.25, 1.18, 0.055, '#90b7ab')
    v.box(undefined, 8, lift.y + 0.58, -2.58, 1.2, 0.035, 0.07, '#f8ecd1')
    v.box(undefined, 8, (lift.y + 1.2 + 4.45) / 2, -2.5, 0.025, Math.max(0.01, 4.45 - lift.y - 1.2), 0.025, '#5f6f6d')
    this.glass.begin()
    for (const y of [0, FLOOR_HEIGHT]) {
      const open = Math.abs(lift.y - y) < 0.05 ? lift.doors : 0
      for (const side of [-1, 1]) {
        const x = 8 + side * (0.33 + open * 0.57)
        this.glass.box(undefined, x, y + 0.55, -1.285, 0.64, 1.08, 0.06, '#c2e6db')
        v.box(undefined, x + side * 0.3, y + 0.55, -1.275, 0.035, 1.08, 0.065, '#64928b')
      }
    }
    this.glass.end()
    for (const actor of simulation.residents.values()) {
      if (actor.motion === 'play') {
        const bounce = (time * 1.3 + actor.phase) % 1
        const height = 0.19 + 1.84 * bounce * (1 - bounce)
        v.box(undefined, actor.position.x - 0.43, actor.position.y + height, actor.position.z - 0.12, 0.24, 0.24, 0.24, '#cc8c58', 0, time * 2)
        v.box(undefined, actor.position.x - 0.43, actor.position.y + height + 0.125, actor.position.z - 0.12, 0.035, 0.012, 0.245, '#785b46', 0, time * 2)
      }
      if (actor.motion === 'garden') {
        for (let drop = 0; drop < 5; drop += 1) {
          const age = (time * 4 + drop / 5) % 1
          v.box(undefined, actor.position.x - 0.65 - age * 0.3, 0.72 - age * age * 0.23, actor.position.z + 0.27 + Math.sin(drop) * 0.025, 0.03, 0.04, 0.03, '#a4d8d6')
        }
      }
      if (actor.motion !== 'pool' && actor.motion !== 'sea' && actor.motion !== 'swim') continue
      for (let i = 0; i < 7; i += 1) {
        const angle = i * Math.PI * 2 / 7
        const spread = 0.32 + (time * 0.55 + i * 0.09) % 0.75
        v.box(undefined, actor.position.x + Math.sin(angle) * spread, actor.position.y + 0.018, actor.position.z + Math.cos(angle) * spread,
          0.1, 0.018, 0.06, '#c6e9e3', 0, angle)
      }
    }
    if (!cutaway) for (let lane = 0; lane < 2; lane += 1) {
      const running = [...simulation.residents.values()].some(actor => actor.motion === 'run' && actor.destination.id === `run-${lane}`)
      for (let i = 0; i < 8; i += 1) {
        const shift = running ? time * 1.3 : 0
        v.box(undefined, 4 + lane * 2, FLOOR_HEIGHT + 0.24, -5.08 + (i * 0.2 + shift) % 1.55, 0.78, 0.018, 0.025, '#81908e')
      }
    }
    for (let i = 0; i < 35; i += 1) {
      const x = -9 + i * 0.76
      if (x > 4.5 && x < 6.5) continue
      v.box(undefined, x, SEA_LEVEL + 0.023, 7.43 + Math.sin(time * 0.55 + i * 0.3) * 0.08, 0.4 + Math.sin(time + i) * 0.1, 0.02, 0.035, '#b1d8cc')
    }
    this.boat.position.set(2.9, SEA_LEVEL + 0.04 + Math.sin(time * 0.7) * 0.035, 8.7)
    this.boat.rotation.set(0, -0.24, Math.sin(time * 0.75) * 0.025)
    this.boat.updateMatrix()
    this.frame.copy(this.boat.matrix)
    v.box(this.frame, 0, 0, 0, 0.7, 0.19, 1.5, '#d78c76')
    v.box(this.frame, 0, 0.12, 0, 0.9, 0.13, 1.8, '#f1dfc5')
    v.box(this.frame, 0, 0.21, 0, 0.61, 0.09, 1.32, '#7faaa3')
    for (const z of [-0.45, 0.35]) v.box(this.frame, 0, 0.27, z, 0.68, 0.09, 0.2, '#dab389')
    v.box(this.frame, 0, 1.02, -0.2, 0.065, 1.6, 0.065, '#ad815c')
    for (let i = 0; i < 7; i += 1) v.box(this.frame, 0.04, 0.62 + i * 0.15, -0.22 + (7 - i) * 0.052, 0.045, 0.15, (7 - i) * 0.104, i < 2 ? '#d7907f' : '#fff3db')
    for (let i = 0; i < 3; i += 1) {
      const angle = time * 0.12 + i * 2.3
      const x = Math.sin(angle) * (8 + i * 1.5)
      const z = -5 + Math.cos(angle) * 5
      const y = 6.1 + Math.sin(time * 0.4 + i) * 0.18 + i * 0.4
      v.box(undefined, x, y, z, 0.12, 0.1, 0.28, '#f8eedc', 0, -angle)
      for (const side of [-1, 1]) v.box(undefined, x + side * 0.22, y + Math.sin(time * 4 + i) * 0.05, z, 0.34, 0.045, 0.14, '#f8eedc', 0, -angle, side * Math.sin(time * 4 + i) * 0.18)
    }
    for (let i = 0; i < 5; i += 1) {
      const age = (time * 0.4 + i * 0.2) % 1
      v.box(undefined, 10.6 + age * 0.3, 1.05 + age * 1.45, 5.01 + Math.sin(age * 3) * 0.1, 0.11 + age * 0.1, 0.11 + age * 0.1, 0.11 + age * 0.1, light.night ? '#607575' : '#c2c7b7')
    }
    if (light.light < 0.6 || simulation.occupancy('camp') > 0) {
      for (let i = 0; i < 6; i += 1) {
        const angle = i * Math.PI / 3
        const height = 0.22 + (Math.sin(time * 6 + i * 3) + 1) * 0.12
        v.box(undefined, 13.3 + Math.sin(angle) * 0.15, 0.32 + height / 2, 5.18 + Math.cos(angle) * 0.15, 0.12, height, 0.12, i % 2 ? '#e6ac54' : '#c97849')
      }
    }
    v.end()
    this.sky.begin()
    const celestial = (position: Vector3, moon: boolean): void => {
      if (position.y < -0.5) return
      const size = moon ? 0.36 : 0.46
      for (let x = -2; x <= 2; x += 1) {
        for (let y = -2; y <= 2; y += 1) {
          for (let z = -2; z <= 2; z += 1) {
            if (x * x + y * y + z * z > 6) continue
            const paint = moon ? (z === 2 && (x + y) % 3 === 0 ? '#c9d5ce' : '#ece9cb') : y > 0 ? '#f5d795' : '#edc47c'
            this.sky.box(undefined, position.x * 0.7 + x * size, position.y * 0.21 + 1.2 + y * size, -9.5 + z * size, size, size, size, paint)
          }
        }
      }
    }
    celestial(light.sun, false)
    celestial(light.moon, true)
    if (light.light < 0.4) for (let i = 0; i < 48; i += 1) {
      const x = Math.sin(i * 127.1) * 24
      const y = 6 + (Math.sin(i * 311.7) * 0.5 + 0.5) * 15
      const z = -16 - (i % 5)
      const size = 0.035 + (i % 3) * 0.014
      this.sky.box(undefined, x, y, z, size, size, size, '#b5d4dd')
    }
    for (let cloud = 0; cloud < 3; cloud += 1) {
      const x = -12 + cloud * 10 + Math.sin(time * 0.016 + cloud) * 0.6
      for (let puff = 0; puff < 4; puff += 1) this.sky.box(undefined, x + puff * 0.65, 7.3 + cloud * 0.8 + (puff % 2) * 0.18, -7.5 - cloud * 2, 1.1, 0.5 + (puff % 2) * 0.2, 0.8, light.night ? '#385167' : '#f4f3e5')
    }
    this.sky.end()
  }
}
