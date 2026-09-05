/**
 * The team's cast: one crew member per seat, and a different sea-creature
 * hood per seat, so a member is recognizable in the room before its nameplate
 * is read.
 *
 * Every character is a person — shoes, trousers, a shirt, arms at its sides —
 * wearing a whale or shark as an exquisite plush hood: the hood is drawn in
 * profile, snout forward and flukes over the back of the head, because a whale
 * reads as a whale from the side and as a blob from the front. The face looks out
 * from under its chin with delicate chibi-style catchlights and expressions.
 * Legs and arms are their own groups so the stylesheet can swing them while the
 * member walks.
 *
 * Under the hood everybody is their own person: a hairstyle, a hair colour, a
 * skin tone, an outfit, shoes and one piece of gear, all picked by seat index
 * so a member looks the same on every render and no two neighbours are twins.
 * Tone and skin ride data attributes rather than inline colours, so the theme
 * still owns the palette.
 *
 * A member at work is drawn from BEHIND: the screen faces the room, so its
 * owner faces the screen. The back view keeps the same figure and turns the
 * hood the other way — snout toward the monitor on its left — so the hood is
 * still read in profile while the human face, which nobody needs while somebody
 * is typing, is simply not there to draw.
 */
import { memo } from 'react'
import type { CSSProperties } from 'react'
import css from './TeamStage.module.css'

/** The sea-creature hoods a seat can wear, in the order seats take them. */
export const MASKS = ['blue', 'orca', 'humpback', 'narwhal', 'beluga', 'sperm', 'shark'] as const

/** One kind of sea-creature hood. */
export type MaskKind = typeof MASKS[number]

/** Hue shifts of the room's colour, one per seat: stable, distinct, theme-owned. */
const ACCENTS = [0, 46, 96, 148, 200, 252, 296, 330] as const

/**
 * The seat's own accent, as a style object: the room's one saturated token
 * turned by this much, never a literal color, so a theme change carries every
 * member along. The leader keeps the unturned blue its whale is named for, and
 * the teammates start one step past it.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @returns the custom property the stage styles read.
 */
export function accentOf(seat: number): CSSProperties {
  return { '--team-accent-shift': `${accentShiftOf(seat)}deg` } as CSSProperties
}

/**
 * How far this seat turns the room's hue, in degrees: the number behind
 * `accentOf`, for the WebGL room to paint a member's mug and cushion in the
 * same colour its hood wears.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @returns the hue shift.
 */
export function accentShiftOf(seat: number): number {
  return seat < 0 ? 0 : ACCENTS[(seat + 1) % ACCENTS.length] ?? 0
}

/** Pick the nth entry of a wardrobe rack, counting the leader as the first. */
function pick<T>(rack: readonly T[], seat: number): T {
  return rack[(Math.max(0, seat + 1)) % rack.length] ?? rack[0]!
}

/**
 * The hood one seat wears: the leader takes the blue whale the room is built
 * around, teammates take the rest in roster order.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @returns the kind.
 */
export function maskOf(seat: number): MaskKind {
  if (seat < 0) return 'blue'
  return pick(MASKS, seat)
}

/** The outfits a seat can wear, in the order seats take them. */
export const OUTFITS = [
  'shirt', 'tee', 'sweater', 'polo', 'hoodie', 'tunic', 'vest', 'jacket', 'stripes', 'dungarees',
] as const

/** One kind of outfit. */
export type OutfitKind = typeof OUTFITS[number]

/** The shoes a seat can wear, in the order seats take them. */
export const SHOE_KINDS = ['sneaker', 'boot', 'loafer', 'hightop', 'sandal'] as const

/** One kind of shoe. */
export type ShoeKind = typeof SHOE_KINDS[number]

/** The hairstyles a seat can wear, in the order seats take them. */
export const HAIRS = ['fringe', 'bun', 'curls', 'crop', 'ponytail', 'buzz'] as const

/** One hairstyle. */
export type HairKind = typeof HAIRS[number]

/** The one thing a member carries or wears besides its clothes. */
export const GEARS = ['none', 'glasses', 'headphones', 'scarf', 'lanyard', 'backpack'] as const

/** One piece of gear. */
export type GearKind = typeof GEARS[number]

/** How many hair colours the stylesheet keeps. */
const HAIR_TONES = 5

/** How many skin tones the stylesheet keeps. */
const SKIN_TONES = 4

/**
 * The outfit one seat wears: the leader keeps the tailored shirt, teammates
 * take the rest in roster order, so a full team is not a row of identical
 * shirts.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @returns the kind.
 */
export function outfitOf(seat: number): OutfitKind {
  if (seat < 0) return 'shirt'
  return pick(OUTFITS, seat)
}

/**
 * The shoes one seat wears; each pair is tinted by the seat's own accent.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @returns the kind.
 */
export function shoeOf(seat: number): ShoeKind {
  if (seat < 0) return 'sneaker'
  return pick(SHOE_KINDS, seat)
}

/**
 * The hairstyle one seat wears. It is picked off a different-length rack to
 * the outfits and the hoods, so the three cycles fall out of step and two
 * members never end up dressed identically from head to foot.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @returns the kind.
 */
export function hairOf(seat: number): HairKind {
  if (seat < 0) return 'crop'
  return pick(HAIRS, seat)
}

/**
 * Which of the stylesheet's hair colours this seat has. Hair is NOT tinted by
 * the seat accent: rotating the room's blue would give a team with green and
 * magenta hair, and the accent is already carried by the hood, the mug and the
 * shoes.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @returns the tone index the stylesheet keys on.
 */
export function toneOf(seat: number): number {
  return (Math.max(0, seat + 1) * 3) % HAIR_TONES
}

/**
 * Which of the stylesheet's skin tones this seat has.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @returns the tone index the stylesheet keys on.
 */
