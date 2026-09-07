import {
  ACESFilmicToneMapping, BasicShadowMap, Color, DirectionalLight, Fog, HemisphereLight, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  PCFSoftShadowMap, PlaneGeometry, PointLight, Raycaster, Scene, ShadowMaterial, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer,
  type BufferGeometry, type Object3D,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Characters } from './characters.ts'
import { CAMERA_LIMITS, WorldCamera } from './camera.ts'
import { daylight, skyColor } from './daylight.ts'
import { Environment } from './environment.ts'
import { createIsland, type Island } from './island.ts'
import type { Position } from './layout.ts'
import { WorldSimulation, type WorldMember } from './simulation.ts'

export interface WorldStats { fps: number; frameMs: number; cpuMs: number; calls: number; triangles: number; pixelRatio: number }
export type FloorView = 'all' | 'ground' | 'terrace'

export function disposeObjects(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse(object => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
}

export class WorldRenderer {
  readonly scene = new Scene()
  readonly view = new WorldCamera()
  readonly simulation: WorldSimulation
  readonly renderer: WebGLRenderer
  readonly controls: OrbitControls
  readonly characters = new Characters()
  readonly environment = new Environment()
  readonly sun = new DirectionalLight('#fff0d0', 3)
  readonly ambient = new HemisphereLight('#e2ede0', '#aa9e88', 2.4)
  private readonly firelight = new PointLight('#ffb961', 0, 7, 2)
  private readonly cafeLight = new PointLight('#ffd6a0', 0, 8, 2)
  island: Island
  floor: FloorView = 'all'
  selected: string | undefined
  focus: string | undefined
  speed = 1
  playing = true
  visible = true
  reducedMotion = false
  contextLost = false
  stats: WorldStats = { fps: 0, frameMs: 0, cpuMs: 0, calls: 0, triangles: 0, pixelRatio: 1.5 }
  onFrame: (() => void) | undefined
  onStats: (() => void) | undefined
  private frame: number | undefined
  private lastFrame = 0
  private lastReport = 0
  private frames = 0
  private frameTimes: number[] = []
  private cpuTimes: number[] = []
  private readonly backdrop = new Color()
  private readonly table = new Mesh(new PlaneGeometry(250, 250), new MeshBasicMaterial({ color: '#dfeae4' }))
  private readonly shadowFloor = new Mesh(new PlaneGeometry(48, 40), new ShadowMaterial({ color: '#233b39', opacity: 0.23 }))
  private readonly ray = new Raycaster()
  private readonly pointer = new Vector2()
  private down: { x: number; y: number } | undefined
  private rosterKey: string
  private disposed = false
  private lastQualityChange = 0
  private lastShadow = 0

  constructor(readonly canvas: HTMLCanvasElement, members: readonly WorldMember[], onSelect: (id: string) => void, onHover: (id: string | undefined) => void) {
    this.simulation = new WorldSimulation(members)
    this.rosterKey = members.map(member => member.id).join('\0')
    this.island = createIsland(this.simulation.stations)
    this.environment.setBounds(this.island.minX)
    this.view.setBounds(this.island.minX, this.island.maxX)
    this.view.reset()
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    Object.assign(this.sun.shadow.camera, { left: -21, right: 21, top: 21, bottom: -21, near: 1, far: 75 })
    this.sun.shadow.bias = -0.00035
    this.sun.shadow.normalBias = 0.035
    this.sun.shadow.radius = 2
    this.sun.target.position.set(0, 0, 0)
    this.table.rotation.x = -Math.PI / 2
    this.table.position.y = -2.085
    this.shadowFloor.rotation.x = -Math.PI / 2
    this.shadowFloor.position.set(4, -2.078, 0)
    this.shadowFloor.receiveShadow = true
    this.firelight.position.set(13.3, 1.25, 5.18)
    this.cafeLight.position.set(5.1, 2.7, -3.3)
    this.scene.add(this.table, this.shadowFloor, this.island.group, this.characters.voxels.mesh, this.environment.group, this.sun, this.sun.target, this.ambient, this.firelight, this.cafeLight)
    this.scene.fog = new Fog('#dfeae4', 65, 145)
    this.controls = new OrbitControls(this.view.camera, canvas)
    this.controls.target.copy(this.view.target)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.minPolarAngle = CAMERA_LIMITS.minPolar
    this.controls.maxPolarAngle = CAMERA_LIMITS.maxPolar
    this.controls.minZoom = CAMERA_LIMITS.minZoom
    this.controls.maxZoom = CAMERA_LIMITS.maxZoom
    this.controls.rotateSpeed = 0.65
    this.controls.zoomSpeed = 0.85
    this.controls.screenSpacePanning = false
    this.controls.addEventListener('change', this.invalidate)
    this.controls.addEventListener('start', () => { this.view.interact(); this.invalidate() })
    const pointers = new Set<number>()
    const down = (event: PointerEvent): void => {
      pointers.add(event.pointerId)
      this.down = pointers.size === 1 ? { x: event.clientX, y: event.clientY } : undefined
    }
    const up = (event: PointerEvent): void => {
      pointers.delete(event.pointerId)
      if (this.down === undefined || event.button !== 0) return
      const delta = Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y)
      this.down = undefined
      if (delta > 5) return
      const rect = canvas.getBoundingClientRect()
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2)
      this.ray.setFromCamera(this.pointer, this.view.camera)
      const member = this.pickMember()
      if (member) onSelect(member)
    }
    const cancel = (event: PointerEvent): void => { pointers.delete(event.pointerId); this.down = undefined }
    let hovered: string | undefined
    let lastHover = 0
    const hover = (event: PointerEvent): void => {
      if (event.buttons !== 0 || performance.now() - lastHover < 35) return
      lastHover = performance.now()
      const rect = canvas.getBoundingClientRect()
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2)
      this.ray.setFromCamera(this.pointer, this.view.camera)
      const member = this.pickMember()
      if (member === hovered) return
      hovered = member
      canvas.style.cursor = member ? 'pointer' : 'grab'
      onHover(member)
    }
    const leave = (): void => { hovered = undefined; onHover(undefined) }
    const reset = (): void => { this.resetCamera() }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', cancel)
    canvas.addEventListener('dblclick', reset)
    canvas.addEventListener('pointermove', hover)
    canvas.addEventListener('pointerleave', leave)
    this.removeInput = () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', cancel)
      canvas.removeEventListener('dblclick', reset)
      canvas.removeEventListener('pointermove', hover)
      canvas.removeEventListener('pointerleave', leave)
    }
    this.invalidate()
  }

  private readonly removeInput: () => void

  setMembers(members: readonly WorldMember[]): void {
    this.simulation.setMembers(members)
    const key = members.map(member => member.id).join('\0')
    if (key !== this.rosterKey) {
      this.rosterKey = key
      this.island.group.removeFromParent()
      disposeObjects(this.island.group)
      this.island = createIsland(this.simulation.stations)
      this.environment.setBounds(this.island.minX)
      this.view.setBounds(this.island.minX, this.island.maxX)
      this.scene.add(this.island.group)
      this.island.upper.visible = this.floor !== 'ground'
    }
    this.invalidate()
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this.view.resize(width, height)
    this.renderer.setSize(width, height, false)
    this.invalidate()
  }

  setActivity(visible: boolean, reducedMotion: boolean, playing: boolean): void {
    this.visible = visible
    this.reducedMotion = reducedMotion
    this.playing = playing
    this.controls.enableDamping = !reducedMotion
    this.canvas.dataset.worldPaused = String(!this.animating)
    this.lastFrame = this.lastReport = 0
    this.frames = 0
    this.frameTimes.length = 0
    this.cpuTimes.length = 0
    if (!visible || this.contextLost) this.cancelFrame()
    else this.invalidate()
  }

  setFloor(floor: FloorView): void {
    this.floor = floor
    this.island.upper.visible = floor !== 'ground'
    if (floor === 'terrace') this.focusAt({ x: 5.4, y: 3.4, z: -3.1 }, 1.8)
    else this.resetCamera()
    this.invalidate()
  }

  focusAt(position: Position, zoom = 1.8): void {
    this.view.interact()
    const difference = new Vector3(position.x, position.y, position.z).sub(this.controls.target)
    this.view.camera.position.add(difference)
    this.controls.target.set(position.x, position.y, position.z)
    this.view.camera.zoom = zoom
    this.view.camera.updateProjectionMatrix()
    this.controls.update()
    this.invalidate()
  }

  resetCamera(): void {
    this.controls.reset()
    this.view.reset()
    this.controls.target.copy(this.view.target)
    this.controls.update()
    this.invalidate()
  }

  rotate(direction: number): void {
    this.view.interact()
    const offset = this.view.camera.position.clone().sub(this.controls.target)
    offset.applyAxisAngle(new Vector3(0, 1, 0), direction * Math.PI / 6)
    this.view.camera.position.copy(this.controls.target).add(offset)
    this.controls.update()
    this.invalidate()
  }

  readonly invalidate = (): void => {
    if (this.frame !== undefined || !this.visible || this.contextLost || this.disposed) return
    this.frame = requestAnimationFrame(this.tick)
  }

  get animating(): boolean { return this.playing && this.visible && !this.reducedMotion && !this.contextLost }

  dispose(): void {
    this.disposed = true
    this.cancelFrame()
    this.removeInput()
    this.controls.dispose()
    disposeObjects(this.scene)
    this.sun.shadow.map?.dispose()
    this.sun.shadow.mapPass?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  private cancelFrame(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
  }

  private readonly tick = (now: number): void => {
    const started = performance.now()
    this.frame = undefined
    const elapsed = this.lastFrame === 0 ? 0 : (now - this.lastFrame) / 1000
    this.lastFrame = now
    if (this.animating) this.simulation.step(Math.min(0.1, elapsed) * this.speed)
    this.controls.target.x = Math.max(this.island.minX, Math.min(this.island.maxX, this.controls.target.x))
    this.controls.target.z = Math.max(-10, Math.min(12, this.controls.target.z))
    const moving = this.controls.update()
    const light = daylight(this.simulation.hour)
    skyColor(light.light, light.dusk, this.backdrop)
    this.scene.background = this.backdrop
    ;(this.scene.fog as Fog).color.copy(this.backdrop)
    this.table.material.color.copy(this.backdrop)
    this.shadowFloor.material.opacity = 0.12 + light.light * 0.12
    this.sun.position.copy(light.night ? light.moon : light.sun)
    this.sun.position.y = Math.max(3, this.sun.position.y)
    this.sun.intensity = light.night ? 1.2 : 1.1 + light.light * 2.1
    this.sun.color.set(light.night ? '#a3c6f4' : light.dusk > 0.4 ? '#ffd3a0' : '#fff0d5')
    this.ambient.intensity = 0.95 + light.light * 1.35
    this.ambient.color.set(light.night ? '#8baccd' : '#e2ede0')
    this.firelight.intensity = (1 - light.light) * (7 + Math.sin(this.simulation.seconds * 4) * 0.6)
    this.cafeLight.intensity = (1 - light.light) * 9
    this.island.lights.visible = light.light < 0.65
    this.environment.update(this.simulation, this.floor === 'ground')
    this.characters.draw(this.simulation.residents, this.simulation.seconds, this.selected, this.focus, this.floor)
    if (!this.animating || now - this.lastShadow >= 1000 / 30) {
      this.renderer.shadowMap.needsUpdate = true
      this.lastShadow = now
    }
    this.renderer.render(this.scene, this.view.camera)
    this.canvas.dataset.worldReady = 'true'
    this.canvas.dataset.worldHour = this.simulation.hour.toFixed(2)
    this.canvas.dataset.worldZoom = this.view.camera.zoom.toFixed(3)
    this.canvas.dataset.worldAngle = this.controls.getAzimuthalAngle().toFixed(4)
    this.onFrame?.()
    this.cpuTimes.push(performance.now() - started)
    if (this.lastReport === 0) this.lastReport = now
    this.frames += 1
    if (elapsed > 0) this.frameTimes.push(elapsed * 1000)
    if (now - this.lastReport >= 750) {
      const times = this.frameTimes.sort((a, b) => a - b)
      this.stats = {
        fps: Math.round(this.frames * 1000 / (now - this.lastReport)),
        frameMs: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] ?? 0,
        cpuMs: this.cpuTimes.reduce((sum, time) => sum + time, 0) / this.cpuTimes.length,
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        pixelRatio: this.renderer.getPixelRatio(),
      }
      this.lastReport = now
      this.frames = 0
      this.frameTimes = []
      this.cpuTimes = []
      this.onStats?.()
      if (this.animating && this.stats.fps < 52 && now - this.lastQualityChange > 2500 && this.renderer.getPixelRatio() > 0.8) {
        this.lastQualityChange = now
        this.renderer.setPixelRatio(Math.max(0.8, this.renderer.getPixelRatio() - 0.2))
        if (this.stats.fps < 25 && this.renderer.shadowMap.type !== BasicShadowMap) {
          this.renderer.shadowMap.type = BasicShadowMap
          this.scene.traverse(object => {
            if (!(object instanceof Mesh)) return
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              if (material instanceof MeshLambertMaterial || material instanceof ShadowMaterial) material.needsUpdate = true
            }
          })
        }
        if (this.sun.shadow.mapSize.x > 1024) {
          this.sun.shadow.mapSize.set(1024, 1024)
          this.sun.shadow.map?.dispose()
          this.sun.shadow.map = null
        }
        this.lastShadow = 0
      }
    }
    if (this.animating || moving) this.invalidate()
  }

  private pickMember(): string | undefined {
    const hit = this.characters.pick(this.ray)
    if (!hit) return undefined
    const cover = this.island.upper.visible ? this.ray.intersectObject(this.island.upper, true)[0] : undefined
    return cover && cover.distance < hit.distance ? undefined : hit.id
  }
}
