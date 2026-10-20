import { escapeHtml } from '@screenly/edge-apps'

import { renderBoard } from './board'
import { airborne } from './data'
import { zoneAt, zoneName, type Formatter } from './format'
import { bearing, compass, kmBetween } from './geo'
import {
  isPublicCallsign,
  shortAirportName,
  type Airport,
  type FlightQuery,
} from './lookup'
import type { Aircraft } from './opensky'
import { journeyLine, legNow, progress, type Route } from './route'
import { routeHtml } from './route-view'
import { board, phaseAt, type Motion, type Phase, type Routes } from './traffic'

interface Fact {
  label: string
  value: [string, string]
  className?: string
  /** A colour key beside the label; the number itself stays in ink. */
  marker?: Motion
}

interface Row {
  aircraft: Aircraft
  far: [string, string]
  /** The line under the callsign; the country when not given. */
  sub?: string
}

/*
  Colour means what an aircraft is doing, everywhere on the screen: the list
  icons, the map, the board's section keys and the legend all use the same
  four, and a word and arrow always say it too, so colour is never the only
  cue.
*/
const LEGEND: Record<'airport' | 'sky', Record<Motion, string>> = {
  airport: {
    arr: '↘ Arriving',
    dep: '↗ Departing',
    pass: '→ Passing',
    gnd: 'Ground',
  },
  sky: {
    arr: '↘ Descending',
    dep: '↗ Climbing',
    pass: '→ Level',
    gnd: 'Ground',
  },
}
const NONE: [string, string] = ['—', '']

function $(id: string): HTMLElement {
  return document.getElementById(id)!
}

/** The colour legend: arriving/departing at an airport, else by vertical speed. */
export function legend(atAirport: boolean): void {
  const labels = LEGEND[atAirport ? 'airport' : 'sky']
  for (const motion of Object.keys(labels) as Motion[]) {
    $(`band-${motion}`).textContent = labels[motion]
  }
}

/**
 * The glass panel: a headline, a row of facts, and a list of aircraft. Each
 * render returns the aircraft that made it into the list, which are the ones
 * labelled on the map.
 */
export class Panel {
  constructor(
    private fmt: Formatter,
    private glyph: string,
  ) {}

  /** Whether private aircraft (registration callsigns) may be listed. */
  includePrivate = false

  /** How each aircraft is coloured; set once the mode is known. */
  motion: (aircraft: Aircraft) => Motion = () => 'pass'

  private head(label: string, big: string, sub: string): void {
    $('head-label').textContent = label
    $('head-big').textContent = big
    $('head-sub').textContent = sub
    // Counts get the big numeral; words get a size that fits a callsign.
    $('head-big').parentElement!.classList.toggle('word', !/^\d+$/.test(big))
  }

  private facts(facts: Fact[], columns = 3): void {
    const el = $('facts')
    el.style.setProperty('--columns', String(columns))
    el.innerHTML = facts
      .map(({ label, value: [value, unit], className, marker }) => {
        // A caption may run to more than one line ("\n"), each kept whole.
        const lines = unit.split('\n').map(escapeHtml).join('<br>')
        const small = unit ? `<small>${lines}</small>` : ''
        const key = marker ? `<span class="key ${marker}"></span>` : ''
        return (
          `<div class="fact"><div class="label">${key}${escapeHtml(label)}</div>` +
          `<div class="v ${className ?? ''}">${escapeHtml(value)}${small}</div></div>`
        )
      })
      .join('')
  }

  private row({ aircraft, far: [far, farUnit], sub }: Row): string {
    const [alt, altUnit] = this.fmt.altitude(
      aircraft.altitude,
      aircraft.onGround,
    )
    const name = aircraft.callsign || aircraft.icao24.toUpperCase()
    return (
      `<li class="row ${this.motion(aircraft)}" data-icao24="${escapeHtml(aircraft.icao24)}">` +
      `<div class="icon" style="transform: rotate(${aircraft.track}deg)">${this.glyph}</div>` +
      `<div class="who"><b>${escapeHtml(name)}</b><span>${escapeHtml(sub ?? aircraft.country)}</span></div>` +
      `<div class="num">${escapeHtml(alt)}<small>${escapeHtml(altUnit || 'alt')}</small></div>` +
      `<div class="num">${escapeHtml(far)}<small>${escapeHtml(farUnit)}</small></div>` +
      `</li>`
    )
  }