export function skinOf(seat: number): number {
  return (Math.max(0, seat + 1) * 5) % SKIN_TONES
}

/**
 * The one thing this seat wears besides its clothes. A third of the team
 * carries nothing: gear reads as a detail only while it is not universal.
 * @param seat - the member's index on the roster; the leader passes -1.
 * @returns the kind.
 */
export function gearOf(seat: number): GearKind {
  if (seat < 0) return 'lanyard'
  return pick(GEARS, seat)
}

/** One shoe path, mirrored per side. */
function shoePath(kind: ShoeKind, side: 'left' | 'right'): string {
  const flip = side === 'right'
  const inner = flip ? 32.9 : 31.1
  const outer = flip ? 45.2 : 18.8
  const toe = flip ? 42 : 22
  const way = flip ? -1 : 1
  if (kind === 'boot') {
    return `M${toe} 78 H${inner} V95 Q${inner} 100 ${inner - way * 3.5} 100 `
      + `H${outer + way * 1.6} Q${outer} 100 ${outer} 98.4 L${outer} 93.5 L${outer + way * 2} 92 L${toe} 90.5 Z`
  }
  if (kind === 'loafer') {
    return `M${toe} 93 H${inner} V97 Q${inner} 100 ${inner - way * 3.5} 100 `
      + `H${outer + way * 1.6} Q${outer} 100 ${outer} 98.4 Q${outer} 96.8 ${outer + way * 2} 95.9 L${toe} 94.8 Z`
  }
  if (kind === 'hightop') {
    return `M${toe} 85 H${inner} V96 Q${inner} 100 ${inner - way * 3.5} 100 `
      + `H${outer + way * 1.6} Q${outer} 100 ${outer} 98.2 Q${outer} 96 ${outer + way * 2} 94.8 L${toe} 93.2 Z`
  }
  if (kind === 'sandal') {
    return `M${toe} 95.5 H${inner} V97.5 Q${inner} 100 ${inner - way * 3.5} 100 `
      + `H${outer + way * 1.6} Q${outer} 100 ${outer} 98.6 Q${outer} 97.4 ${outer + way * 2} 96.8 L${toe} 96.2 Z`
  }
  return `M${toe} 90 H${inner} V97 Q${inner} 100 ${inner - way * 3.5} 100 `
    + `H${outer + way * 1.6} Q${outer} 100 ${outer} 98.4 Q${outer} 96.6 ${outer + way * 2} 95.4 L${toe} 94.2 Z`
}

/** The sole edge under a shoe, and the laces, buckles or straps across it. */
function shoeTrim(kind: ShoeKind, side: 'left' | 'right') {
  const flip = side === 'right'
  const at = flip ? 37 : 27
  const toeX = flip ? 41 : 23
  if (kind === 'sandal') {
    return (
      <>
        <path className={css.crewShoeTrim} d={`M${at - 4.5} 97.5 L${at + 4.5} 96.5 M${at - 4.5} 99 L${at + 4.5} 98.2`} />
        <path className={css.crewShoeSole} d={`M${at - 5} 99.5 H${at + 5}`} />
      </>
    )
  }
  if (kind === 'boot') {
    return (
      <>
        <path className={css.crewShoeTrim} d={`M${at - 4.2} 82.5 H${at + 4.2} M${at - 4.2} 86.5 H${at + 4.2} M${at - 4.2} 90.5 H${at + 4.2}`} />
        <path className={css.crewShoeSole} d={`M${at - 5.5} 99.2 H${at + 5.5}`} />
        <circle className={css.crewShoeEyelet} cx={at - 2.5} cy={82.5} r={0.6} />
        <circle className={css.crewShoeEyelet} cx={at + 2.5} cy={82.5} r={0.6} />
        <circle className={css.crewShoeEyelet} cx={at - 2.5} cy={86.5} r={0.6} />
        <circle className={css.crewShoeEyelet} cx={at + 2.5} cy={86.5} r={0.6} />
      </>
    )
  }
  if (kind === 'hightop') {
    return (
      <>
        <path className={css.crewShoeTrim} d={`M${at - 3.8} 88.5 H${at + 3.8} M${at - 3.8} 92 H${at + 3.8}`} />
        <circle className={css.crewShoeBadge} cx={flip ? at - 2 : at + 2} cy={89} r={1.6} />
        <path className={css.crewShoeToe} d={`M${toeX - 2.2} 95.5 Q${toeX} 93.5 ${toeX + 2.2} 95.5`} />
        <path className={css.crewShoeSole} d={`M${at - 5.2} 99 H${at + 5.2}`} />
      </>
    )
  }
  if (kind === 'loafer') {
    return (
      <>
        <path className={css.crewShoeTrim} d={`M${at - 3.5} 95.5 H${at + 3.5}`} />
        <rect className={css.crewShoeBuckle} x={at - 2} y={94.5} width={4} height={2} rx={0.6} />
        <path className={css.crewShoeSole} d={`M${at - 5} 99.2 H${at + 5}`} />
      </>
    )
  }
  // Sneaker
  return (
    <>
      <path className={css.crewShoeTrim} d={`M${at - 3.8} 93 H${at + 3.8} M${at - 3.2} 95.2 H${at + 3.2}`} />
      <path className={css.crewShoeToe} d={`M${toeX - 2} 96 Q${toeX} 94.2 ${toeX + 2} 96`} />
      <path className={css.crewShoeSole} d={`M${at - 5.2} 99 H${at + 5.2}`} />
      <path className={css.crewShoeStripe} d={`M${at - 3} 94.5 Q${at} 96.5 ${at + 3} 94.5`} />
    </>
  )
}

/** The whale worn as a hood: flukes at the left, snout out to the right, contoured curves. */
const WHALE = 'M9 10 C9 -7 20 -17 37 -17 C52 -17 62 -9 66 1.5 '
  + 'C67.5 5 66 9.2 61.5 9.8 C52 11.5 44 15.5 36 20.5 C28 25.5 18.5 26.5 13.5 24.5 '
  + 'C9.8 22.5 9 17 9 10 Z'

