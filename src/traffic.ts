import { bearing, kmBetween } from './geo'
import { isPublicCallsign, type Airport } from './lookup'
import { cityOf, code, type Route, type RoutePlace } from './route'
import type { Aircraft } from './states'

export type Phase = 'arr' | 'dep' | 'gnd'

/**
 * What an aircraft is doing, which is what its colour says everywhere on the
 * screen (map, list icons, legend, board keys). Altitude is shown as a number, so
 * colour is spent on the one thing that cannot be read anywhere else.
 *
 * At an airport: arriving, departing, passing through, or on the ground.
 * Anywhere else, the same four by the aircraft's own vertical speed:
 * descending, climbing, level, or on the ground.
 */
export type Motion = 'arr' | 'dep' | 'pass' | 'gnd'

/** Vertical speed past which an aircraft is not level: 1.5 m/s ≈ 300 ft/min. */
const LEVEL_MS = 1.5

export function motionOf(
  aircraft: Aircraft,
  airport: Airport | null,
  radiusKm: number,
  routes: Routes = {},
): Motion {
  if (aircraft.onGround) return 'gnd'
  if (airport) {
    const phase = listedPhase(airport, aircraft, radiusKm, routes)
    return phase ?? 'pass'
  }
  if (aircraft.verticalRate <= -LEVEL_MS) return 'arr'
  if (aircraft.verticalRate >= LEVEL_MS) return 'dep'
  return 'pass'
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
  return guessAt(airport, aircraft, radiusKm).phase
}

/** Within this distance of the airport's reference point, an aircraft is on the airfield. */
const AIRFIELD_KM = 6
/** Vertical speed that counts as climbing or descending: 0.5 m/s ≈ 100 ft/min. */
const CLIMB_MS = 0.5

interface Guess {
  phase: Phase | null
  /**
   * False when the guess rests on which way the aircraft points, not on how
   * it is climbing or descending — or when there is no guess at all for an
   * aircraft that may well be the airport's (level on the airfield, as at
   * lift-off). A route can then settle it.
   */
  sure: boolean
}

/**
 * The heuristic behind phaseAt. Vertical speed comes first: descending is an
 * arrival, climbing a departure. Away from the airfield, the aircraft must
 * also point at (or away from) it, which keeps a neighbour's traffic out.
 * On the airfield, pointing means nothing — runways run through the
 * reference point, so a take-off roll from the far end points straight at
 * it — and a level aircraft there (just lifted off, OpenSky not yet sending
 * a climb) is left undecided rather than guessed.
 */
export function guessAt(
  airport: Airport,
  aircraft: Aircraft,
  radiusKm: number,
): Guess {
  const km = kmBetween(airport.lat, airport.lng, aircraft.lat, aircraft.lng)
  if (aircraft.onGround) return { phase: km < 6 ? 'gnd' : null, sure: true }
  const altitude = aircraft.altitude ?? Infinity
  if (altitude > 4500 || km > radiusKm) return { phase: null, sure: true }
  const vertical = aircraft.verticalRate
  if (km < AIRFIELD_KM) {
    if (vertical < -CLIMB_MS) return { phase: 'arr', sure: true }
    if (vertical > CLIMB_MS) return { phase: 'dep', sure: true }
    return { phase: null, sure: false }
  }
  const toField = bearing(aircraft.lat, aircraft.lng, airport.lat, airport.lng)
  const off = angleBetween(aircraft.track, toField)
  if (vertical < -CLIMB_MS && off < 60) return { phase: 'arr', sure: true }
  if (vertical > CLIMB_MS && off > 120) return { phase: 'dep', sure: true }
  // Level, low and close: on final or in the circuit. Facing decides, unsure.
  if (altitude < 1500 && km < 25) {
    return { phase: off < 90 ? 'arr' : 'dep', sure: false }
  }
  return { phase: null, sure: true }
}

/** What the board lists: the airport's arrivals and departures, by name. */
export type Listed = 'arr' | 'dep'

export interface BoardEntry {
  aircraft: Aircraft
  phase: Listed
}

