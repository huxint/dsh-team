/**
 * What the room paints onto its surfaces.
 *
 * A toy diorama is mostly plain colour, but a few surfaces are pictures: the
 * grain in the floorboards, the sky outside the windows, what is written on
 * the whiteboard, what is on each screen. Those are drawn here, into small
 * canvases, in the palette's own colours — there is no image file anywhere in
 * this room, so a theme change repaints every picture along with every wall.
 *
 * Every painter is deterministic: grain, clouds and scribbles come from a
 * seeded generator, so the same theme paints the same room twice.
 */
import type { Painter } from './kit.ts'
import { css, mix, type Palette } from './palette.ts'

/** A small deterministic generator: the same seed, the same grain. */
export function seeded(seed: number): () => number {
  let state = (seed >>> 0) || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

/** The preset pictures a workstation monitor can show. */
export const APPS = ['code', 'chart', 'doc', 'mail', 'grid', 'term'] as const

/** One preset picture. */
export type AppKind = typeof APPS[number]

/** Which picture one seat's monitor shows; the leader watches the dashboard. */
export function appOf(seat: number): AppKind {
  if (seat < 0) return 'chart'
  return APPS[seat % APPS.length] ?? 'code'
}

/** A rounded rectangle path, ready to fill or stroke. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/**
 * Floorboards: planks running across the room, staggered, each a slightly
 * different shade with a little grain and a dark seam between. Tiles.
 */
export function paintFloor(p: Palette): Painter {
  return (ctx, w, h) => {
    const random = seeded(7)
    const rows = 6
    const plank = h / rows
    ctx.fillStyle = css(p.floor)
    ctx.fillRect(0, 0, w, h)
    for (let row = 0; row < rows; row += 1) {
      const y = row * plank
      const offset = (row % 2) * (w / 3) + random() * (w / 6)
      let x = -offset
      while (x < w) {
        const length = w / 2 + random() * (w / 3)
        const shade = mix(p.floor, p.woodDark, 0.04 + random() * 0.12)
        ctx.fillStyle = css(mix(shade, p.white, random() * 0.05))
        ctx.fillRect(x, y, length, plank)
        // Grain: a few long faint strokes down the plank.
        ctx.strokeStyle = css(p.woodDark, 0.09)
        ctx.lineWidth = 1
        for (let line = 0; line < 4; line += 1) {
          const gy = y + plank * (0.15 + random() * 0.7)
          ctx.beginPath()
          ctx.moveTo(x + 2, gy)
          ctx.bezierCurveTo(x + length * 0.3, gy + random() * 3 - 1.5, x + length * 0.7, gy - random() * 3 + 1.5, x + length - 2, gy)
          ctx.stroke()
        }
        // The end seam of the plank.
        ctx.fillStyle = css(p.floorSeam, 0.55)
        ctx.fillRect(x + length - 1, y, 1.5, plank)
        x += length
      }
      // The long seam between rows.
      ctx.fillStyle = css(p.floorSeam, 0.7)
      ctx.fillRect(0, y, w, 1.5)
    }
  }
}

/** The rug in the break corner: a plain field with a woven border and a fringe. */
export function paintRug(p: Palette): Painter {
  return (ctx, w, h) => {
    const random = seeded(11)
    ctx.fillStyle = css(p.rug)
    ctx.fillRect(0, 0, w, h)
    // A soft weave: faint alternating lines in both directions.
    ctx.strokeStyle = css(p.rugBorder, 0.16)
    ctx.lineWidth = 1
    for (let y = 3; y < h; y += 6) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y + (random() - 0.5))
      ctx.stroke()
    }
    // The border, two bands.
    const inset = w * 0.06
    ctx.strokeStyle = css(p.rugBorder)
    ctx.lineWidth = w * 0.028
    ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2)
    ctx.lineWidth = w * 0.01
    ctx.strokeRect(inset * 1.9, inset * 1.9, w - inset * 3.8, h - inset * 3.8)
    // A diamond in the middle.
    ctx.beginPath()
    ctx.moveTo(w / 2, h * 0.3)
    ctx.lineTo(w * 0.62, h / 2)
    ctx.lineTo(w / 2, h * 0.7)
    ctx.lineTo(w * 0.38, h / 2)
    ctx.closePath()
    ctx.stroke()
  }
}