/** The flukes, one upper lobe and one lower lobe with refined scalloped curve. */
const FLUKES = 'M10 2.5 C4.5 -1.5 0.5 -7.5 -0.5 -15 C5.5 -12 10 -6.5 12.5 -1.5 Z '
  + 'M9 14.5 C4 17.5 0 23 -2 29.5 C4.5 28 9.5 23.5 13 18.5 Z'

/** The pale underside, from the throat pleats to the tip of the lower jaw. */
const BELLY = 'M14 21.5 C20.5 24.5 28.5 23.5 35.5 19.5 C42.5 15.5 51.5 11 59.5 10 '
  + 'C51.5 15.5 43.5 19.5 35.5 23 C27.5 26.5 18 26.5 14 21.5 Z'

/** The inner face opening of the plush hood, casting an ambient shadow over the face. */
const HOOD_OPENING_RIM = 'M18 28.5 C18 19.5 23.5 13 32 13 C40.5 13 46 19.5 46 28.5 C46 36.5 40 43 32 43 C24 43 18 36.5 18 28.5 Z'

/** The shirt: refined shoulder curve, straight body, tailored hem over the hips. */
const SHIRT = 'M32 46 C40.5 46 46 50.2 47 58.5 L48 76 C48 79 46.2 80.5 43 80.5 '
  + 'L21 80.5 C17.8 80.5 16 79 16 76 L17 58.5 C18 50.2 23.5 46 32 46 Z'

/** The seam over each shoulder, where the sleeve is set into the body. */
const SHOULDER_SEAM = 'M21.5 51 C23.5 54.5 24 59.5 24 64 M42.5 51 C40.5 54.5 40 59.5 40 64'

/** The fold the hem falls into over the hips. */
const HEM_FOLD = 'M17.5 77.5 C24 79.8 40 79.8 46.5 77.5'

/**
 * The back of the head hairstyles, richly styled with layers, highlights,
 * textures and distinct shapes.
 */
const CAPS: Record<HairKind, string> = {
  fringe: 'M17.5 30 C17.5 17.5 23 10.5 32 10.5 C41 10.5 46.5 17.5 46.5 30 C46.5 33.5 44.8 35.5 42.5 35.5 '
    + 'C40 35.5 39 32 36 32 C33 32 32 35.5 29 35.5 C26 35.5 25 32 23 32 C21 32 19.2 34.5 17.5 34 Z',
  crop: 'M18 28 C18 17 23.5 10.5 32 10.5 C40.5 10.5 46 17 46 28 C46 30.8 44.6 31.8 42.8 30.8 '
    + 'C40.6 29.5 39.2 25.8 32 25.8 C24.8 25.8 23.4 29.5 21.2 30.8 C19.4 31.8 18 30.8 18 28 Z',
  buzz: 'M18.5 27 C18.5 17 24 11 32 11 C40 11 45.5 17 45.5 27 C45.5 28.8 44.2 29.2 43 28.4 '
    + 'C40.5 26.2 37 24.8 32 24.8 C27 24.8 23.5 26.2 21 28.4 C19.8 29.2 18.5 28.8 18.5 27 Z',
  curls: 'M17.5 29 C17.5 17.5 22.8 10.5 32 10.5 C41.2 10.5 46.5 17.5 46.5 29 C46.5 32.5 44.5 33.8 42.8 32 '
    + 'C41.5 30.6 40.5 32 39 31.2 C37.5 30.5 37.2 28.4 35.5 28.4 C33.6 28.4 33.2 30.8 32 30.8 '
    + 'C30.8 30.8 30.4 28.4 28.5 28.4 C26.8 28.4 26.5 30.5 25 31.2 C23.5 32 22.5 30.6 21.2 32 '
    + 'C19.5 33.8 17.5 32.5 17.5 29 Z',
  bun: 'M18 29 C18 17.5 23.2 10.5 32 10.5 C40.8 10.5 46 17.5 46 29 C46 31.8 44.2 33.2 42.2 32.2 '
    + 'C40.2 31.2 39 26.8 32 26.8 C25 26.8 23.8 31.2 21.8 32.2 C19.8 33.2 18 31.8 18 29 Z',
  ponytail: 'M18 30 C18 17.5 23.2 10.5 32 10.5 C40.8 10.5 46 17.5 46 30 C46 32.8 44.2 33.8 42.2 32.8 '
    + 'C40.2 31.8 39 27.2 32 27.2 C25 27.2 23.8 31.8 21.8 32.8 C19.8 33.8 18 32.8 18 30 Z',
}

/** The mass of hair that only shows when you are looking at the back of a head. */
const NAPE = 'M18.5 27 C18.5 40 23.8 45 32 45 C40.2 45 45.5 40 45.5 27 Z'

/** Soft highlights across the hair strands. */
const HAIR_SHINE = 'M23.5 21 C25.5 15.5 29 13 33.5 12.5 C30.5 16 28.5 20 27 24 Z'
const HAIR_SHINE_SECONDARY = 'M36 14 C39 16.5 41 20 42 24.5 C40.5 21 38.5 17.5 36 14 Z'

/** A cool highlight along the whale hood's dorsal curve, giving it smooth 3D luster. */
const HOOD_SHEEN = 'M16 -3.5 C17.5 -11 23 -15.5 31 -16.5 C25.5 -12.5 21 -8 18.5 -2.5 Z'
const HOOD_RIDGE_HIGHLIGHT = 'M32 -16.5 C45 -16.5 55 -9.5 60 1.5 C55 -6 44 -14.5 32 -15 Z'

