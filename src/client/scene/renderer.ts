import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import type { Stagecraft } from '../stagecraft.ts'
import { FURNITURE_LAYER, PROXY_LAYER, SHELL_LAYER } from './kit.ts'
import type { Office } from './office.ts'

const MAX_PIXEL_RATIO = 2
const LIFE_FPS = 24

export class StageRenderer {
  readonly canvases: { readonly backdrop: HTMLCanvasElement, readonly overlay: HTMLCanvasElement }
  private readonly renderer: WebGLRenderer
  private readonly copy: CanvasRenderingContext2D
  private readonly eye = new Vector3()
  private roomDirty = true
  private frontDirty = true
  private visible = true
  private frame: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private still = false
  private last = 0
  private lastLife = 0
  private clock = 0
  private disposed = false

  constructor(host: HTMLElement, private readonly stage: Stagecraft, private readonly office: Office) {
    const backdrop = document.createElement('canvas')
    const overlay = document.createElement('canvas')
    backdrop.dataset.roomLayer = 'backdrop'
    overlay.dataset.roomLayer = 'overlay'
    for (const canvas of [backdrop, overlay]) {
      canvas.setAttribute('aria-hidden', 'true')
      Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' })
    }
    backdrop.style.zIndex = '0'
    overlay.style.zIndex = '250'
    this.canvases = { backdrop, overlay }
    const copy = backdrop.getContext('2d')
    if (copy === null) throw new Error('Canvas 2D is unavailable')
    this.copy = copy
    this.renderer = new WebGLRenderer({ canvas: overlay, antialias: true, alpha: true, stencil: true, powerPreference: 'low-power' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.autoClear = false
    host.prepend(backdrop)
    host.append(overlay)
  }

  invalidate(): void {
    this.roomDirty = true
    this.frontDirty = true
    this.office.shadowsDirty = true
    this.wake()
  }

  invalidateFront(): void {
    this.frontDirty = true
    this.wake()
  }

  wake(): void {
    if (this.frame !== undefined || !this.visible || this.disposed) return
    clearTimeout(this.timer)
    this.timer = undefined
    this.frame = requestAnimationFrame(this.tick)
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(width, height, false)
    this.canvases.backdrop.width = Math.floor(width * ratio)
    this.canvases.backdrop.height = Math.floor(height * ratio)
    this.invalidate()
  }

  setReducedMotion(still: boolean): void {
    if (this.still === still) return
    this.still = still
    this.lastLife = 0
    this.roomDirty = true
    this.wake()
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (visible) {
      this.last = this.lastLife = 0
      this.invalidate()
    } else this.cancelFrame()
  }

  dispose(): void {
    this.disposed = true
    this.cancelFrame()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvases.backdrop.remove()
    this.canvases.overlay.remove()
  }

  private cancelFrame(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    clearTimeout(this.timer)
    this.frame = undefined
    this.timer = undefined
  }

  private readonly tick = (now: number): void => {
    this.frame = undefined
    const seconds = this.last === 0 ? 0 : Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (this.stage.step(seconds)) this.roomDirty = true
    if (!this.still && now - this.lastLife >= 1000 / LIFE_FPS) {
      const elapsed = this.lastLife === 0 ? 0 : Math.min(0.1, (now - this.lastLife) / 1000)
      this.lastLife = now
      this.clock += elapsed
      if (this.office.step(elapsed, this.clock)) this.roomDirty = true
    }
    if (this.roomDirty || this.frontDirty) this.draw()
    if (this.stage.leaning()) this.wake()
    else if (!this.still) {
      const remaining = 1000 / LIFE_FPS - (performance.now() - this.lastLife)
      this.timer = setTimeout(() => { this.wake() }, Math.max(0, remaining))
    }
  }

  private draw(): void {
    const camera = this.stage.camera
    const renderer = this.renderer
    this.office.setProxies(this.stage.sprites, camera.getWorldPosition(this.eye))
    if (this.roomDirty) {
      renderer.setClearColor(this.office.palette.backdrop, 0)
      renderer.clear(true, true, true)
      camera.layers.set(FURNITURE_LAYER)
      camera.layers.enable(SHELL_LAYER)
      renderer.shadowMap.needsUpdate = this.office.shadowsDirty
      renderer.render(this.office.scene, camera)
      this.office.shadowsDirty = false
      this.copy.clearRect(0, 0, this.canvases.backdrop.width, this.canvases.backdrop.height)
      this.copy.drawImage(this.canvases.overlay, 0, 0)
      this.canvases.backdrop.dataset.roomReady = 'true'
    }

    // DOM crew sit between the room image and a depth-tested furniture pass.
    // Proxies write stencil and depth only, so chair backs can cover a seated sprite.
    renderer.setClearAlpha(0)
    renderer.clear(true, true, true)
    camera.layers.set(PROXY_LAYER)
    renderer.render(this.office.scene, camera)
    this.office.setStencil(true)
    camera.layers.set(FURNITURE_LAYER)
    camera.layers.enable(SHELL_LAYER)
    renderer.render(this.office.scene, camera)
    this.office.setStencil(false)
    this.roomDirty = this.frontDirty = false
  }
}
