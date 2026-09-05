/**
 * The room's colours, mixed from the theme the way the stylesheet mixes its own.
 *
 * Nothing in the WebGL room is a literal colour. The page and the ink are the
 * two theme tokens guaranteed to stand apart in both schemes, the business blue
 * is the room's hue and the warning amber its warmth, and every surface here is
 * "this far from one of those toward another" — the same `color-mix` arithmetic
 * the stylesheet uses, done in sRGB so the two halves of the room agree. Flip
 * the theme and the walls, the wood and the sky all move together, because they
 * were never anything but distances between tokens.
 */
import { Color, SRGBColorSpace } from 'three'
import { accentShiftOf } from '../crew.tsx'

/** The theme tokens the room reads, by the name the stylesheet reads them under. */
const TOKENS = {
  page: '--dsw-alias-bg-base',
  ink: '--dsw-alias-label-primary',
  hue: '--dsw-alias-state-business-primary',
  warm: '--dsw-alias-state-warn-primary',
  leaf: '--dsw-alias-state-success-primary',
  error: '--dsw-alias-state-error-primary',
} as const

type TokenName = keyof typeof TOKENS

/** The light scheme's values, for a stage mounted where the theme sheet is not. */
const FALLBACK: Record<TokenName, string> = {
  page: '#ffffff',
  ink: '#0f1115',
  hue: '#4176e6',
  warm: '#f59e0b',
  leaf: '#22c55e',
  error: '#ec1313',
}

/** The static neutrals the theme keeps the same in both schemes. */
const WHITE = '#ffffff'
const NEUTRAL_400 = '#a2a4a6'
const NEUTRAL_500 = '#7f8287'
const NEUTRAL_600 = '#545557'
const NEUTRAL_800 = '#292929'
const NEUTRAL_900 = '#0f0f0f'
const AMBER_600 = '#dd8629'

/** The theme's colours as the room reads them off the page. */
export type Tokens = Record<TokenName, Color>

/**
 * Parse one CSS colour as the theme sheet writes them: hex of any length, or
 * `rgb()` / `rgba()`. Anything else is not a theme value and yields nothing.
 * @param text - the computed custom property value.
 * @returns the colour in three's working space, if it parsed.
 */
export function parseColor(text: string): Color | undefined {
  const value = text.trim()
  const hex = /^#([0-9a-f]{3,8})$/iu.exec(value)
  if (hex !== null) {
    const digits = hex[1]!
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b] = [...digits].map(digit => Number.parseInt(digit + digit, 16))
      return new Color().setRGB(r! / 255, g! / 255, b! / 255, SRGBColorSpace)
    }
    if (digits.length === 6 || digits.length === 8) {
      const r = Number.parseInt(digits.slice(0, 2), 16)
      const g = Number.parseInt(digits.slice(2, 4), 16)
      const b = Number.parseInt(digits.slice(4, 6), 16)
      return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
    }
    return undefined
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/iu.exec(value)
  if (rgb !== null) {
    return new Color().setRGB(
      Number(rgb[1]) / 255,
      Number(rgb[2]) / 255,
      Number(rgb[3]) / 255,
      SRGBColorSpace,
    )
  }
  return undefined
}

/**
 * Mix two colours the way `color-mix(in srgb, …)` does: by weight, in sRGB.
 * @param from - the colour at weight 0.
 * @param to - the colour at weight 1.
 * @param weight - how far toward `to`.
 * @returns a new colour.
 */
export function mix(from: Color, to: Color, weight: number): Color {
  const a = { r: 0, g: 0, b: 0 }
  const b = { r: 0, g: 0, b: 0 }
  from.getRGB(a, SRGBColorSpace)
  to.getRGB(b, SRGBColorSpace)
  const t = Math.min(1, Math.max(0, weight))
  return new Color().setRGB(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
    SRGBColorSpace,
  )
}

/** A colour as CSS, for drawing into a canvas texture. */
export function css(color: Color, alpha = 1): string {
  const out = { r: 0, g: 0, b: 0 }
  color.getRGB(out, SRGBColorSpace)
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)
  return `rgba(${channel(out.r)}, ${channel(out.g)}, ${channel(out.b)}, ${alpha})`
}

/**
 * The theme as the element sees it. Every token is read off the computed style,
 * so a custom theme registered with the shell is honoured without this module
 * knowing its name; a token the theme does not define falls back to the light
 * scheme's value.
 * @param element - anything inside the themed page.
 * @returns the tokens as colours.
 */
export function readTokens(element: Element): Tokens {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : undefined
  const out = {} as Tokens
  for (const name of Object.keys(TOKENS) as TokenName[]) {
    const raw = style?.getPropertyValue(TOKENS[name]) ?? ''
    out[name] = parseColor(raw) ?? parseColor(FALLBACK[name])!
  }
  return out
}

/** The light scheme's tokens, for a room with no page under it. */
export function fallbackTokens(): Tokens {
  const out = {} as Tokens
  for (const name of Object.keys(TOKENS) as TokenName[]) out[name] = parseColor(FALLBACK[name])!
  return out
}

/** Relative luminance of a colour, 0 for black and 1 for white. */
export function luminance(color: Color): number {
  const out = { r: 0, g: 0, b: 0 }
  color.getRGB(out, SRGBColorSpace)
  const linear = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  return 0.2126 * linear(out.r) + 0.7152 * linear(out.g) + 0.0722 * linear(out.b)
}