/** A soft shadow under the whale's jaw, where the hood meets the collar. */
const HOOD_SHADE = 'M13.5 21 C19.5 25 28 25 35 22 C42 19 50 14.5 59.5 11 '
  + 'C52 16 44.5 19 37.5 21.5 C29.5 24.2 20.5 24.8 13.5 21 Z'

/** A ribbed hem across the bottom of a sweater. */
const RIB_HEM = 'M16 73.5 L48 73.5 L48 80.5 L16 80.5 Z'

/** The collar of a buttoned shirt: one soft curve under the hood's chin. */
const COLLAR = 'M25 48.5 C28 52.8 36 52.8 39 48.5'

/** The self-edge neckband of a jersey, folded back on itself. */
const NECK_BAND = 'M24.5 48 C27.5 51.8 36.5 51.8 39.5 48 C38.5 53.5 25.5 53.5 24.5 48 Z'

/** A kangaroo pocket across the front of a hoodie with reinforced corner bar-tacks. */
const POCKET = 'M26.5 56.5 C28.5 53 35.5 53 37.5 56.5 L39 63.5 L25 63.5 Z'

/** The hood fabric lying around the neck of a hoodie. */
const HOOD_FABRIC = 'M23.5 43.5 C23.5 32 27.5 27.5 32 27.5 C36.5 27.5 40.5 32 40.5 43.5 '
  + 'L40.5 47.5 C36.5 49 27.5 49 23.5 47.5 Z'

/** A knitted vest, open at the neck and stopping short of the hem. */
const VEST = 'M32 47 C38.5 47 43 50.5 44 57 L45 73 C45 75.5 43.5 76.5 41 76.5 '
  + 'L23 76.5 C20.5 76.5 19 75.5 19 73 L20 57 C21 50.5 25.5 47 32 47 Z '
  + 'M32 47 L26.5 56.5 L32 63 L37.5 56.5 Z'

/** The two front panels of an open tailored jacket. */
const JACKET = 'M23.5 47.5 C20.5 50 18.5 54.5 18 59 L17 76.5 L27.5 76.5 L29.5 52 Z '
  + 'M40.5 47.5 C43.5 50 45.5 54.5 46 59 L47 76.5 L36.5 76.5 L34.5 52 Z'

/** The bib and straps of a pair of dungarees. */
const BIB = 'M25 57.5 H39 V72.5 H25 Z'

/** The straps over the shoulders of a pair of dungarees with buckles. */
const STRAPS = 'M25.5 57.5 L23 47.5 M38.5 57.5 L41 47.5'

/** Stripes across the front of a jersey. */
const STRIPES = 'M17.5 54.5 H46.5 M17.2 60.5 H46.8 M17 66.5 H47 M16.8 72.5 H47.2 M16.5 78 H47.5'

/** Whale ventral grooves (throat pleats) on Blue Whale and Humpback. */
const THROAT_PLEATS = 'M36 21.5 C42 18.5 50 13.5 57 11 M33 23 C39 20 46 16 53 13.5 M30 24.5 C36 21.5 42 18.5 48 16'

/** What one kind wears behind the whale, so its base merges into the hood. */
function behind(kind: MaskKind) {
  switch (kind) {
    case 'orca':
      return (
        <>
          <path className={css.crewHood} d="M25 -13 C26 -24 31 -31 40 -34 C37 -25 33 -18 31.5 -13 Z" />
          {/* Orca saddle patch behind dorsal fin */}
          <path className={css.crewSaddle} d="M19 -10 C23 -14 28 -14 31 -11 C28 -8 22 -7 19 -10 Z" />
        </>
      )
    case 'humpback':
      return (
        <>
          {/* Distinctive curved dorsal fin/hump on back of hood */}
          <path className={css.crewHood} d="M22 -14 C25 -20 30 -22 35 -17 Z" />
          {/* Gracefully swept pectoral fin along the whale's flank */}
          <path className={css.crewHood} d="M30 14 C36 19 40 26 43 33 C40 25 36 18 31 13 Z" />
          <path className={css.crewFlipperTrim} d="M38 24 C40 28 42 32 42.5 32" />
        </>
      )
    case 'narwhal':
      return (
        <g className={css.crewTuskGroup}>
          {/* Spiral ivory tusk with shadow & helical ridge texture */}
          <path className={css.crewTusk} d="M63.5 5.5 L84 -3.5" />
          <path className={css.crewTuskSpiral} d="M66 4.5 L67.5 3.8 M71 2.5 L72.5 1.8 M76 0.5 L77.5 -0.2 M80.5 -1.5 L82 -2.2" />
        </g>
      )
    case 'sperm':
      return (
        <>
          {/* Square blunt brow with dorsal humps/ripples */}
          <path className={css.crewHood} d="M38 -16 L59 -16 C63.5 -16 66.5 -12.5 66.5 -8 L66.5 9.5 C57 10.5 47.5 14 38 17.5 Z" />
          <path className={css.crewWrinkle} d="M24 -11 C26 -14 30 -14 32 -12 M34 -13 C36 -15 39 -15 41 -13" />
        </>
      )
    case 'shark':
      return (
        <>
          {/* Tall swept-back dorsal fin */}
          <path className={css.crewHood} d="M34 -21 C37 -29 42 -35 52 -36 C48.5 -27 44 -19 39 -11 Z" />
          <path className={css.crewHoodSheen} d="M46 -30 C43 -24 40 -18 37 -13" />
        </>
      )
    case 'beluga':
    case 'blue':
    default:
      return null
  }
}

