/**
 * Drawing the office into the tab.
 *
 * Two canvases stand in the room pane with the DOM crew between them. The
 * WebGL canvas is the top one: it draws the whole room, then that picture is
 * copied down to a plain canvas under the crew, and the WebGL canvas is drawn
 * again with only what should be IN FRONT of a member — furniture nearer to the
 * camera than the member's stand-in, found by drawing the stand-ins first
 * (depth and stencil only) and then the furniture through the stencil. A chair
 * back lands over its seated owner and the desk behind it does not, without
 * anyone measuring anything.
 *
 * Nothing is drawn unless something changed: a member moved, the camera leaned,
 * the theme flipped, the room's life ticked. Life ticks at a low cadence, the
 * whole thing stops when the tab is hidden, and the pixel ratio is capped.
 */
import { Color, PCFSoftShadowMap, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import type { Stagecraft } from '../stagecraft.ts'
import { FURNITURE_LAYER, PROXY_LAYER, SHELL_LAYER } from './kit.ts'
import type { Office } from './office.ts'
import { mix, paletteOf, readTokens, type Tokens } from './palette.ts'

/** The most device pixels one CSS pixel is allowed to cost. */
const MAX_PIXEL_RATIO = 2

/** How often the room's own life is redrawn, in frames per second. */
const LIFE_FPS = 24

/** The canvases the renderer stands in the room pane. */
export interface Canvases {
  /** The plain copy of the room, under the crew. */
  readonly backdrop: HTMLCanvasElement
  /** The WebGL canvas, over the crew, left holding only what stands in front of them. */
  readonly overlay: HTMLCanvasElement
}

/** The room, drawn. One per mounted stage with WebGL to draw it with. */
export class StageRenderer {
  readonly canvases: Canvases
  private readonly renderer: WebGLRenderer
  private readonly copy: CanvasRenderingContext2D | null
  private readonly eye = new Vector3()
  private width = 1
  private height = 1
  private roomDirty = true
  private frontDirty = true
  private visible = true
  private frame: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private still = false
  private last = 0
  private lastLife = 0
  private clock = 0
  private tokens: Tokens
  private readonly observers: (() => void)[] = []

  /**
   * @param host - the room pane; the canvases are appended to it and it is watched for size and theme.
   * @param stage - the camera over the room.
   * @param office - the room to draw.
   * @param still - whether the reader asked for no motion: the room then never animates on its own.
   */
  constructor(
    private readonly host: HTMLElement,
    private readonly stage: Stagecraft,
    private readonly office: Office,
  ) {
    const backdrop = document.createElement('canvas')
    const overlay = document.createElement('canvas')
    backdrop.dataset.roomLayer = 'backdrop'
    overlay.dataset.roomLayer = 'overlay'
    for (const canvas of [backdrop, overlay]) {
      canvas.setAttribute('aria-hidden', 'true')
      canvas.style.position = 'absolute'
      canvas.style.inset = '0'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.display = 'block'
    }
    overlay.style.pointerEvents = 'none'
    backdrop.style.pointerEvents = 'none'
    backdrop.style.zIndex = '0'
    overlay.style.zIndex = '250'
    this.canvases = { backdrop, overlay }
    this.copy = backdrop.getContext('2d')
    this.renderer = new WebGLRenderer({
      canvas: overlay,
      antialias: true,
      alpha: true,
      stencil: true,
      powerPreference: 'low-power',
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.autoClear = false
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    this.tokens = readTokens(host)
    host.prepend(backdrop)
    host.append(overlay)
    this.watch()
    this.resize(host.clientWidth, host.clientHeight)
  }

  /** The room changed: walls, furniture, light, theme. Everything is drawn again. */
  invalidate(): void {
    this.roomDirty = true
    this.frontDirty = true
    this.wake()
  }

  /** A member moved: only what stands in front of the crew is drawn again. */
  invalidateFront(): void {
    this.frontDirty = true
    this.wake()
  }

  /** Make sure a frame is coming. */
  wake(): void {
    if (this.frame !== undefined || !this.visible) return
    clearTimeout(this.timer)
    this.timer = undefined
    this.frame = requestAnimationFrame(this.tick)
  }

  /** The pane changed size. */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this.width = width
    this.height = height
    this.stage.resize(width, height)
    this.renderer.setSize(width, height, false)
    const ratio = this.renderer.getPixelRatio()
    this.canvases.backdrop.width = Math.round(width * ratio)
    this.canvases.backdrop.height = Math.round(height * ratio)
    this.invalidate()
  }

  /** Stop drawing while the tab is hidden; draw everything once it is back. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    this.stage.setVisible(visible)
    if (visible) {
      this.last = 0
      this.lastLife = 0
      this.invalidate()
    } else {
      if (this.frame !== undefined) cancelAnimationFrame(this.frame)
      clearTimeout(this.timer)
      this.frame = undefined
      this.timer = undefined
    }
  }

  /** Take the canvases down and free the context. */
  dispose(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    clearTimeout(this.timer)
    this.frame = undefined
    for (const stop of this.observers) stop()
    this.observers.length = 0
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvases.backdrop.remove()
    this.canvases.overlay.remove()
  }

  private readonly tick = (now: number): void => {
    this.frame = undefined
    const seconds = this.last === 0 ? 0 : Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.clock += seconds

    if (this.stage.step(seconds)) {
      this.roomDirty = true
      this.frontDirty = true
    }
    let alive = false
    if (!this.still) {
      if (now - this.lastLife >= 1000 / LIFE_FPS) {
        const lifeSeconds = this.lastLife === 0 ? 0 : (now - this.lastLife) / 1000
        this.lastLife = now
        if (this.office.step(Math.min(0.25, lifeSeconds), this.clock)) this.roomDirty = true
      }
      alive = true
    }

    if (this.roomDirty || this.frontDirty) this.draw()
    // The lean is still settling, or the room is alive: keep the frames coming.
    if (this.stage.leaning()) this.wake()
    else if (alive) this.timer = setTimeout(() => { this.wake() }, 1000 / LIFE_FPS)
  }

  /** Draw what is dirty: the whole room and its copy, then the front layer. */
  private draw(): void {
    const camera = this.stage.camera
    const renderer = this.renderer
    this.office.setProxies(this.stage.sprites, camera.getWorldPosition(this.eye))
    if (this.roomDirty) {
      renderer.setClearColor(mix(this.office.palette.page, this.office.palette.ink, 0.05), 1)
      renderer.clear(true, true, true)
      camera.layers.set(FURNITURE_LAYER)
      camera.layers.enable(SHELL_LAYER)
      renderer.shadowMap.needsUpdate = true
      renderer.render(this.office.scene, camera)
      if (this.copy !== null) {
        this.copy.clearRect(0, 0, this.canvases.backdrop.width, this.canvases.backdrop.height)
        this.copy.drawImage(this.canvases.overlay, 0, 0)
      }
    }
    // The front layer: stand-ins first, depth and stencil only, then the room through the stencil.
    renderer.setClearColor(new Color(0, 0, 0), 0)
    renderer.clear(true, true, true)
    camera.layers.set(PROXY_LAYER)
    renderer.render(this.office.scene, camera)
    this.office.shop.setStencil(true)
    camera.layers.set(FURNITURE_LAYER)
    camera.layers.enable(SHELL_LAYER)
    renderer.render(this.office.scene, camera)
    this.office.shop.setStencil(false)
    this.roomDirty = false
    this.frontDirty = false
  }

  /** Follow the pane's size, the page's theme, and whether anyone can see the tab. */
  private watch(): void {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotion = (): void => {
      this.still = motion.matches
      this.stage.setReducedMotion(this.still)
      this.office.setStill(this.still)
      this.invalidate()
    }
    onMotion()
    motion.addEventListener('change', onMotion)
    this.observers.push(() => { motion.removeEventListener('change', onMotion) })
    if (typeof ResizeObserver !== 'undefined') {
      const sizes = new ResizeObserver(entries => {
        const entry = entries[0]
        if (entry === undefined) return
        const { width, height } = entry.contentRect
        if (Math.round(width) !== Math.round(this.width) || Math.round(height) !== Math.round(this.height)) {
          this.resize(Math.round(width), Math.round(height))
        }
      })
      sizes.observe(this.host)
      this.observers.push(() => { sizes.disconnect() })
    }
    if (typeof MutationObserver !== 'undefined' && document.body !== null) {
      const themes = new MutationObserver(() => { this.retheme() })
      themes.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] })
      themes.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
      this.observers.push(() => { themes.disconnect() })
    }
    const onVisibility = (): void => { this.setVisible(document.visibilityState !== 'hidden' && this.seen) }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    this.observers.push(() => { document.removeEventListener('visibilitychange', onVisibility) })
    if (typeof IntersectionObserver !== 'undefined') {
      const sight = new IntersectionObserver(entries => {
        const entry = entries[entries.length - 1]
        if (entry === undefined) return
        this.seen = entry.isIntersecting
        onVisibility()
      })
      sight.observe(this.host)
      this.observers.push(() => { sight.disconnect() })
    }
  }

  /** Whether the pane is on screen at all, as the intersection observer last said. */
  private seen = true

  /** The theme may have changed: read the tokens again and repaint if any moved. */
  private retheme(): void {
    const tokens = readTokens(this.host)
    const same = (Object.keys(tokens) as (keyof Tokens)[]).every(name => tokens[name].equals(this.tokens[name]))
    if (same) return
    this.tokens = tokens
    this.office.repaint(paletteOf(tokens))
    this.invalidate()
  }
}