/** The whiteboard: a diagram half-rubbed-out, three sticky notes, a marker line. */
export function paintWhiteboard(p: Palette): Painter {
  return (ctx, w, h) => {
    ctx.fillStyle = css(p.paper)
    ctx.fillRect(0, 0, w, h)
    // Ghost of a rubbed-off diagram.
    ctx.strokeStyle = css(p.ink, 0.07)
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(w * 0.14, h * 0.7)
    ctx.bezierCurveTo(w * 0.3, h * 0.2, w * 0.55, h * 0.9, w * 0.8, h * 0.35)
    ctx.stroke()
    // What is on it now: a box, an arrow, three lines of notes.
    ctx.lineCap = 'round'
    ctx.lineWidth = 3.5
    ctx.strokeStyle = css(p.hue)
    ctx.strokeRect(w * 0.1, h * 0.2, w * 0.24, h * 0.24)
    ctx.beginPath()
    ctx.moveTo(w * 0.34, h * 0.32)
    ctx.lineTo(w * 0.5, h * 0.32)
    ctx.lineTo(w * 0.47, h * 0.28)
    ctx.moveTo(w * 0.5, h * 0.32)
    ctx.lineTo(w * 0.47, h * 0.36)
    ctx.stroke()
    ctx.strokeStyle = css(p.error, 0.85)
    ctx.beginPath()
    ctx.moveTo(w * 0.12, h * 0.62)
    ctx.lineTo(w * 0.42, h * 0.62)
    ctx.moveTo(w * 0.12, h * 0.72)
    ctx.lineTo(w * 0.36, h * 0.72)
    ctx.stroke()
    ctx.strokeStyle = css(p.leaf, 0.9)
    ctx.beginPath()
    ctx.moveTo(w * 0.12, h * 0.82)
    ctx.lineTo(w * 0.5, h * 0.82)
    ctx.stroke()
    // A small chart on the right.
    ctx.strokeStyle = css(p.ink, 0.7)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(w * 0.58, h * 0.22)
    ctx.lineTo(w * 0.58, h * 0.58)
    ctx.lineTo(w * 0.9, h * 0.58)
    ctx.stroke()
    ctx.strokeStyle = css(p.hue)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(w * 0.6, h * 0.52)
    ctx.lineTo(w * 0.68, h * 0.4)
    ctx.lineTo(w * 0.76, h * 0.46)
    ctx.lineTo(w * 0.86, h * 0.28)
    ctx.stroke()
    // Sticky notes.
    const notes: readonly [number, number, number][] = [[0.62, 0.66, -4], [0.76, 0.7, 3], [0.84, 0.16, 5]]
    for (const [nx, ny, tilt] of notes) {
      ctx.save()
      ctx.translate(w * nx, h * ny)
      ctx.rotate((tilt * Math.PI) / 180)
      ctx.fillStyle = css(p.ink, 0.12)
      ctx.fillRect(2, 3, w * 0.1, w * 0.1)
      ctx.fillStyle = css(tilt > 0 ? mix(p.warm, p.white, 0.35) : mix(p.leaf, p.white, 0.45))
      ctx.fillRect(0, 0, w * 0.1, w * 0.1)
      ctx.strokeStyle = css(p.ink, 0.35)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(w * 0.015, w * 0.035)
      ctx.lineTo(w * 0.085, w * 0.035)
      ctx.moveTo(w * 0.015, w * 0.06)
      ctx.lineTo(w * 0.07, w * 0.06)
      ctx.stroke()
      ctx.restore()
    }
  }
}