/** What one kind adds over the whale. */
function front(kind: MaskKind) {
  switch (kind) {
    case 'orca':
      return (
        <>
          <ellipse className={css.crewPatch} cx="47" cy="-4.5" rx="7" ry="3.4" transform="rotate(-16 47 -4.5)" />
          <circle className={css.crewEyeGlint} cx="48" cy="-5" r="0.7" />
        </>
      )
    case 'humpback':
      return (
        <>
          <path className={css.crewPleat} d={THROAT_PLEATS} />
          {/* Raised sensory tubercles along snout and jaw */}
          {[[43, -7], [49, -3], [54, 0], [59, 2.5], [63, 4.5], [47, 8], [53, 6.5]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle className={css.crewKnob} cx={x} cy={y} r="1.6" />
              <circle className={css.crewKnobHighlight} cx={(x ?? 0) - 0.4} cy={(y ?? 0) - 0.4} r="0.6" />
            </g>
          ))}
        </>
      )
    case 'beluga':
      return (
        <>
          {/* Bulbous rounded melon forehead */}
          <path className={css.crewMelon} d="M21 -9.5 C27 -19.5 43 -19.5 51 -11.5 C40.5 -13.5 28.5 -12 21 -9.5 Z" />
          <path className={css.crewMelonHighlight} d="M28 -14.5 C34 -17.5 42 -17 46 -13" />
        </>
      )
    case 'shark':
      return (
        <>
          <path className={css.crewGill} d="M37 4.5 C39.5 6 39.5 9.5 37 11.5" />
          <path className={css.crewGill} d="M41 3.5 C43.5 5 43.5 8.5 41 10.5" />
          <path className={css.crewGill} d="M45 2.5 C47.5 4 47.5 7.5 45 9.5" />
          <path className={css.crewGill} d="M49 2 C51 3.5 51 6.5 49 8.5" />
        </>
      )
    case 'blue':
      return (
        <>
          <path className={css.crewPleat} d={THROAT_PLEATS} />
          {/* Double water spout with delicate droplets */}
          <path className={css.crewSpout} d="M43 -15 C42 -22 40 -27 36 -30" />
          <path className={css.crewSpout} d="M44 -15 C47 -22 50 -26 55 -28" />
          <path className={css.crewSpout} d="M43.5 -15 C41 -20 37 -23 32 -24" />
          <circle className={css.crewDroplet} cx="35" cy="-31.5" r="1.1" />
          <circle className={css.crewDroplet} cx="56.5" cy="-29" r="1.2" />
          <circle className={css.crewDroplet} cx="31" cy="-25" r="0.9" />
          <circle className={css.crewDroplet} cx="46" cy="-29" r="0.8" />
        </>
      )
    case 'sperm':
      return (
        <>
          {/* Blowhole on left snout corner */}
          <ellipse className={css.crewBlowhole} cx="63" cy="-12" rx="1.8" ry="1.2" transform="rotate(-15 63 -12)" />
          <path className={css.crewSpout} d="M63 -13 C66 -19 71 -22 75 -24" />
          <circle className={css.crewDroplet} cx="76" cy="-25" r="1" />
        </>
      )
    case 'narwhal':
      return (
        <>
          {/* Narwhal skin speckles */}
          <circle className={css.crewSpeckle} cx="30" cy="-6" r="0.8" />
          <circle className={css.crewSpeckle} cx="37" cy="-9" r="0.9" />
          <circle className={css.crewSpeckle} cx="44" cy="-5" r="0.7" />
          <circle className={css.crewSpeckle} cx="51" cy="0" r="0.8" />
        </>
      )
    default:
      return null
  }
}

/** The part of a hairstyle that hangs behind the head, drawn under the face. */
function hairBehind(kind: HairKind, back: boolean) {
  if (kind === 'ponytail') {
    return (
      <g className={css.crewHairGroup}>
        <path
          className={css.crewHair}
          d={back
            ? 'M32 23 C36.5 23 39 27.5 39 34 C39 42.5 37 49 35 53 L29 53 C31 49 33 42.5 33 34 C33 27.5 29.5 25.5 32 23 Z'
            : 'M43.5 25.5 C48 27.5 50.5 32.5 50 39 C49.5 45.5 47 49.5 44 52 C46.5 46.5 47 40 46 35 C45.2 30.5 44 27.5 43.5 25.5 Z'}
        />
        <path
          className={css.crewHairHighlight}
          d={back
            ? 'M35 28 C37 34 36.5 43 34 49'
            : 'M46.5 30 C48 35 47.5 41 45.5 46'}
        />
      </g>
    )
  }
  if (kind === 'curls' && back) {
    return (
      <g className={css.crewHairGroup}>
        <path className={css.crewHair} d="M16.5 29.5 C12.5 31.5 12 38 15.5 41.5 C17.8 43.8 20.2 42.5 21 39.5 Z M47.5 29.5 C51.5 31.5 52 38 48.5 41.5 C46.2 43.8 43.8 42.5 43 39.5 Z" />
        <circle className={css.crewHair} cx="13" cy="35" r="2.5" />
        <circle className={css.crewHair} cx="51" cy="35" r="2.5" />
      </g>
    )
  }
  return null
}

/** The part of a hairstyle that sits over everything, like a bun. */
function hairAbove(kind: HairKind) {
  if (kind !== 'bun') return null
  return (
    <g className={css.crewHairGroup}>
      <circle className={css.crewHair} cx="32" cy="7.5" r="6.6" />
      <path className={css.crewHairShine} d="M28 4.8 C29.2 2.6 31.5 1.6 33.8 2.1 C31.6 2.8 29.8 4 29 5.8 Z" />
      <ellipse className={css.crewScrunchie} cx="32" cy="13.2" rx="3.8" ry="1.4" />
    </g>
  )
}

/**
 * Gear worn UNDER the hood. Headphones go on before the whale does: the cushioned
 * band runs over the head, and the plush ear cups sit naturally on both ears
 * under the jawline with metal pivots.
 */
