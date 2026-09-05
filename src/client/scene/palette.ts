import { Color, SRGBColorSpace } from 'three'
import { accentShiftOf } from '../crew.tsx'

const TOKENS = {
  page: '--dsw-alias-bg-base',
  ink: '--dsw-alias-label-primary',
  hue: '--dsw-alias-state-business-primary',
  warm: '--dsw-alias-state-warn-primary',
  leaf: '--dsw-alias-state-success-primary',
  error: '--dsw-alias-state-error-primary',
} as const

export type Tokens = Record<keyof typeof TOKENS, Color>

export function parseColor(text: string): Color | undefined {
  const value = text.trim()
  if (/^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(value)) return new Color(value)
  const rgb = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/iu.exec(value)
  if (rgb === null) return undefined
  const channel = (index: number): number => Math.min(1, Number(rgb[index]) / (rgb[index + 1] === '%' ? 100 : 255))
  return new Color().setRGB(channel(1), channel(3), channel(5), SRGBColorSpace)
}

export function readTokens(element: Element): Tokens {
  const style = getComputedStyle(element)
  const tokens = {} as Tokens
  let canvas: CanvasRenderingContext2D | null | undefined
  for (const name of Object.keys(TOKENS) as (keyof Tokens)[]) {
    const raw = style.getPropertyValue(TOKENS[name]).trim()
    let color = parseColor(raw)
    if (color === undefined && CSS.supports('color', raw)) {
      // The browser resolves color-mix, oklch, and custom theme colour spaces to sRGB.
      canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      if (canvas !== null) {
        canvas.clearRect(0, 0, 1, 1)
        canvas.fillStyle = raw
        canvas.fillRect(0, 0, 1, 1)
        const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data
        color = new Color().setRGB(r! / 255, g! / 255, b! / 255, SRGBColorSpace)
      }
    }
    if (color === undefined) throw new Error(`The team room requires a colour for ${TOKENS[name]}`)
    tokens[name] = color
  }
  return tokens
}

// CSS and WebGL must mix in the same space or the crew and furniture disagree.
export function mix(from: Color, to: Color, weight: number): Color {
  const a = from.clone().convertLinearToSRGB()
  const b = to.clone().convertLinearToSRGB()
  return a.lerp(b, Math.min(1, Math.max(0, weight))).convertSRGBToLinear()
}

export function css(color: Color, alpha = 1): string {
  const channels = color.clone().convertLinearToSRGB()
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)
  return `rgba(${channel(channels.r)}, ${channel(channels.g)}, ${channel(channels.b)}, ${alpha})`
}

export function luminance(color: Color): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
}

export function turn(color: Color, degrees: number): Color {
  const hsl = color.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace)
  return new Color().setHSL(hsl.h + degrees / 360, hsl.s, hsl.l, SRGBColorSpace)
}

export function paletteOf(tokens: Tokens) {
  const { page, ink, hue, warm, leaf, error } = tokens
  const dark = luminance(page) < luminance(ink)
  const white = dark ? ink : page
  const charcoal = dark ? page : ink
  const wood = mix(mix(white, warm, 0.4), charcoal, 0.08)
  const fabric = mix(mix(white, leaf, 0.27), hue, 0.08)
  const chair = mix(mix(white, hue, 0.4), charcoal, 0.12)
  const clay = mix(mix(white, warm, 0.32), error, 0.12)
  const wall = dark ? mix(mix(page, hue, 0.35), white, 0.035) : mix(page, hue, 0.24)
  return {
    dark, page, ink, hue, warm, leaf, error, white,
    backdrop: mix(page, hue, dark ? 0.055 : 0.025),
    wall,
    wallBack: mix(wall, white, dark ? 0.035 : 0.25),
    wainscot: dark ? mix(page, hue, 0.28) : mix(white, hue, 0.13),
    skirting: dark ? mix(page, white, 0.2) : mix(white, hue, 0.045),
    floor: dark ? mix(wood, charcoal, 0.56) : mix(wood, white, 0.16),
    floorSeam: mix(wood, charcoal, 0.22),
    rug: dark ? mix(page, hue, 0.3) : mix(white, hue, 0.18),
    rugBorder: dark ? mix(page, hue, 0.45) : mix(white, hue, 0.32),
    wood,
    woodDark: mix(wood, charcoal, 0.2),
    woodLight: mix(wood, white, 0.35),
    fabric,
    fabricDark: mix(fabric, charcoal, 0.13),
    cushionWarm: mix(white, warm, 0.43),
    cushionCool: mix(white, hue, 0.38),
    chair,
    chairDark: mix(chair, charcoal, 0.2),
    metal: mix(white, charcoal, 0.26),
    metalDark: mix(mix(white, charcoal, 0.7), hue, 0.1),
    plastic: mix(white, hue, 0.035),
    plasticDark: mix(white, charcoal, 0.2),
    glass: mix(white, hue, 0.2),
    paper: mix(white, warm, 0.025),
    leafDark: mix(mix(leaf, charcoal, 0.4), hue, 0.16),
    leafLit: mix(mix(leaf, white, 0.35), warm, 0.08),
    pot: clay,
    soil: mix(charcoal, wood, 0.28),
    screenBezel: mix(charcoal, hue, 0.15),
    screenOff: mix(charcoal, hue, 0.16),
    screenOn: dark ? mix(charcoal, hue, 0.24) : mix(white, hue, 0.08),
    shade: mix(white, warm, 0.24),
    bulb: mix(white, warm, 0.16),
    gold: mix(warm, white, 0.28),
    cat: mix(clay, white, 0.2),
    catDark: mix(clay, charcoal, 0.28),
    skyTop: dark ? mix(charcoal, hue, 0.38) : mix(white, hue, 0.28),
    skyLow: dark ? mix(mix(charcoal, hue, 0.28), warm, 0.2) : mix(white, warm, 0.18),
    sea: dark ? mix(charcoal, hue, 0.28) : mix(white, hue, 0.4),
    cloud: mix(white, hue, dark ? 0.22 : 0.025),
    sun: mix(white, dark ? hue : warm, dark ? 0.28 : 0.12),
    lamp: mix(white, warm, 0.3),
    accent: (seat: number) => turn(hue, accentShiftOf(seat)),
  }
}

export type Palette = ReturnType<typeof paletteOf>