/** The wall calendar: a header band and a grid with one day ringed. */
export function paintCalendar(p: Palette): Painter {
  return (ctx, w, h) => {
    ctx.fillStyle = css(p.paper)
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = css(p.hue)
    ctx.fillRect(0, 0, w, h * 0.22)
    ctx.fillStyle = css(p.white, 0.9)
    ctx.fillRect(w * 0.2, h * 0.09, w * 0.36, h * 0.05)
    const columns = 7
    const rows = 5
    const cell = (w * 0.86) / columns
    const top = h * 0.3
    const rowHeight = (h * 0.64) / rows
    ctx.strokeStyle = css(p.ink, 0.18)
    ctx.lineWidth = 1
    for (let c = 0; c <= columns; c += 1) {
      ctx.beginPath()
      ctx.moveTo(w * 0.07 + c * cell, top)
      ctx.lineTo(w * 0.07 + c * cell, top + rows * rowHeight)
      ctx.stroke()
    }
    for (let r = 0; r <= rows; r += 1) {
      ctx.beginPath()
      ctx.moveTo(w * 0.07, top + r * rowHeight)
      ctx.lineTo(w * 0.93, top + r * rowHeight)
      ctx.stroke()
    }
    ctx.fillStyle = css(p.ink, 0.5)
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        if ((r === 0 && c < 2) || (r === 4 && c > 3)) continue
        ctx.fillRect(w * 0.07 + c * cell + cell * 0.3, top + r * rowHeight + rowHeight * 0.35, cell * 0.4, rowHeight * 0.3)
      }
    }
    ctx.strokeStyle = css(p.error)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(w * 0.07 + 3.5 * cell, top + 2.5 * rowHeight, cell * 0.5, rowHeight * 0.48, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/** The sky outside the windows: day or dusk, clouds, the sea, a sail. */
export function paintSky(p: Palette): Painter {
  return (ctx, w, h) => {
    const random = seeded(23)
    const horizon = h * 0.62
    const sky = ctx.createLinearGradient(0, 0, 0, horizon)
    sky.addColorStop(0, css(p.skyTop))
    sky.addColorStop(1, css(p.skyLow))
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, horizon)
    const sea = ctx.createLinearGradient(0, horizon, 0, h)
    sea.addColorStop(0, css(mix(p.sea, p.white, p.dark ? 0.1 : 0.25)))
    sea.addColorStop(1, css(p.sea))
    ctx.fillStyle = sea
    ctx.fillRect(0, horizon, w, h - horizon)
    if (p.dark) {
      // Stars, and a moon.
      ctx.fillStyle = css(p.white, 0.85)
      for (let star = 0; star < 28; star += 1) {
        const size = 0.6 + random() * 1.2
        ctx.fillRect(random() * w, random() * horizon * 0.8, size, size)
      }
      ctx.fillStyle = css(mix(p.white, p.warm, 0.12))
      ctx.beginPath()
      ctx.arc(w * 0.74, h * 0.2, w * 0.06, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = css(p.skyTop)
      ctx.beginPath()
      ctx.arc(w * 0.765, h * 0.185, w * 0.05, 0, Math.PI * 2)
      ctx.fill()
      // The moon's path on the water.
      ctx.fillStyle = css(p.white, 0.12)
      for (let ripple = 0; ripple < 7; ripple += 1) {
        const ry = horizon + 6 + ripple * 9
        ctx.fillRect(w * 0.74 - 6 - ripple * 2, ry, 12 + ripple * 4, 2)
      }
    } else {
      // The sun, low and to the left, and its glare on the water.
      const glow = ctx.createRadialGradient(w * 0.22, h * 0.22, 2, w * 0.22, h * 0.22, w * 0.3)
      glow.addColorStop(0, css(p.white, 0.9))
      glow.addColorStop(0.18, css(mix(p.white, p.warm, 0.3), 0.55))
      glow.addColorStop(1, css(p.white, 0))
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, horizon)
      ctx.fillStyle = css(p.white, 0.22)
      for (let ripple = 0; ripple < 6; ripple += 1) {
        const ry = horizon + 5 + ripple * 8
        ctx.fillRect(w * 0.22 - 5 - ripple * 3, ry, 10 + ripple * 6, 2)
      }
    }
    // Clouds: soft, flat-bottomed heaps.
    const cloud = css(p.cloud, p.dark ? 0.55 : 0.92)
    const heaps: readonly [number, number, number][] = [[0.18, 0.36, 0.11], [0.62, 0.24, 0.14], [0.88, 0.42, 0.08]]
    for (const [cx, cy, r] of heaps) {
      ctx.fillStyle = cloud
      const x = w * cx
      const y = h * cy
      const size = w * r
      ctx.beginPath()
      ctx.arc(x, y, size * 0.55, 0, Math.PI * 2)
      ctx.arc(x - size * 0.55, y + size * 0.15, size * 0.42, 0, Math.PI * 2)
      ctx.arc(x + size * 0.6, y + size * 0.18, size * 0.45, 0, Math.PI * 2)
      ctx.arc(x + size * 0.1, y + size * 0.3, size * 0.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = cloud
      ctx.fillRect(x - size * 0.9, y + size * 0.3, size * 1.95, size * 0.32)
    }
    // A distant shore on the horizon, and a sail.
    ctx.fillStyle = css(mix(p.sea, p.ink, 0.35), 0.5)
    ctx.beginPath()
    ctx.moveTo(w * 0.7, horizon)
    ctx.lineTo(w * 0.8, horizon - 4)
    ctx.lineTo(w * 0.92, horizon - 2)
    ctx.lineTo(w, horizon - 5)
    ctx.lineTo(w, horizon)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = css(p.white, p.dark ? 0.6 : 0.95)
    ctx.beginPath()
    ctx.moveTo(w * 0.4, horizon + 2)
    ctx.lineTo(w * 0.4, horizon - 12)
    ctx.lineTo(w * 0.46, horizon + 2)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = css(p.ink, 0.6)
    ctx.fillRect(w * 0.385, horizon + 2, w * 0.085, 2.5)
  }
}

/** A sheet of paper with a few lines of text on it. */
export function paintPaper(p: Palette): Painter {
  return (ctx, w, h) => {
    ctx.fillStyle = css(p.paper)
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = css(p.ink, 0.42)
    ctx.fillRect(w * 0.12, h * 0.12, w * 0.5, h * 0.05)
    ctx.fillStyle = css(p.ink, 0.22)
    const lines = [0.78, 0.7, 0.74, 0.5, 0.76, 0.66, 0.3]
    lines.forEach((length, index) => {
      ctx.fillRect(w * 0.12, h * (0.26 + index * 0.09), w * length, h * 0.03)
    })
  }
}

/** The face of the wall clock, stopped at ten past ten, like every clock in every photograph. */
export function paintClock(p: Palette): Painter {
  return (ctx, w, h) => {
    const cx = w / 2
    const cy = h / 2
    const r = w / 2
    ctx.fillStyle = css(p.paper)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = css(p.ink, 0.75)
    ctx.lineCap = 'round'
    for (let tick = 0; tick < 12; tick += 1) {
      const angle = (tick / 12) * Math.PI * 2
      const long = tick % 3 === 0
      ctx.lineWidth = long ? 3 : 1.5
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(angle) * r * (long ? 0.72 : 0.8), cy + Math.sin(angle) * r * (long ? 0.72 : 0.8))
      ctx.lineTo(cx + Math.cos(angle) * r * 0.88, cy + Math.sin(angle) * r * 0.88)
      ctx.stroke()
    }
    const hand = (angle: number, length: number, width: number, color: string): void => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * r * length, cy + Math.sin(angle) * r * length)
      ctx.stroke()
    }
    hand(-Math.PI / 2 + (10 / 12) * Math.PI * 2 + (10 / 60) * (Math.PI / 6), 0.5, 4, css(p.ink))
    hand(-Math.PI / 2 + (10 / 60) * Math.PI * 2, 0.72, 3, css(p.ink))
    hand(-Math.PI / 2 + (37 / 60) * Math.PI * 2, 0.78, 1.2, css(p.error))
    ctx.fillStyle = css(p.ink)
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** A keyboard's key field, seen from above. */
export function paintKeyboard(p: Palette): Painter {
  return (ctx, w, h) => {
    ctx.fillStyle = css(p.plasticDark)
    ctx.fillRect(0, 0, w, h)
    const rows = 4
    const columns = 14
    const gap = 2
    const key = (w - gap * (columns + 1)) / columns
    const keyHeight = (h - gap * (rows + 1)) / rows
    ctx.fillStyle = css(p.plastic)
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        const wide = r === 3 && c >= 4 && c <= 9
        if (wide && c > 4) continue
        const width = wide ? key * 6 + gap * 5 : key
        roundRect(ctx, gap + c * (key + gap), gap + r * (keyHeight + gap), width, keyHeight, 1.5)
        ctx.fill()
      }
    }
  }
}