function headGearUnder(kind: GearKind) {
  if (kind !== 'headphones') return null
  return (
    <g className={css.crewCans}>
      {/* Over-head headband */}
      <path className={css.crewCansBand} d="M16 31 C16 15.5 23 8.5 32 8.5 C41 8.5 48 15.5 48 31" />
      {/* Left ear cup and plush cushion */}
      <rect className={css.crewCansCup} x="11.5" y="25.5" width="8.6" height="13" rx="4.3" />
      <rect className={css.crewCansCushion} x="17.5" y="27" width="2.6" height="10" rx="1.3" />
      <circle className={css.crewCansPivot} cx="15.8" cy="27" r="1.2" />

      {/* Right ear cup and plush cushion */}
      <rect className={css.crewCansCup} x="43.9" y="25.5" width="8.6" height="13" rx="4.3" />
      <rect className={css.crewCansCushion} x="43.9" y="27" width="2.6" height="10" rx="1.3" />
      <circle className={css.crewCansPivot} cx="48.2" cy="27" r="1.2" />
    </g>
  )
}

/**
 * Gear worn OVER everything: glasses sit on the face, and the hood's jaw
 * stays clear of them, so the lenses read as lenses with clear glass reflections.
 */
function headGearOver(kind: GearKind, back: boolean) {
  if (kind !== 'glasses' || back) return null
  return (
    <g className={css.crewGlasses}>
      <rect className={css.crewGlassesFrame} x="20.5" y="26" width="10" height="8" rx="3.5" />
      <rect className={css.crewGlassesFrame} x="33.5" y="26" width="10" height="8" rx="3.5" />
      <path className={css.crewGlassesGlass} d="M22 28 L27 32 M35 28 L40 32" />
      <path className={css.crewGlassesBridge} d="M30.5 29.5 H33.5 M20.5 29 L16.8 30.2 M43.5 29 L47.2 30.2" />
    </g>
  )
}

/** Whatever a member wears over its clothes. */
function bodyGear(kind: GearKind, back: boolean) {
  switch (kind) {
    case 'scarf':
      return (
        <g className={css.crewScarfGroup}>
          <path className={css.crewScarf} d="M22.5 44.5 C26.5 50 37.5 50 41.5 44.5 L43 53.5 C37 57 27 57 21 53.5 Z" />
          <path className={css.crewScarfPattern} d="M24 47.5 L26 53 M29 48.5 L31 54.5 M34 48.5 L36 54.5 M39 47.5 L41 53" />
          <path className={css.crewScarf} d={back ? 'M28.5 54 L27 68.5 L33 69 L34.5 54 Z' : 'M39 54 L41.5 69.5 L35.5 70 L34 54 Z'} />
          <path className={css.crewScarfFringe} d={back ? 'M27 68.5 L26.5 71.5 M29 68.7 L28.8 71.8 M31 68.9 L31.2 72 M33 69 L33.5 72' : 'M35.5 70 L35 73 M37.5 69.8 L37.5 73 M39.5 69.6 L40 72.8 M41.5 69.5 L42.2 72.5'} />
        </g>
      )
    case 'lanyard':
      return (
        <g className={css.crewLanyardGroup}>
          <path className={css.crewCord} d="M26.5 47.5 L31.2 62 M37.5 47.5 L32.8 62" />
          <circle className={css.crewClip} cx="32" cy="62" r="1.2" />
          {!back && (
            <>
              <rect className={css.crewBadge} x="28.2" y="62.8" width="7.6" height="9.8" rx="1.6" />
              <rect className={css.crewBadgePhoto} x="29.4" y="64" width="2.6" height="3" rx="0.5" />
              <path className={css.crewBadgeLine} d="M32.8 64.8 H34.8 M32.8 66.2 H34.5 M29.4 68.5 H34.6" />
            </>
          )}
        </g>
      )
    case 'backpack':
      return back
        ? (
          <g className={css.crewBackpackGroup}>
            <path className={css.crewPack} d="M22.5 51.5 C22.5 47.5 26 46 32 46 C38 46 41.5 47.5 41.5 51.5 L41.5 71 C41.5 74.5 38.5 75.5 32 75.5 C25.5 75.5 22.5 74.5 22.5 71 Z" />
            <path className={css.crewPackPocket} d="M24.5 59.5 H39.5 V71 C39.5 73 37.5 74 32 74 C26.5 74 24.5 73 24.5 71 Z" />
            <path className={css.crewPackTrim} d="M25 59.5 H39 M27.5 53 H36.5" />
            <rect className={css.crewPackZip} x="31" y="58.5" width="2" height="2" rx="0.5" />
            <path className={css.crewPackHandle} d="M29 46 C29 43.5 35 43.5 35 46" />
          </g>
        )
        : (
          <g className={css.crewBackpackGroup}>
            <path className={css.crewStrap} d="M25 47.5 C24.5 56 25 64.5 26 71.5 M39 47.5 C39.5 56 39 64.5 38 71.5" />
            <rect className={css.crewStrapBuckle} x="24" y="60" width="2.4" height="2" rx="0.5" />
            <rect className={css.crewStrapBuckle} x="37.6" y="60" width="2.4" height="2" rx="0.5" />
          </g>
        )
    default:
      return null
  }
}

/**
 * The head. Face on: the person looks out from under the whale's chin. From
 * behind — which is how you see somebody who is at their own computer — there
 * is no face to draw, both ears show, the back of the head is all hair, and
 * the whale looks the other way.
 */