  /**
   * Fills the list, then trims it to the rows that fit: the panel is a fixed
   * share of the screen, and a half-cut row reads as a fault.
   */
  private rows(label: string, rows: Row[], empty: string): Set<string> {
    $('list-label').textContent = label
    const list = $('list')
    if (rows.length === 0) {
      list.innerHTML = `<li class="row"><span></span><div class="who"><span>${escapeHtml(empty)}</span></div></li>`
      return new Set()
    }
    list.innerHTML = rows
      .slice(0, 12)
      .map((row) => this.row(row))
      .join('')
    const shown = new Set<string>()
    for (const item of Array.from(list.children) as HTMLElement[]) {
      const bottom = item.offsetTop - list.offsetTop + item.offsetHeight
      if (bottom > list.clientHeight + 1) item.remove()
      else shown.add(item.dataset.icao24 ?? '')
    }
    return shown
  }

  private distance(lat: number, lng: number, aircraft: Aircraft) {
    return this.fmt.distance(kmBetween(lat, lng, aircraft.lat, aircraft.lng))
  }

  area(
    { lat, lng, name }: { lat: number; lng: number; name: string },
    radiusKm: number,
    drawn: Aircraft[],
    routes: Routes = {},
  ): Set<string> {
    const flying = drawn.filter(airborne)
    this.head(
      'Aircraft overhead',
      String(flying.length),
      `Within ${this.fmt.radius(radiusKm)} of ${name}`,
    )
    const highest = [...flying].sort(
      (a, b) => (b.altitude ?? 0) - (a.altitude ?? 0),
    )[0]
    const fastest = [...flying].sort((a, b) => b.speed - a.speed)[0]
    const closest = flying[0]
    this.facts([
      {
        label: 'Highest',
        value: highest ? this.fmt.altitude(highest.altitude) : NONE,
      },
      {
        label: 'Fastest',
        value: fastest ? this.fmt.speed(fastest.speed) : NONE,
      },
      {
        label: 'Closest',
        value: closest ? this.distance(lat, lng, closest) : NONE,
      },
    ])
    return this.rows(
      'Closest to this screen',
      drawn
        .filter((a) => this.listable(a))
        .map((aircraft) => {
          const [value, unit] = this.distance(lat, lng, aircraft)
          const way = compass(bearing(lat, lng, aircraft.lat, aircraft.lng))
          const legs = routes[aircraft.callsign.trim().toUpperCase()] ?? []
          const sub = journeyLine(legNow(legs, aircraft)) ?? undefined
          return { aircraft, far: [value, `${unit} ${way}`], sub }
        }),
      'The sky is clear right now',
    )
  }

  airport(
    airport: Airport,
    radiusKm: number,
    drawn: Aircraft[],
    routes: Routes = {},
  ): Set<string> {
    // Arriving and departing as the board has them (a neighbouring
    // airport's traffic, proved by its route, is left out); ground near here.
    const listed = board(airport, drawn, radiusKm, routes, this.includePrivate)
    const count = (phase: Phase) =>
      phase === 'gnd'
        ? drawn.filter((a) => phaseAt(airport, a, radiusKm) === 'gnd').length
        : listed.filter((e) => e.phase === phase).length

    this.head(
      [airport.iata, airport.icao].filter(Boolean).join(' · '),
      shortAirportName(airport),
      `${airport.city ? `${airport.city} · ` : ''}${this.fmt.radius(radiusKm)} around`,
    )
    this.facts(
      [
        { label: 'Arriving', value: [String(count('arr')), ''], marker: 'arr' },
        {
          label: 'Departing',
          value: [String(count('dep')), ''],
          marker: 'dep',
        },
        {
          label: 'Ground',
          value: [String(count('gnd')), ''],
          marker: 'gnd',
        },
      ],
      3,
    )

    // The sections carry their own headings.
    $('list-label').textContent = ''
    return renderBoard($('list'), this.fmt, this.glyph, airport, listed, routes)
  }

