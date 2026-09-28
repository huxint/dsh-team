import {
  ACESFilmicToneMapping, BasicShadowMap, Color, DirectionalLight, Fog, HemisphereLight, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  InstancedMesh, PCFSoftShadowMap, PlaneGeometry, PointLight, Raycaster, Scene, ShadowMaterial, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer,
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

/** Frame-rate ceilings: ambient life is slow, so it never needs the display's full refresh rate. */
export const FRAME_RATE = { focused: 30, background: 15 } as const
const SHADOW_INTERVAL = 1000 / 15
const PIXEL_BUDGET = 1_500_000
const SUN_DAY = new Color('#fff0d5')
const SUN_DUSK = new Color('#ffd3a0')
const MOON = new Color('#a3c6f4')
const SKY_DAY = new Color('#e2ede0')
const SKY_NIGHT = new Color('#8baccd')

export interface WorldStats { fps: number; frameMs: number; cpuMs: number; calls: number; triangles: number; pixelRatio: number }
export type FloorView = 'all' | 'ground' | 'terrace'

export function disposeObjects(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse(object => {
    if (!(object instanceof Mesh)) return
    // Instance buffers have their own GPU lifetime, separate from the geometry.
    if (object instanceof InstancedMesh) object.dispose()
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
  frameRate: number = FRAME_RATE.focused
  stats: WorldStats = { fps: 0, frameMs: 0, cpuMs: 0, calls: 0, triangles: 0, pixelRatio: 1 }
  onFrame: (() => void) | undefined
  onStats: (() => void) | undefined
  private frame: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastFrame = 0
  private lastRender = 0
  /** A redraw that must not wait for the frame-rate ceiling (input, camera damping). */
  private urgent = true
  /** Whether the scene content (not just the camera) changed since the last shadow pass. */
  private dirty = true
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
  private lastShadow = -Infinity
  private qualityRatio = 1
  private previousContextLost = false
  private updatingControls = false

  constructor(readonly canvas: HTMLCanvasElement, members: readonly WorldMember[], onSelect: (id: string) => void, onHover: (id: string | undefined) => void) {
    this.simulation = new WorldSimulation(members)
    this.rosterKey = members.map(member => member.id).join('\0')
    this.island = createIsland(this.simulation.stations)
    this.environment.setBounds(this.island.minX)
    this.view.setBounds(this.island.minX, this.island.maxX)
    this.view.reset()
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.qualityRatio))
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
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
    this.controls.addEventListener('change', () => { if (!this.updatingControls) this.redraw() })
    this.controls.addEventListener('start', () => { this.view.interact(); this.redraw() })
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.qualityRatio, Math.sqrt(PIXEL_BUDGET / (width * height))))
    this.renderer.setSize(width, height, false)
    this.redraw()
  }

  setActivity(visible: boolean, reducedMotion: boolean, playing: boolean, focused = this.frameRate === FRAME_RATE.focused): void {
    const frameRate = focused ? FRAME_RATE.focused : FRAME_RATE.background
    if (this.visible === visible && this.reducedMotion === reducedMotion && this.playing === playing
      && this.frameRate === frameRate && this.previousContextLost === this.contextLost
      && this.canvas.dataset.worldPaused !== undefined) return
    this.previousContextLost = this.contextLost
    this.visible = visible
    this.reducedMotion = reducedMotion
    this.playing = playing
    this.frameRate = frameRate
    this.controls.enableDamping = !reducedMotion
    this.canvas.dataset.worldPaused = String(!this.animating)
    this.canvas.dataset.worldFrameLimit = String(this.frameRate)
    this.lastFrame = this.lastRender = this.lastReport = 0
    this.frames = 0
    this.frameTimes.length = 0
    this.cpuTimes.length = 0
    this.cancelFrame()
    if (visible && !this.contextLost) this.invalidate()
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
    this.redraw()
  }

  resetCamera(): void {
    this.controls.reset()
    this.view.reset()
    this.controls.target.copy(this.view.target)
    this.controls.update()
    this.redraw()
  }

  rotate(direction: number): void {
    this.view.interact()
    const offset = this.view.camera.position.clone().sub(this.controls.target)
    offset.applyAxisAngle(new Vector3(0, 1, 0), direction * Math.PI / 6)
    this.view.camera.position.copy(this.controls.target).add(offset)
    this.controls.update()
    this.redraw()
  }

  /** Schedule a frame after the scene content changed: residents, lights and shadows refresh. */
  readonly invalidate = (): void => {
    this.dirty = true
    this.lastShadow = -Infinity
    this.redraw()
  }

  /** Schedule a prompt frame for a camera-only change; the shadow map stays as it is. */
  readonly redraw = (): void => {
    this.urgent = true
    this.schedule()
  }

  private schedule(): void {
    if (this.frame !== undefined || !this.visible || this.contextLost || this.disposed) return
    if (this.urgent || this.lastRender === 0) {
      if (this.timer !== undefined) clearTimeout(this.timer)
      this.timer = undefined
      this.frame = requestAnimationFrame(this.tick)
    } else if (this.timer === undefined) {
      // Sleep between ambient frames instead of waking at 120/144 Hz just to skip.
      const delay = Math.max(0, this.lastRender + 1000 / this.frameRate - performance.now() - 8)
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.frame = requestAnimationFrame(this.tick)
      }, delay)
    }
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
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.frame = undefined
    this.timer = undefined
  }

  private readonly tick = (now: number): void => {
    this.frame = undefined
    if (!this.visible || this.contextLost || this.disposed) return
    // Between ceiling-paced frames the callback only re-arms itself. The
    // deadline advances by whole intervals so refresh rates that do not divide
    // the ceiling (75 Hz, 144 Hz) still average out to it.
    // Input frames render at once, but only move the camera: the simulation
    // still advances on the paced beat alone.
    const interval = 1000 / this.frameRate
    const due = this.lastRender === 0 || now - this.lastRender >= interval - 1
    if (!due && !this.urgent) {
      this.schedule()
      return
    }
    this.urgent = false
    const started = performance.now()
    let elapsed = 0
    if (due) {
      this.lastRender = this.lastRender !== 0 && now - this.lastRender < interval * 2 ? this.lastRender + interval : now
      elapsed = this.lastFrame === 0 ? 0 : (now - this.lastFrame) / 1000
      this.lastFrame = now
      if (this.animating && elapsed > 0) {
        this.simulation.step(Math.min(0.1, elapsed) * this.speed)
        this.dirty = true
      }
    }
    this.controls.target.x = Math.max(this.island.minX, Math.min(this.island.maxX, this.controls.target.x))
    this.controls.target.z = Math.max(-10, Math.min(12, this.controls.target.z))
    this.updatingControls = true
    const moving = this.controls.update()
    this.updatingControls = false
    if (this.dirty) {
      this.dirty = false
      this.compose()
      if (now - this.lastShadow >= SHADOW_INTERVAL - 1) {
        this.renderer.shadowMap.needsUpdate = true
        this.lastShadow = now
      }
    }
    this.renderer.render(this.scene, this.view.camera)
    this.canvas.dataset.worldReady = 'true'
    this.canvas.dataset.worldHour = this.simulation.hour.toFixed(2)
    this.canvas.dataset.worldZoom = this.view.camera.zoom.toFixed(3)
    this.canvas.dataset.worldAngle = this.controls.getAzimuthalAngle().toFixed(4)
    this.canvas.dataset.worldFrames = String(Number(this.canvas.dataset.worldFrames ?? 0) + 1)
    this.onFrame?.()
    this.cpuTimes.push(performance.now() - started)
    if (this.lastReport === 0) this.lastReport = now
    this.frames += 1
    if (elapsed > 0) this.frameTimes.push(elapsed * 1000)
    if (now - this.lastReport >= 750) this.report(now)
    if (moving && this.controls.enableDamping) this.redraw()
    else if (this.animating) this.schedule()
  }

  /** Bring lights, water, residents and island life up to the simulation's present. */
  private compose(): void {
    const light = daylight(this.simulation.hour)
    skyColor(light.light, light.dusk, this.backdrop)
    this.scene.background = this.backdrop
    ;(this.scene.fog as Fog).color.copy(this.backdrop)
    this.table.material.color.copy(this.backdrop)
    this.shadowFloor.material.opacity = 0.12 + light.light * 0.12
    this.sun.position.copy(light.night ? light.moon : light.sun)
    this.sun.position.y = Math.max(3, this.sun.position.y)
    this.sun.intensity = light.night ? 1.2 : 1.1 + light.light * 2.1
    this.sun.color.copy(light.night ? MOON : light.dusk > 0.4 ? SUN_DUSK : SUN_DAY)
    this.ambient.intensity = 0.95 + light.light * 1.35
    this.ambient.color.copy(light.night ? SKY_NIGHT : SKY_DAY)
    this.firelight.intensity = (1 - light.light) * (7 + Math.sin(this.simulation.seconds * 4) * 0.6)
    this.cafeLight.intensity = (1 - light.light) * 9
    this.island.lights.visible = light.light < 0.65
    this.environment.update(this.simulation, light, this.floor === 'ground')
    this.characters.draw(this.simulation.residents, this.simulation.seconds, this.selected, this.focus, this.floor)
  }

  private report(now: number): void {
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
    // Missing the ceiling while animating means the device is struggling:
    // shed resolution first, then soft shadows and shadow-map resolution.
    if (!this.animating || this.stats.fps >= this.frameRate * 0.8 || now - this.lastQualityChange <= 2500) return
    this.lastQualityChange = now
    this.qualityRatio = Math.max(0.7, this.qualityRatio - 0.15)
    this.resize(this.view.width, this.view.height)
    if (this.stats.fps < this.frameRate * 0.5 && this.renderer.shadowMap.type !== BasicShadowMap) {
      this.renderer.shadowMap.type = BasicShadowMap
      this.scene.traverse(object => {
        if (!(object instanceof Mesh)) return
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof MeshLambertMaterial || material instanceof ShadowMaterial) material.needsUpdate = true
        }
      })
    }
    // Once resolution is at its floor, stop paying for dynamic shadow passes.
    if (this.qualityRatio <= 0.7 && this.stats.fps < this.frameRate * 0.65) {
      this.renderer.shadowMap.enabled = false
      this.sun.castShadow = false
      this.shadowFloor.visible = false
    }
    this.invalidate()
  }

  private pickMember(): string | undefined {
    const hit = this.characters.pick(this.ray)
    if (!hit) return undefined
    const cover = this.island.upper.visible ? this.ray.intersectObject(this.island.upper, true)[0] : undefined
    return cover && cover.distance < hit.distance ? undefined : hit.id
  }
}