/**
 * The airport board's rows, in order. Arrivals and departures take turns, so
 * a busy stream of arrivals cannot push departures off a board that only has
 * room for a few rows; within each, by time — the soonest to land, the
 * latest to take off — as on a terminal board. Aircraft on the ground are counted
 * but not listed; aircraft passing through are neither (both are still on
 * the map). Shared by the panel and the route lookups, so the routes fetched
 * are the ones for the rows on screen.
 */
export function board(
  airport: Airport,
  aircraft: Aircraft[],
  radiusKm: number,
  routes: Routes = {},
  includePrivate = false,
): BoardEntry[] {
  const km = (a: Aircraft) => kmBetween(airport.lat, airport.lng, a.lat, a.lng)
  const arr: Aircraft[] = []
  const dep: Aircraft[] = []
  for (const a of aircraft) {
    // Private aircraft (flying under their registration) stay off the board.
    if (!includePrivate && !isPublicCallsign(a.callsign)) continue
    const phase = listedPhase(airport, a, radiusKm, routes)
    if (phase === 'arr') arr.push(a)
    else if (phase === 'dep') dep.push(a)
  }
  // By time, as a terminal board is: the next to land, the latest to leave.
  // No estimate (barely moving, a bad speed) sorts last, nearest first.
  const byTime =
    (time: (a: Aircraft) => number | null) => (a: Aircraft, b: Aircraft) =>
      (time(a) ?? Infinity) - (time(b) ?? Infinity) || km(a) - km(b)
  arr.sort(byTime((a) => secondsToLanding(airport, a)))
  dep.sort(byTime((a) => secondsSinceTakeOff(airport, a)))

  const rows: BoardEntry[] = []
  for (let i = 0; i < Math.max(arr.length, dep.length); i++) {
    if (arr[i]) rows.push({ aircraft: arr[i]!, phase: 'arr' })
    if (dep[i]) rows.push({ aircraft: dep[i]!, phase: 'dep' })
  }
  return rows
}

function isHere(airport: Airport, at: RoutePlace): boolean {
  return (
    at.icao === airport.icao || (at.iata !== '' && at.iata === airport.iata)
  )
}

/** Does this route start or end at this airport? */
export function touches(airport: Airport, route: Route): boolean {
  return isHere(airport, route.from) || isHere(airport, route.to)
}

/**
 * Each callsign's itinerary as legs, as looked up for the board; [] when
 * unknown. A flight with stops (LAX-SFO-LAX) has a leg into this airport
 * and a leg out of it.
 */
export type Routes = Record<string, Route[]>

/** The leg that lands here, if the itinerary has one. */
export function legInto(airport: Airport, legs: Route[] = []): Route | null {
  return legs.find((leg) => isHere(airport, leg.to)) ?? null
}

/** The leg that leaves here, if the itinerary has one. */
export function legOutOf(airport: Airport, legs: Route[] = []): Route | null {
  return legs.find((leg) => isHere(airport, leg.from)) ?? null
}

/** How close another airport must be for its traffic to be mistaken for ours. */
const NEIGHBOUR_KM = 100

/**
 * Is this "arrival" really landing at a neighbouring airport (or this
 * "departure" really leaving one)? From the heuristic alone, a descent into
 * Gatwick looks like a descent into Heathrow 40 km away. A route that ends
 * (or starts) at another airport close by settles it. A route to somewhere
 * far away is more likely stale than right, so it is not trusted to say so.
 */
export function elsewhere(
  airport: Airport,
  phase: Listed,
  legs: Route[] = [],
): boolean {
  const here =
    phase === 'arr' ? legInto(airport, legs) : legOutOf(airport, legs)
  if (here) return false
  return legs.some((leg) => {
    const end = phase === 'arr' ? leg.to : leg.from
    return kmBetween(airport.lat, airport.lng, end.lat, end.lng) <= NEIGHBOUR_KM
  })
}