function head(kind: MaskKind, hair: HairKind, gear: GearKind, back: boolean) {
  return (
    <>
      {hairBehind(hair, back)}
      <ellipse className={css.crewEar} cx="17.2" cy="32" rx="3.4" ry="4" />
      {back && <ellipse className={css.crewEar} cx="46.8" cy="32" rx="3.4" ry="4" />}
      <path
        className={css.crewFace}
        d="M32 11.5 C42 11.5 46.5 19.5 46.5 29 C46.5 39 40.5 44.5 32 44.5 C23.5 44.5 17.5 39 17.5 29 C17.5 19.5 22 11.5 32 11.5 Z"
      />
      {back && <path className={css.crewHair} d={NAPE} />}
      {!back && (
        <g className={css.crewFacialGroup}>
          {/* Eyebrows with soft curves */}
          <path className={css.crewBrow} d="M21.5 25 Q25.5 22.5 29.8 24.2" />
          <path className={css.crewBrow} d="M34.2 24.2 Q38.5 22.5 42.5 25" />
          {/* Expressive eyes with dual sparkle catchlights */}
          <circle className={css.crewPupil} cx="26.8" cy="30" r="1.6" />
          <circle className={css.crewPupil} cx="37.2" cy="30" r="1.6" />
          <circle className={css.crewEyeGlint} cx="27.5" cy="29.2" r="0.65" />
          <circle className={css.crewEyeGlint} cx="37.9" cy="29.2" r="0.65" />
          <circle className={css.crewEyeGlintSub} cx="26.2" cy="30.8" r="0.35" />
          <circle className={css.crewEyeGlintSub} cx="36.6" cy="30.8" r="0.35" />
          {/* Cute nose dot & smile */}
          <circle className={css.crewNose} cx="32" cy="32.8" r="0.5" />
          <path className={css.crewSmile} d="M28.2 35.8 Q32 39 35.8 35.8" />
          {/* Delicate blush on cheeks */}
          <ellipse className={css.crewBlush} cx="21" cy="33.2" rx="2.4" ry="1.5" />
          <ellipse className={css.crewBlush} cx="43" cy="33.2" rx="2.4" ry="1.5" />
        </g>
      )}
      <path className={css.crewHair} d={CAPS[hair]} />
      <path className={css.crewHairShine} d={HAIR_SHINE} />
      <path className={css.crewHairShine} d={HAIR_SHINE_SECONDARY} />
      {headGearUnder(gear)}

      {/* The whale hood in profile, pulled down warmly over the head */}
      <g transform={back ? 'translate(64 3) scale(-1 1)' : 'translate(0 3)'}>
        {behind(kind)}
        <path className={css.crewHood} d={WHALE} />
        <path className={css.crewHood} d={FLUKES} />
        <path className={css.crewBelly} d={BELLY} />
        <path className={css.crewHoodOpening} d={HOOD_OPENING_RIM} />
        {front(kind)}
        <path className={css.crewHoodSheen} d={HOOD_SHEEN} />
        <path className={css.crewHoodRidge} d={HOOD_RIDGE_HIGHLIGHT} />
        <path className={css.crewHoodShade} d={HOOD_SHADE} />
        {/* Cute whale eye with glistening catchlight */}
        <circle className={css.crewEye} cx="53" cy="0" r="2.8" />
        <circle className={css.crewPupil} cx="53.8" cy="0.4" r="1.3" />
        <circle className={css.crewEyeGlint} cx="54.4" cy="-0.2" r="0.55" />
        <circle className={css.crewEyeGlintSub} cx="53.2" cy="0.8" r="0.3" />
        <path className={css.crewMouth} d="M48.5 9.8 C53.5 7.8 58.5 6.2 62.5 5.8" />
      </g>
      {hairAbove(hair)}
      {headGearOver(gear, back)}
    </>
  )
}

/** What one outfit adds over the plain body, seen from the front. */
function outfitFront(outfit: OutfitKind) {
  switch (outfit) {
    case 'shirt':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewCollar} d={COLLAR} />
          <path className={css.crewPlacket} d="M32 50 L32 79" />
          <circle className={css.crewButton} cx="32" cy="55" r="0.9" />
          <circle className={css.crewButton} cx="32" cy="63" r="0.9" />
          <circle className={css.crewButton} cx="32" cy="71" r="0.9" />
          <path className={css.crewPocketStitch} d="M37.5 57 H44 V64.5 H37.5 Z" />
          <path className={css.crewPenClip} d="M41 55.5 V59.5" />
        </g>
      )
    case 'polo':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewCollar} d={COLLAR} />
          <path className={css.crewPlacket} d="M32 49 L32 60.5" />
          <circle className={css.crewButton} cx="32" cy="53.5" r="0.85" />
          <circle className={css.crewButton} cx="32" cy="58" r="0.85" />
          <circle className={css.crewCrest} cx="39" cy="56" r="1.4" />
        </g>
      )
    case 'tee':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewNeckBand} d={NECK_BAND} />
          <path className={css.crewStitch} d="M17.5 67 H23.5 M40.5 67 H46.5" />
        </g>
      )
    case 'sweater':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewNeckBand} d="M24 46.5 C27.5 51.5 36.5 51.5 40 46.5 C38.5 54 25.5 54 24 46.5 Z" />
          <path className={css.crewRib} d={RIB_HEM} />
          <path className={css.crewKnitLine} d="M28 54 V73.5 M32 54 V73.5 M36 54 V73.5" />
        </g>
      )
    case 'hoodie':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewDraw} d="M28.5 47 L30 56" />
          <path className={css.crewDraw} d="M35.5 47 L34 56" />
          <circle className={css.crewAglet} cx="30" cy="56" r="0.6" />
          <circle className={css.crewAglet} cx="34" cy="56" r="0.6" />
          <path className={css.crewPocket} d={POCKET} />
        </g>
      )
    case 'tunic':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewStitch} d="M20.5 50 L20.5 78 M43.5 50 L43.5 78" />
          <path className={css.crewBelt} d="M17.5 68 Q32 72.5 46.5 68" />
          <rect className={css.crewBuckle} x="30.2" y="68.2" width="3.6" height="3" rx="0.6" />
        </g>
      )
    case 'vest':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewCollar} d={COLLAR} />
          <path className={css.crewVest} d={VEST} />
          <path className={css.crewRib} d="M19 73 L45 73 L45 76.5 L19 76.5 Z" />
        </g>
      )
    case 'jacket':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewJacket} d={JACKET} />
          <path className={css.crewCollar} d="M23.5 48 L29 52.5 M40.5 48 L35 52.5" />
          <circle className={css.crewButton} cx="27.5" cy="62" r="1" />
          <circle className={css.crewButton} cx="27.5" cy="70" r="1" />
        </g>
      )
    case 'stripes':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewNeckBand} d={NECK_BAND} />
          <path className={css.crewStripes} d={STRIPES} />
        </g>
      )
    case 'dungarees':
    default:
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewNeckBand} d={NECK_BAND} />
          <path className={css.crewBib} d={BIB} />
          <path className={css.crewDraw} d={STRAPS} />
          <circle className={css.crewButton} cx="26.2" cy="58.2" r="1" />
          <circle className={css.crewButton} cx="37.8" cy="58.2" r="1" />
          <path className={css.crewStitch} d="M28 62 H36 V68 H28 Z" />
        </g>
      )
  }
}

