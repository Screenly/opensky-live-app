import { bearing, kmBetween } from './geo'
import type { Airport } from './lookup'
import { cityOf, code, type Route, type RoutePlace } from './route'
import type { Aircraft } from './states'

export type Phase = 'arr' | 'dep' | 'gnd'

/** Low and high altitude band edges in metres: FL100 and FL300. */
const LOW_M = 3048
const HIGH_M = 9144

export function band(aircraft: Aircraft): 'gnd' | 'low' | 'mid' | 'high' {
  if (aircraft.onGround) return 'gnd'
  const altitude = aircraft.altitude ?? 0
  if (altitude < LOW_M) return 'low'
  if (altitude < HIGH_M) return 'mid'
  return 'high'
}

/** The smaller angle between two headings, 0–180°. */
export function angleBetween(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Is this aircraft coming in, going out, or parked at the airport? Low,
 * descending and pointed at the field is an arrival; low, climbing and
 * pointed away is a departure. Traffic for a neighbouring airport mostly
 * fails the pointing test, which is the point of it.
 */
export function phaseAt(
  airport: Airport,
  aircraft: Aircraft,
  radiusKm: number,
): Phase | null {
  const km = kmBetween(airport.lat, airport.lng, aircraft.lat, aircraft.lng)
  if (aircraft.onGround) return km < 6 ? 'gnd' : null
  const altitude = aircraft.altitude ?? Infinity
  if (altitude > 4500 || km > radiusKm) return null
  const toField = bearing(aircraft.lat, aircraft.lng, airport.lat, airport.lng)
  const off = angleBetween(aircraft.track, toField)
  if (aircraft.verticalRate < -0.5 && off < 60) return 'arr'
  if (aircraft.verticalRate > 0.5 && off > 120) return 'dep'
  // Level, low and close: on final or in the circuit. Facing decides.
  if (altitude < 1500 && km < 25) return off < 90 ? 'arr' : 'dep'
  return null
}

export interface BoardEntry {
  aircraft: Aircraft
  phase: 'arr' | 'dep'
}

/**
 * The airport board's rows, in order: arrivals nearest the runway first, then
 * departures nearest first. Shared by the panel and the route lookups, so the
 * routes fetched are the ones for the rows on screen.
 */
export function board(
  airport: Airport,
  aircraft: Aircraft[],
  radiusKm: number,
): BoardEntry[] {
  const km = (a: Aircraft) => kmBetween(airport.lat, airport.lng, a.lat, a.lng)
  const entries: BoardEntry[] = []
  for (const a of aircraft) {
    const phase = phaseAt(airport, a, radiusKm)
    if (phase === 'arr' || phase === 'dep') entries.push({ aircraft: a, phase })
  }
  const rank = { arr: 0, dep: 1 }
  return entries.sort(
    (a, b) => rank[a.phase] - rank[b.phase] || km(a.aircraft) - km(b.aircraft),
  )
}

function isHere(airport: Airport, at: RoutePlace): boolean {
  return (
    at.icao === airport.icao || (at.iata !== '' && at.iata === airport.iata)
  )
}

/**
 * "From MLE Malé" for an arrival, "To DEL Delhi" for a departure — but only
 * when the route really ends (or starts) at this airport. A callsign's usual
 * route that does not touch this airport is the wrong route for this trip,
 * and null sends the row back to showing the country.
 */
export function routeLine(
  airport: Airport,
  phase: 'arr' | 'dep',
  route: Route | null | undefined,
): string | null {
  if (!route) return null
  if (phase === 'arr' && isHere(airport, route.to)) {
    return `From ${code(route.from)} ${cityOf(route.from)}`
  }
  if (phase === 'dep' && isHere(airport, route.from)) {
    return `To ${code(route.to)} ${cityOf(route.to)}`
  }
  return null
}