  /** Private aircraft are drawn on the map, but listed only if asked for. */
  private listable(aircraft: Aircraft): boolean {
    return this.includePrivate || isPublicCallsign(aircraft.callsign)
  }

  /**
   * Who flies it, and its transponder — or, out of receiver range, when it
   * was last heard: the position, progress and arrival are estimates from
   * then.
   */
  private flightSub(
    target: Aircraft,
    route: Route | null,
    lostSince?: number,
  ): string {
    const who = route?.airline || target.country
    if (!lostSince) return `${who} · ${target.icao24.toUpperCase()}`
    const seen = this.fmt.clock(new Date(lostSince))
    return `${who} · out of receiver range, last seen ${seen}`
  }

  /**
   * When it should land, in the destination's own time — as airlines and
   * arrivals boards give it — with that zone and how long until then below,
   * and the screen's own time on a line of its own if the destination is in
   * another zone: "04:59 AM" / "HST · in 4 h 40 m" / "07:59 AM PDT here".
   */
  private arrival(route: Route, seconds: number): [string, string] {
    const at = new Date(Date.now() + seconds * 1000)
    const there = zoneAt(route.to.lat, route.to.lng)
    const wait = `${zoneName(at, there)} · in ${this.fmt.duration(seconds)}`
    const here = this.fmt.clock(at)
    // The same time and zone name means the same zone, for show.
    const same = this.fmt.clock(at, there) === here
    return [this.fmt.time(at, there), same ? wait : `${wait}\n${here} here`]
  }

  /** Hides the route line; only a followed flight with a known route shows it. */
  noRoute(): void {
    $('route').hidden = true
  }

  /**
   * One followed flight. With a route, the panel gains the From → To line, a
   * progress bar and an estimated arrival; without one it shows the squawk
   * and the distance from this screen instead.
   */
  flight(
    query: FlightQuery,
    target: Aircraft,
    screenAt: { lat: number; lng: number } | null,
    route: Route | null,
    now: { lat: number; lng: number },
    lostSince?: number,
  ): Set<string> {
    const name = target.callsign || query.label
    this.head(
      name === query.label ? 'Tracking' : `Tracking ${query.label}`,
      name,
      this.flightSub(target, route, lostSince),
    )
    const ahead = route ? progress(route, now, target.speed) : null
    $('route').hidden = !route
    if (route && ahead)
      $('route').innerHTML = routeHtml(route, ahead, this.glyph)

    const facts: Fact[] = [
      {
        label: 'Altitude',
        value: this.fmt.altitude(target.altitude, target.onGround),
      },
      { label: 'Ground speed', value: this.fmt.speed(target.speed) },
      {
        label: 'Heading',
        value: [`${Math.round(target.track)}°`, compass(target.track)],
      },
      { label: 'Vertical', value: this.fmt.climb(target.verticalRate) },
    ]
    if (ahead) {
      facts.push(
        {
          label: 'Est. arrival',
          value:
            ahead.remainingS === null
              ? NONE
              : this.arrival(route!, ahead.remainingS),
          // A clock time, not a figure to line up; "in 4 h 45 m" below it.
          className: 'time',
        },
        {
          label: 'Distance to go',
          value: this.fmt.distance(ahead.remainingKm),
        },
      )
    } else {
      facts.push({ label: 'Squawk', value: [target.squawk || '—', ''] })
      facts.push(
        screenAt
          ? {
              label: 'From this screen',
              value: this.distance(screenAt.lat, screenAt.lng, target),
            }
          : {
              label: 'Position',
              value: [`${target.lat.toFixed(2)}, ${target.lng.toFixed(2)}`, ''],
            },
      )
    }
    this.facts(facts, 2)
    $('list-label').textContent = ''
    $('list').innerHTML = ''
    return new Set()
  }
}
