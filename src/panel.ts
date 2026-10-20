import { escapeHtml } from '@screenly/edge-apps'

import { airborne } from './data'
import type { Formatter, Units } from './format'
import { bearing, compass, kmBetween } from './geo'
import { shortAirportName, type Airport, type FlightQuery } from './lookup'
import type { Aircraft } from './opensky'
import { progress, type Route } from './route'
import { routeHtml } from './route-view'
import { band, board, phaseAt, routeLine, type Phase } from './traffic'

interface Fact {
  label: string
  value: [string, string]
  className?: string
}

interface Row {
  aircraft: Aircraft
  chip?: Phase
  far: [string, string]
  /** The line under the callsign; the country when not given. */
  sub?: string
}

const CHIP_TEXT: Record<Phase, string> = { arr: 'ARR', dep: 'DEP', gnd: 'GND' }
const NONE: [string, string] = ['—', '']

function $(id: string): HTMLElement {
  return document.getElementById(id)!
}

/** The altitude legend, written in the units the rest of the screen uses. */
export function legend(units: Units): void {
  const labels: Record<Units, [string, string, string]> = {
    aviation: ['Below FL100', 'FL100–300', 'Above FL300'],
    imperial: ['< 10k ft', '10–30k ft', '> 30k ft'],
    metric: ['< 3 km', '3–9 km', '> 9 km'],
  }
  const [low, mid, high] = labels[units]
  $('band-low').textContent = low
  $('band-mid').textContent = mid
  $('band-high').textContent = high
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
      .map(({ label, value: [value, unit], className }) => {
        const small = unit ? `<small>${escapeHtml(unit)}</small>` : ''
        return (
          `<div class="fact"><div class="label">${escapeHtml(label)}</div>` +
          `<div class="v ${className ?? ''}">${escapeHtml(value)}${small}</div></div>`
        )
      })
      .join('')
  }

  private row({ aircraft, chip, far: [far, farUnit], sub }: Row): string {
    const [alt, altUnit] = this.fmt.altitude(
      aircraft.altitude,
      aircraft.onGround,
    )
    const name = aircraft.callsign || aircraft.icao24.toUpperCase()
    const chipHtml = chip
      ? `<span class="chip ${chip}">${CHIP_TEXT[chip]}</span>`
      : ''
    return (
      `<li class="row ${band(aircraft)}" data-icao24="${escapeHtml(aircraft.icao24)}">` +
      `<div class="icon" style="transform: rotate(${aircraft.track}deg)">${this.glyph}</div>` +
      `<div class="who"><b>${chipHtml}${escapeHtml(name)}</b><span>${escapeHtml(sub ?? aircraft.country)}</span></div>` +
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
    lat: number,
    lng: number,
    name: string,
    radiusKm: number,
    drawn: Aircraft[],
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
      drawn.map((aircraft) => {
        const [value, unit] = this.distance(lat, lng, aircraft)
        const way = compass(bearing(lat, lng, aircraft.lat, aircraft.lng))
        return { aircraft, far: [value, `${unit} ${way}`] }
      }),
      'The sky is clear right now',
    )
  }

  airport(
    airport: Airport,
    radiusKm: number,
    drawn: Aircraft[],
    routes: Record<string, Route | null> = {},
  ): Set<string> {
    const phases = new Map<string, Phase>()
    for (const aircraft of drawn) {
      const phase = phaseAt(airport, aircraft, radiusKm)
      if (phase) phases.set(aircraft.icao24, phase)
    }
    const count = (phase: Phase) =>
      [...phases.values()].filter((p) => p === phase).length

    this.head(
      [airport.iata, airport.icao].filter(Boolean).join(' · '),
      shortAirportName(airport),
      `${airport.city ? `${airport.city} · ` : ''}${this.fmt.radius(radiusKm)} around`,
    )
    this.facts([
      {
        label: 'Arriving',
        value: [String(count('arr')), ''],
        className: 'arr',
      },
      {
        label: 'Departing',
        value: [String(count('dep')), ''],
        className: 'dep',
      },
      { label: 'On ground', value: [String(count('gnd')), ''] },
    ])

    return this.rows(
      'Arriving & departing',
      board(airport, drawn, radiusKm).map(({ aircraft, phase }) => {
        const [value, unit] = this.distance(airport.lat, airport.lng, aircraft)
        const far: [string, string] = [
          value,
          phase === 'arr' ? `${unit} out` : `${unit} away`,
        ]
        const route = routes[aircraft.callsign.toUpperCase()]
        const sub = routeLine(airport, phase, route) ?? undefined
        return { aircraft, chip: phase, far, sub }
      }),
      'No arrivals or departures in range right now',
    )
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
  ): Set<string> {
    const name = target.callsign || query.label
    this.head(
      name === query.label ? 'Tracking' : `Tracking ${query.label}`,
      name,
      `${route?.airline || target.country} · ${target.icao24.toUpperCase()}`,
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
              : [
                  this.fmt.clock(
                    new Date(Date.now() + ahead.remainingS * 1000),
                  ),
                  `in ${this.fmt.duration(ahead.remainingS)}`,
                ],
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