/** Arriving or departing here, by the heuristic and the route together. */
export function listedPhase(
  airport: Airport,
  aircraft: Aircraft,
  radiusKm: number,
  routes: Routes,
): Listed | null {
  const guess = guessAt(airport, aircraft, radiusKm)
  const legs = routes[aircraft.callsign.toUpperCase()] ?? []
  let phase = guess.phase
  // When the heuristic is unsure, a route through here settles it: a plane
  // leaving SFO for Lihue is departing, whichever way it points on the
  // runway. A stop in both directions (LAX-SFO-LAX) settles nothing. A sure
  // heuristic — measured climb or descent — beats a route, which may be
  // stale.
  if (!guess.sure) {
    const into = legInto(airport, legs)
    const out = legOutOf(airport, legs)
    if (into && !out) phase = 'arr'
    else if (out && !into) phase = 'dep'
  }
  if (phase !== 'arr' && phase !== 'dep') return null
  return elsewhere(airport, phase, legs) ? null : phase
}

/**
 * Aircraft worth a route lookup, most useful first: the board's rows, then
 * aircraft the heuristic cannot place on its own (level on the airfield),
 * which a route may let onto the board.
 */
export function lookupOrder(
  airport: Airport,
  aircraft: Aircraft[],
  radiusKm: number,
  includePrivate = false,
): Aircraft[] {
  const listed = board(airport, aircraft, radiusKm, {}, includePrivate).map(
    (e) => e.aircraft,
  )
  const undecided = aircraft.filter((a) => {
    if (!includePrivate && !isPublicCallsign(a.callsign)) return false
    const guess = guessAt(airport, a, radiusKm)
    return !guess.sure && guess.phase === null
  })
  return [...listed, ...undecided].filter((a) => a.callsign.trim() !== '')
}

/**
 * "From MLE Malé" for an arrival, "To DEL Delhi" for a departure — from the
 * leg that really lands (or leaves) here. An itinerary with no such leg is
 * the wrong route for this trip, and null sends the row back to showing the
 * country.
 */
export function routeLine(
  airport: Airport,
  phase: Listed,
  legs: Route[] = [],
): string | null {
  if (phase === 'arr') {
    const leg = legInto(airport, legs)
    return leg ? `From ${code(leg.from)} ${cityOf(leg.from)}` : null
  }
  const leg = legOutOf(airport, legs)
  return leg ? `To ${code(leg.to)} ${cityOf(leg.to)}` : null
}

/** Below this ground speed a time estimate means nothing. */
const MOVING_MS = 20
/** A typical lift-off speed (~145 kt): departures average up from it. */
const LIFT_OFF_MS = 75

/**
 * Roughly how long until an arrival lands: distance to the field at its
 * current ground speed. Vectors and holds make it longer, so it is shown as
 * an estimate ("~5 min"), never as a scheduled time.
 */
export function secondsToLanding(
  airport: Airport,
  aircraft: Aircraft,
): number | null {
  if (aircraft.speed < MOVING_MS) return null
  const metres =
    kmBetween(airport.lat, airport.lng, aircraft.lat, aircraft.lng) * 1000
  return metres / aircraft.speed
}

/**
 * Roughly how long ago a departure took off. OpenSky gives no take-off time,
 * so it is distance flown over the average of lift-off and current speed: a
 * climbing aircraft is still accelerating, and its current speed alone would
 * make it seem to have left more recently than it did.
 */
export function secondsSinceTakeOff(
  airport: Airport,
  aircraft: Aircraft,
): number | null {
  if (aircraft.speed < MOVING_MS) return null
  const metres =
    kmBetween(airport.lat, airport.lng, aircraft.lat, aircraft.lng) * 1000
  return metres / ((aircraft.speed + LIFT_OFF_MS) / 2)
}

/**
 * How a list icon is turned for what the aircraft is doing — the same for
 * every arrival, every departure — matching the ↘ / ↗ / → arrows in the
 * headings and legend. (The glyph points up at 0°.) The map keeps each
 * aircraft's real heading; in a list, real headings were just noise.
 */
export const ICON_ANGLE: Record<Motion, number> = {
  arr: 135,
  dep: 45,
  pass: 90,
  gnd: 90,
}