/**
 * What one screen shows: the preset picture for its app, framed by a window
 * chrome, dimmed when nobody is working at it, dark when it is off.
 */
export function paintScreen(p: Palette, app: AppKind, state: 'working' | 'reading' | 'off', accent: import('three').Color): Painter {
  return (ctx, w, h) => {
    const lit = state !== 'off'
    const base = state === 'working' ? p.screenOn : state === 'reading' ? p.screenOff : mix(p.ink, p.hue, 0.15)
    ctx.fillStyle = css(base)
    ctx.fillRect(0, 0, w, h)
    if (!lit) {
      // A reflection across dark glass.
      const glare = ctx.createLinearGradient(0, 0, w, h)
      glare.addColorStop(0, css(p.white, 0.1))
      glare.addColorStop(0.5, css(p.white, 0))
      ctx.fillStyle = glare
      ctx.fillRect(0, 0, w, h)
      return
    }
    const dim = state === 'reading' ? 0.7 : 1
    const ink = (alpha: number): string => css(p.ink, alpha * dim)
    // The window chrome: a title bar with three dots.
    ctx.fillStyle = css(mix(base, p.ink, 0.12))
    ctx.fillRect(0, 0, w, h * 0.12)
    for (const [index, color] of [p.error, p.warm, p.leaf].entries()) {
      ctx.fillStyle = css(color, 0.9 * dim)
      ctx.beginPath()
      ctx.arc(w * 0.04 + index * w * 0.045, h * 0.06, h * 0.025, 0, Math.PI * 2)
      ctx.fill()
    }
    const top = h * 0.16
    const body = h - top
    const bar = (x: number, y: number, width: number, height: number, color: string): void => {
      ctx.fillStyle = color
      roundRect(ctx, x, y, width, height, 2)
      ctx.fill()
    }
    switch (app) {
      case 'chart': {
        const heights = [0.42, 0.78, 0.56, 0.96, 0.68]
        const slot = w * 0.88 / heights.length
        heights.forEach((height, index) => {
          const color = index === heights.length - 1 ? p.leaf : accent
          const g = ctx.createLinearGradient(0, top + body * (1 - height), 0, h)
          g.addColorStop(0, css(color, dim))
          g.addColorStop(1, css(mix(color, base, 0.6), dim))
          ctx.fillStyle = g
          roundRect(ctx, w * 0.06 + index * slot + slot * 0.15, top + body * (1 - height) + body * 0.06, slot * 0.7, body * height - body * 0.12, 2)
          ctx.fill()
        })
        break
      }
      case 'code': {
        ctx.fillStyle = css(mix(base, p.ink, 0.2))
        ctx.fillRect(0, top, w * 0.18, body)
        const lines: readonly [number, number, import('three').Color][] = [
          [0, 0.5, accent], [0.08, 0.68, p.warm], [0.08, 0.36, p.leaf], [0.16, 0.5, p.error], [0.08, 0.3, accent], [0, 0.26, accent],
        ]
        lines.forEach(([indent, length, color], index) => {
          bar(w * (0.22 + indent), top + body * (0.08 + index * 0.15), w * length, body * 0.07, css(color, 0.9 * dim))
        })
        break
      }
      case 'doc': {
        bar(w * 0.08, top + body * 0.08, w * 0.5, body * 0.1, ink(0.7))
        const lines = [0.84, 0.8, 0.86, 0.5, 0.82, 0.3]
        lines.forEach((length, index) => {
          bar(w * 0.08, top + body * (0.28 + index * 0.11), w * length, body * 0.055, ink(0.35))
        })
        break
      }
      case 'mail': {
        const bubbles: readonly [number, boolean][] = [[0.6, false], [0.54, true], [0.42, false], [0.5, true]]
        bubbles.forEach(([length, mine], index) => {
          const x = mine ? w * (0.94 - length) : w * 0.06
          bar(x, top + body * (0.08 + index * 0.22), w * length, body * 0.16, mine ? css(accent, dim) : ink(0.22))
        })
        break
      }
      case 'grid': {
        const tiles = 6
        const columns = 3
        const cellW = (w * 0.88) / columns
        const cellH = (body * 0.84) / 2
        for (let tile = 0; tile < tiles; tile += 1) {
          const c = tile % columns
          const r = Math.floor(tile / columns)
          const color = tile === 0 ? accent : tile === 4 ? p.leaf : undefined
          bar(w * 0.06 + c * cellW + 3, top + body * 0.08 + r * cellH + 3, cellW - 6, cellH - 6, color === undefined ? ink(0.16) : css(mix(color, base, 0.5), dim))
          if (color !== undefined) bar(w * 0.06 + c * cellW + 8, top + body * 0.08 + r * cellH + 8, cellW * 0.3, 3, css(color, dim))
        }
        break
      }
      case 'term':
      default: {
        ctx.fillStyle = css(mix(p.ink, p.hue, 0.1))
        ctx.fillRect(0, top, w, body)
        bar(w * 0.06, top + body * 0.1, w * 0.5, body * 0.06, css(p.leaf, dim))
        bar(w * 0.06, top + body * 0.26, w * 0.78, body * 0.06, css(p.white, 0.7 * dim))
        bar(w * 0.06, top + body * 0.42, w * 0.36, body * 0.06, css(p.white, 0.7 * dim))
        bar(w * 0.06, top + body * 0.58, w * 0.6, body * 0.06, css(p.white, 0.5 * dim))
        bar(w * 0.06, top + body * 0.76, w * 0.05, body * 0.09, css(p.leaf, dim))
        break
      }
    }
    // The light the room leaves across the glass.
    const glare = ctx.createLinearGradient(0, 0, w * 0.6, h)
    glare.addColorStop(0, css(p.white, 0.14))
    glare.addColorStop(0.45, css(p.white, 0.02))
    glare.addColorStop(1, css(p.white, 0))
    ctx.fillStyle = glare
    ctx.fillRect(0, 0, w, h)
  }
}