/** Every surface the room is painted in. */
export interface Palette {
  /** Whether the page is dark: the room is an evening one then. */
  readonly dark: boolean
  readonly page: Color
  readonly ink: Color
  readonly hue: Color
  readonly warm: Color
  readonly leaf: Color
  readonly error: Color
  readonly white: Color

  readonly wall: Color
  readonly wallBack: Color
  readonly wainscot: Color
  readonly ceiling: Color
  readonly skirting: Color
  readonly floor: Color
  readonly floorSeam: Color
  readonly rug: Color
  readonly rugBorder: Color

  readonly wood: Color
  readonly woodDark: Color
  readonly woodLight: Color
  readonly fabric: Color
  readonly fabricDark: Color
  readonly cushionWarm: Color
  readonly cushionCool: Color
  readonly chair: Color
  readonly chairDark: Color
  readonly metal: Color
  readonly metalDark: Color
  readonly plastic: Color
  readonly plasticDark: Color
  readonly glass: Color
  readonly paper: Color
  readonly leafDark: Color
  readonly leafLit: Color
  readonly pot: Color
  readonly soil: Color
  readonly screenBezel: Color
  readonly screenOff: Color
  readonly screenOn: Color
  readonly shade: Color
  readonly bulb: Color
  readonly gold: Color
  readonly cat: Color
  readonly catDark: Color

  readonly skyTop: Color
  readonly skyLow: Color
  readonly sea: Color
  readonly cloud: Color
  /** The colour of the light coming through the windows. */
  readonly sun: Color
  /** The colour of the light the pendants give in the evening. */
  readonly lamp: Color

  /** The seat's own accent: the room's hue, turned as far as the crew turns it. */
  accent(seat: number): Color
}

/**
 * Turn a colour's hue by so many degrees, in HSL, keeping its lightness.
 * @param color - the colour to turn.
 * @param degrees - how far round the wheel.
 * @returns a new colour.
 */
export function turn(color: Color, degrees: number): Color {
  return color.clone().offsetHSL(degrees / 360, 0, 0)
}

/**
 * Every colour the room needs, from the six tokens it reads.
 * @param tokens - the theme, as read off the page.
 * @returns the palette.
 */
export function paletteOf(tokens: Tokens): Palette {
  const { page, ink, hue, warm, leaf, error } = tokens
  const dark = luminance(page) < 0.4
  const white = parseColor(WHITE)!
  const n400 = parseColor(NEUTRAL_400)!
  const n500 = parseColor(NEUTRAL_500)!
  const n600 = parseColor(NEUTRAL_600)!
  const n800 = parseColor(NEUTRAL_800)!
  const n900 = parseColor(NEUTRAL_900)!
  const amber = parseColor(AMBER_600)!
  const surface = mix(page, ink, 0.09)
  const wood = mix(surface, warm, dark ? 0.36 : 0.42)
  const fabric = mix(n600, warm, 0.52)
  const chair = mix(n600, hue, dark ? 0.3 : 0.38)
  const cat = mix(n500, amber, 0.55)
  return {
    dark,
    page,
    ink,
    hue,
    warm,
    leaf,
    error,
    white,

    wall: mix(page, hue, dark ? 0.1 : 0.14),
    wallBack: mix(page, hue, dark ? 0.07 : 0.1),
    wainscot: mix(page, warm, dark ? 0.08 : 0.13),
    ceiling: mix(page, ink, 0.1),
    skirting: mix(page, ink, 0.3),
    floor: mix(page, warm, dark ? 0.14 : 0.2),
    floorSeam: mix(page, ink, dark ? 0.22 : 0.14),
    rug: mix(page, hue, dark ? 0.12 : 0.08),
    rugBorder: mix(page, hue, dark ? 0.26 : 0.2),

    wood,
    woodDark: mix(wood, ink, 0.28),
    woodLight: mix(wood, white, 0.3),
    fabric,
    fabricDark: mix(fabric, ink, 0.24),
    cushionWarm: mix(n600, warm, 0.7),
    cushionCool: mix(n600, hue, 0.7),
    chair,
    chairDark: mix(chair, ink, 0.32),
    metal: mix(page, ink, 0.5),
    metalDark: mix(page, ink, 0.68),
    plastic: mix(page, white, dark ? 0.3 : 0.6),
    plasticDark: mix(page, ink, 0.16),
    glass: mix(page, hue, 0.1),
    paper: mix(white, page, 0.06),
    leafDark: mix(n900, leaf, 0.64),
    leafLit: mix(n400, leaf, 0.76),
    pot: mix(n500, amber, 0.68),
    soil: mix(n800, amber, 0.32),
    screenBezel: mix(page, ink, 0.7),
    screenOff: mix(page, hue, 0.1),
    screenOn: mix(page, hue, 0.16),
    shade: mix(n600, warm, 0.52),
    bulb: mix(white, warm, 0.2),
    gold: mix(amber, white, 0.28),
    cat,
    catDark: mix(cat, ink, 0.3),

    skyTop: dark ? mix(page, hue, 0.36) : mix(page, hue, 0.3),
    skyLow: dark ? mix(page, warm, 0.34) : mix(page, warm, 0.36),
    sea: dark ? mix(page, hue, 0.42) : mix(page, hue, 0.66),
    cloud: mix(page, white, dark ? 0.25 : 0.85),
    sun: dark ? mix(white, hue, 0.35) : mix(white, warm, 0.18),
    lamp: mix(white, warm, 0.34),

    accent: (seat: number) => turn(hue, accentShiftOf(seat)),
  }
}
