import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'

import {
  AA_NON_TEXT,
  AA_TEXT,
  contrast,
  over,
  parseColor,
  tokens,
  type Rgba,
} from './contrast'

/*
  WCAG AA, enforced. Every text colour must reach 4.5:1 and every component or
  meaningful graphic 3:1, against every backdrop it can sit on, in both themes.
  The 3:1 large-text allowance is not used: sizes scale with the screen, so on
  an 800x480 player even the facts are only about 10 px.

  Translucent layers are composited first. The glass panels sit over the map,
  so each is measured over both sea and land, and the worse result counts.
*/

const css = fs.readFileSync(path.join(import.meta.dir, 'style.css'), 'utf8')
const dark = tokens(css, ':root')
const themes = {
  dark,
  light: tokens(css, ":root[data-theme='light']", dark),
}

type Kind = 'text' | 'non-text'

/** What is drawn, in which token (with any opacity), on which backdrops. */
interface Pair {
  what: string
  kind: Kind
  fg: string
  opacity?: number
  on: 'map' | 'glass' | 'notice' | string
}

const PAIRS: Pair[] = [
  // Panel, brand pill, status and map tags: glass over the map.
  { what: 'headings, callsigns, values', kind: 'text', fg: 'ink', on: 'glass' },
  {
    what: 'sub-lines, units, legend',
    kind: 'text',
    fg: 'ink-soft',
    on: 'glass',
  },
  {
    what: 'uppercase labels, countries',
    kind: 'text',
    fg: 'ink-muted',
    on: 'glass',
  },
  {
    what: 'headline, destination code',
    kind: 'text',
    fg: 'accent-tint',
    on: 'glass',
  },
  { what: 'stale status', kind: 'text', fg: 'ink-soft', on: 'glass' },

  // Map labels have a glass backing, which the glass rows above already
  // cover; they are also held to AA over the bare map, so they still pass if
  // the backing is ever removed.
  { what: '"This screen" tag', kind: 'text', fg: 'ink-soft', on: 'map' },
  { what: 'origin airport tag', kind: 'text', fg: 'ink-soft', on: 'map' },
  {
    what: 'destination airport tag',
    kind: 'text',
    fg: 'accent-tint',
    on: 'map',
  },

  // Notice over the dimmed map.
  { what: 'notice title', kind: 'text', fg: 'ink', on: 'notice' },
  { what: 'notice detail', kind: 'text', fg: 'ink-soft', on: 'notice' },
  { what: 'notice label', kind: 'text', fg: 'ink-muted', on: 'notice' },
  {
    what: 'notice destination code',
    kind: 'text',
    fg: 'accent-tint',
    on: 'notice',
  },
  { what: 'error label', kind: 'text', fg: 'danger', on: 'notice' },
  { what: 'error icon', kind: 'non-text', fg: 'danger', on: 'notice' },
  { what: 'info icon', kind: 'non-text', fg: 'accent-tint', on: 'notice' },
  { what: 'how-to-fix setting', kind: 'text', fg: 'ink', on: 'glass@notice' },
  {
    what: 'how-to-fix caption',
    kind: 'text',
    fg: 'ink-muted',
    on: 'glass@notice',
  },
  { what: 'what was typed', kind: 'text', fg: 'danger', on: 'glass@notice' },

  // Aircraft on the map, coloured by what they are doing (at 80% opacity).
  ...(['arr', 'dep', 'pass', 'gnd'] as const).map((motion): Pair => ({
    what: `${motion} aircraft on the map`,
    kind: 'non-text',
    fg: motion,
    opacity: 0.8,
    on: 'map',
  })),
  { what: 'followed aircraft', kind: 'non-text', fg: 'accent-tint', on: 'map' },

  // Other map marks that carry meaning.
  { what: 'screen marker', kind: 'non-text', fg: 'ink', on: 'map' },
  { what: 'origin airport pin', kind: 'non-text', fg: 'ink-soft', on: 'map' },
  {
    what: 'destination airport pin',
    kind: 'non-text',
    fg: 'accent-tint',
    on: 'map',
  },
  {
    what: 'radius ring',
    kind: 'non-text',
    fg: 'accent-tint',
    opacity: 0.7,
    on: 'map',
  },
  {
    what: 'flown path',
    kind: 'non-text',
    fg: 'accent-tint',
    opacity: 0.85,
    on: 'map',
  },
  { what: 'path still to fly', kind: 'non-text', fg: 'ink-muted', on: 'map' },
  { what: 'coastline', kind: 'non-text', fg: 'coast', on: 'sea' },
  { what: 'state boundary', kind: 'non-text', fg: 'state', on: 'land' },

  // Components in the panels.
  // List icons, legend dots and count keys, on the glass panels.
  ...(['arr', 'dep', 'pass', 'gnd'] as const).map((motion): Pair => ({
    what: `${motion} icon, legend dot and key`,
    kind: 'non-text',
    fg: motion,
    on: 'glass',
  })),
  { what: 'live dot', kind: 'non-text', fg: 'accent', on: 'glass' },
  {
    what: 'stale (hollow) dot',
    kind: 'non-text',
    fg: 'ink-muted',
    on: 'glass',
  },
  { what: 'route progress', kind: 'non-text', fg: 'accent-tint', on: 'glass' },
]

/** Every opaque colour a token can end up as, over each backdrop it meets. */
function backdrops(t: Record<string, Rgba>, on: string): Rgba[] {
  const sea = t.sea!
  const land = t.land!
  const map = [sea, land]
  switch (on) {
    case 'map':
      return map
    case 'sea':
      return [sea]
    case 'land':
      return [land]
    case 'glass':
      return map.map((m) => over(t.glass!, m))
    case 'notice':
      // The map is dimmed to 35% over the page's sea-coloured background.
      return [sea, over(land, sea, 0.35)]
    case 'glass@notice':
      return [sea, over(land, sea, 0.35)].map((m) => over(t.glass!, m))
    default:
      return map.map((m) => over(t[on]!, m))
  }
}

function worst(t: Record<string, Rgba>, pair: Pair): number {
  const fg = t[pair.fg]
  if (!fg) throw new Error(`No --${pair.fg} token`)
  return Math.min(
    ...backdrops(t, pair.on).map((bg) =>
      contrast(over(fg, bg, pair.opacity ?? 1), bg),
    ),
  )
}

for (const [theme, t] of Object.entries(themes)) {
  describe(`WCAG AA, ${theme} theme`, () => {
    for (const pair of PAIRS) {
      const needed = pair.kind === 'text' ? AA_TEXT : AA_NON_TEXT
      test(`${pair.what} (--${pair.fg}) ≥ ${needed}:1`, () => {
        expect(worst(t, pair)).toBeGreaterThanOrEqual(needed)
      })
    }
  })
}

describe('contrast maths', () => {
  test('black on white is 21:1, a colour on itself 1:1', () => {
    const black = parseColor('#000')!
    const white = parseColor('#ffffff')!
    expect(contrast(black, white)).toBeCloseTo(21)
    expect(contrast(white, white)).toBeCloseTo(1)
  })

  test('translucent colours are composited', () => {
    const half = parseColor('rgba(0, 0, 0, 0.5)')!
    expect(over(half, parseColor('#fff')!)[0]).toBeCloseTo(127.5)
  })
})
