import { escapeHtml } from '@screenly/edge-apps'

import type { Formatter } from './format'
import type { Airport } from './lookup'
import type { Aircraft } from './opensky'
import type { Route } from './route'
import {
  ICON_ANGLE,
  routeLine,
  secondsSinceTakeOff,
  secondsToLanding,
  type BoardEntry,
  type Listed,
  type Routes,
} from './traffic'

/*
  The airport board, laid out like a terminal's: an Arrivals section and a
  Departures section, each flight with where it is from or going and a time —
  roughly how long until it lands, or how long ago it took off. Altitude and
  distance stay on the map tags; the board says what a traveller would ask.
*/

const HEADINGS: Record<Listed, string> = {
  arr: '↘ Arrivals',
  dep: '↗ Departures',
}

const EMPTY: Record<Listed, string> = {
  arr: 'No arrivals in range right now',
  dep: 'No departures in range right now',
}

/** At most this many rows per section, before trimming to the space. */
const MOST_PER_SECTION = 6

/** "~5 min" / "Landing" for an arrival; "~4 min ago" / "Just departed". */
function when(
  fmt: Formatter,
  airport: Airport,
  aircraft: Aircraft,
  phase: Listed,
): [string, string] {
  if (phase === 'arr') {
    const s = secondsToLanding(airport, aircraft)
    if (s === null) return ['—', '']
    return s < 60 ? ['Landing', ''] : [fmt.estimate(s), 'to land']
  }
  const s = secondsSinceTakeOff(airport, aircraft)
  if (s === null) return ['—', '']
  return s < 120
    ? ['Just departed', '']
    : [`${fmt.estimate(s)} ago`, 'took off']
}

function rowHtml(
  fmt: Formatter,
  glyph: string,
  airport: Airport,
  { aircraft, phase }: BoardEntry,
  legs: Route[] | undefined,
): string {
  const name = aircraft.callsign || aircraft.icao24.toUpperCase()
  const sub = routeLine(airport, phase, legs) ?? aircraft.country
  const [time, caption] = when(fmt, airport, aircraft, phase)
  return (
    `<li class="row board ${phase}" data-icao24="${escapeHtml(aircraft.icao24)}" data-section="${phase}">` +
    `<div class="icon" style="transform: rotate(${ICON_ANGLE[phase]}deg)">${glyph}</div>` +
    `<div class="who"><b>${escapeHtml(name)}</b><span>${escapeHtml(sub)}</span></div>` +
    `<div class="num when">${escapeHtml(time)}${caption ? `<small>${escapeHtml(caption)}</small>` : ''}</div>` +
    `</li>`
  )
}

function sectionHtml(phase: Listed, rows: string[]): string {
  const heading = `<li class="section ${phase}"><span class="key ${phase}"></span>${HEADINGS[phase]}</li>`
  const body = rows.length
    ? rows.join('')
    : `<li class="row empty" data-section="${phase}"><span></span><div class="who"><span>${EMPTY[phase]}</span></div></li>`
  return heading + body
}

/**
 * Fills the list with both sections, then trims rows from whichever section
 * has more until it fits, so a busy stream of arrivals cannot push
 * departures off the screen. Returns the aircraft left on the board, which
 * are the ones labelled on the map.
 */
export function renderBoard(
  list: HTMLElement,
  fmt: Formatter,
  glyph: string,
  airport: Airport,
  entries: BoardEntry[],
  routes: Routes,
): Set<string> {
  const rows = (phase: Listed) =>
    entries
      .filter((e) => e.phase === phase)
      .slice(0, MOST_PER_SECTION)
      .map((e) =>
        rowHtml(
          fmt,
          glyph,
          airport,
          e,
          routes[e.aircraft.callsign.toUpperCase()],
        ),
      )
  list.innerHTML =
    sectionHtml('arr', rows('arr')) + sectionHtml('dep', rows('dep'))

  const flights = (phase: Listed) =>
    Array.from(
      list.querySelectorAll<HTMLElement>(`.row.board[data-section="${phase}"]`),
    )
  while (list.scrollHeight > list.clientHeight + 1) {
    const arr = flights('arr')
    const dep = flights('dep')
    const fuller = arr.length > dep.length ? arr : dep
    const last = fuller.at(-1) ?? arr.at(-1)
    if (!last) break
    last.remove()
  }

  return new Set(
    Array.from(list.querySelectorAll<HTMLElement>('.row.board')).map(
      (row) => row.dataset.icao24 ?? '',
    ),
  )
}