/** What one outfit adds over the plain body, seen from behind. */
function outfitBack(outfit: OutfitKind) {
  switch (outfit) {
    case 'shirt':
    case 'polo':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewCollar} d="M24.5 49 L39.5 49" />
          <path className={css.crewStitch} d="M25.5 57 C29 60.5 35 60.5 38.5 57" />
        </g>
      )
    case 'sweater':
    case 'vest':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewRib} d={RIB_HEM} />
          <path className={css.crewKnitLine} d="M28 54 V73.5 M32 54 V73.5 M36 54 V73.5" />
        </g>
      )
    case 'jacket':
      return <path className={css.crewStitch} d="M32 48 L32 79" />
    case 'stripes':
      return <path className={css.crewStripes} d={STRIPES} />
    case 'dungarees':
      return (
        <g className={css.crewOutfitDetails}>
          <path className={css.crewDraw} d="M25.5 76 L23 47.5 M38.5 76 L41 47.5" />
          <path className={css.crewCrossStrap} d="M23 58 L41 68 M41 58 L23 68" />
        </g>
      )
    default:
      return null
  }
}

/**
 * One member of the crew. Memoized: every prop is a primitive, and one stage
 * renders this figure per seat, per log row, per note and per task card.
 * @param props - the whale it wears, whether you are behind it, whether only
 * the head is wanted (a portrait), and everything it is dressed in.
 * @returns the character.
 */
export const Crew = memo(function Crew(props: {
  readonly kind: MaskKind
  readonly className?: string
  /** Seen from behind: the pose of somebody facing their own computer. */
  readonly back?: boolean
  /** A portrait: the hooded head alone, framed for a small round avatar. */
  readonly portrait?: boolean
  /** The outfit the member wears; teammates rotate through the wardrobe. */
  readonly outfit?: OutfitKind
  /** The shoes the member wears; teammates rotate through the shoe rack. */
  readonly shoes?: ShoeKind
  /** The hairstyle under the hood. */
  readonly hair?: HairKind
  /** The one thing it wears besides its clothes. */
  readonly gear?: GearKind
  /** Which of the stylesheet's hair colours it has. */
  readonly tone?: number
  /** Which of the stylesheet's skin tones it has. */
  readonly skin?: number
}) {
  const {
    kind, className, back = false, portrait = false, outfit = 'shirt', shoes = 'sneaker',
    hair = 'crop', gear = 'none', tone = 0, skin = 0,
  } = props
  return (
    <svg
      className={`${css.crew} ${className ?? ''}`}
      viewBox={portrait ? '-1 -22 70 72' : '-6 -28 80 138'}
      data-kind={kind}
      data-back={back ? 'true' : undefined}
      data-outfit={outfit}
      data-shoes={shoes}
      data-hair={hair}
      data-gear={gear}
      data-tone={tone}
      data-skin={skin}
      aria-hidden
      focusable="false"
    >
      {!portrait && (
        <>
          <g className={css.crewLimbBack}>
            <rect className={css.crewTrouser} x="22" y="70" width="9.2" height="27" rx="4" />
            <path className={css.crewTrouserCrease} d="M26.6 74 V95" />
            <path className={css.crewShoe} d={shoePath(shoes, 'left')} />
            {shoeTrim(shoes, 'left')}
          </g>
          <g className={css.crewLimbFront}>
            <rect className={css.crewTrouser} x="32.8" y="70" width="9.2" height="27" rx="4" />
            <path className={css.crewTrouserCrease} d="M37.4 74 V95" />
            <path className={css.crewShoe} d={shoePath(shoes, 'right')} />
            {shoeTrim(shoes, 'right')}
          </g>
          <g className={css.crewArmBack}>
            <rect className={css.crewSleeve} x="11.5" y="52.5" width="8.4" height="22.5" rx="4.2" />
            <path className={css.crewCuff} d="M11.5 71.5 H19.9" />
            <circle className={css.crewHand} cx="15.7" cy="77" r="4" />
          </g>
          <g className={css.crewArmFront}>
            <rect className={css.crewSleeve} x="44.1" y="52.5" width="8.4" height="22.5" rx="4.2" />
            <path className={css.crewCuff} d="M44.1 71.5 H52.5" />
            <circle className={css.crewHand} cx="48.3" cy="77" r="4" />
          </g>
          <rect className={css.crewNeck} x="28" y="40" width="8" height="11.5" rx="3.5" />
          <path className={css.crewShirt} d={SHIRT} />
          <path className={css.crewSeam} d={SHOULDER_SEAM} />
          <path className={css.crewSeam} d={HEM_FOLD} />
          {outfit === 'hoodie' && <path className={css.crewHoodFabric} d={HOOD_FABRIC} />}
          {back ? outfitBack(outfit) : outfitFront(outfit)}
          {bodyGear(gear, back)}
        </>
      )}
      {head(kind, hair, gear, back)}
    </svg>
  )
})