/** The treadmill's console: a dark screen with a few bright readouts. */
export function paintConsole(p: Palette): Painter {
  return (ctx, w, h) => {
    ctx.fillStyle = css(mix(p.ink, p.hue, 0.1))
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = css(p.leaf, 0.9)
    ctx.fillRect(w * 0.1, h * 0.25, w * 0.3, h * 0.16)
    ctx.fillStyle = css(p.warm, 0.9)
    ctx.fillRect(w * 0.55, h * 0.25, w * 0.35, h * 0.16)
    ctx.fillStyle = css(p.white, 0.6)
    ctx.fillRect(w * 0.1, h * 0.6, w * 0.8, h * 0.08)
    ctx.fillStyle = css(p.hue)
    ctx.fillRect(w * 0.1, h * 0.6, w * 0.45, h * 0.08)
  }
}

/** The wainscot along the lower walls: vertical wooden slats. Tiles across. */
export function paintWainscot(p: Palette): Painter {
  return (ctx, w, h) => {
    const random = seeded(31)
    ctx.fillStyle = css(p.wainscot)
    ctx.fillRect(0, 0, w, h)
    const slats = 8
    const slat = w / slats
    for (let index = 0; index < slats; index += 1) {
      ctx.fillStyle = css(mix(p.wainscot, p.woodDark, 0.02 + random() * 0.08))
      ctx.fillRect(index * slat + 1.5, 0, slat - 3, h)
      ctx.fillStyle = css(p.white, 0.12)
      ctx.fillRect(index * slat + 1.5, 0, 1.5, h)
      ctx.fillStyle = css(p.ink, 0.22)
      ctx.fillRect(index * slat, 0, 1.5, h)
    }
  }
}

/** The soft edge of a light shaft: bright along the window, fading toward the floor and at the sides. */
export function paintShaft(): Painter {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    const down = ctx.createLinearGradient(0, 0, 0, h)
    down.addColorStop(0, 'rgba(255,255,255,0.85)')
    down.addColorStop(0.6, 'rgba(255,255,255,0.35)')
    down.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = down
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'destination-in'
    const across = ctx.createLinearGradient(0, 0, w, 0)
    across.addColorStop(0, 'rgba(255,255,255,0)')
    across.addColorStop(0.2, 'rgba(255,255,255,1)')
    across.addColorStop(0.8, 'rgba(255,255,255,1)')
    across.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = across
    ctx.fillRect(0, 0, w, h)
  }
}

/** A soft round glow, for a lamp's pool of light and a mote of dust. */
export function paintGlow(): Painter {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
}
