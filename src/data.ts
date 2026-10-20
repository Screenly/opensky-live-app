import { getSettingWithDefault } from '@screenly/edge-apps'

import { routesFor } from './airport-routes'
import { boxAround, deadReckon, kmBetween } from './geo'
import type { Airport, FlightQuery } from './lookup'
import {
  hasCredentials,
  routeFor,
  statesEverywhere,
  statesFor,
  statesIn,
  trackFor,
  type Aircraft,
  type Snapshot,
  type Waypoint,
} from './opensky'
import type { Route } from './route'
import { board } from './traffic'

/** What the screen is watching, worked out once from the settings. */
export type Plan =
  | { mode: 'area'; lat: number; lng: number; name: string }
  | { mode: 'airport'; airport: Airport }
  | { mode: 'flight'; query: FlightQuery }

/** The last good reading, and what it was a reading of. */
export interface Cached {
  key: string
  fetchedAt: number
  snapshot: Snapshot
  /** Flight mode: the aircraft being followed, or null if it was not found. */
  target: string | null
  trail: Waypoint[]
  trailAt: number
  /** Flight mode: where it is going, and the callsign that was looked up. */
  route: Route | null
  routeFor: string
  /** Airport mode: routes for the board's callsigns (missing in old caches). */
  routes?: Record<string, Route | null>
}

/** Aircraft keep moving along their last course for at most this long. */
const MAX_GLIDE_S = 360
/** Never draw more than this many aircraft; a busy hub can return hundreds. */
const MAX_DRAWN = 300
/** Neighbours kept around a followed flight, and the box it is re-found in. */
const FLIGHT_CONTEXT_KM = 300
/**
 * How often a flown path is refetched. Paths cost 4 credits each from their
 * own allowance: every 30 minutes is 192 a day, inside the anonymous 400;
 * signed in, every 10 minutes is 576 of 4,000.
 */
function trailRefreshMs(): number {
  return (hasCredentials() ? 10 : 30) * 60 * 1000
}
/** A followed flight is looked for near its last position for this long. */
const RECENT_MS = 30 * 60 * 1000

/**
 * How often to ask for new positions. Anonymous access is 400 credits a day,
 * so five minutes; a signed-in client has ten times that.
 */
export function refreshMs(): number {
  const signedIn = hasCredentials()
  const floor = signedIn ? 30 : 240
  const fallback = signedIn ? 60 : 300
  const asked = getSettingWithDefault<number>('refresh_interval', 0)
  return (asked > 0 ? Math.max(asked, floor) : fallback) * 1000
}

/**
 * How long a reading stands. "Not airborne" stands longer: finding a flight is
 * a worldwide query, four times the cost of a local one.
 */
export function freshFor(plan: Plan, cached: Cached): number {
  if (plan.mode === 'flight' && cached.target === null) {
    return (hasCredentials() ? 5 : 20) * 60 * 1000
  }
  return refreshMs()
}

export function cacheKey(plan: Plan, radiusKm: number): string {
  switch (plan.mode) {
    case 'area':
      return `area|${plan.lat}|${plan.lng}|${radiusKm}`
    case 'airport':
      return `airport|${plan.airport.icao}|${radiusKm}`
    case 'flight':
      return `flight|${plan.query.label}`
  }
}

/**
 * Where an aircraft is now, carried along its last course and speed from the
 * moment of its fix. Between refreshes this is what keeps the map moving.
 */
export function positionOf(
  cached: Cached | null,
  aircraft: Aircraft,
): { lat: number; lng: number } {
  if (!cached || aircraft.onGround || aircraft.speed < 25) return aircraft
  const age =
    cached.snapshot.time -
    aircraft.seen +
    (Date.now() - cached.fetchedAt) / 1000
  const seconds = Math.min(Math.max(age, 0), MAX_GLIDE_S)
  return deadReckon(
    aircraft.lat,
    aircraft.lng,
    aircraft.speed,
    aircraft.track,
    seconds,
  )
}

export function airborne(aircraft: Aircraft): boolean {
  return !aircraft.onGround
}

export function within(
  lat: number,
  lng: number,
  km: number,
  aircraft: Aircraft[],
): Aircraft[] {
  return aircraft.filter((a) => kmBetween(lat, lng, a.lat, a.lng) <= km)
}

/** Nearest to a point first. */
export function byDistanceFrom(lat: number, lng: number) {
  return (a: Aircraft, b: Aircraft) =>
    kmBetween(lat, lng, a.lat, a.lng) - kmBetween(lat, lng, b.lat, b.lng)
}

/** A followed flight: re-found near where it was, or searched for afresh. */
async function fetchFlight(
  key: string,
  query: FlightQuery,
  previous: Cached | null,
): Promise<Cached> {
  const last = previous?.target
    ? previous.snapshot.aircraft.find((a) => a.icao24 === previous.target)
    : undefined
  let snapshot: Snapshot | null = null
  let target: Aircraft | undefined

  // A local box costs one credit; the whole world costs four. Look where the
  // flight was first, provided it was seen recently enough to still be close.
  if (last && previous && Date.now() - previous.fetchedAt < RECENT_MS) {
    snapshot = await statesIn(boxAround(last.lat, last.lng, FLIGHT_CONTEXT_KM))
    target = snapshot.aircraft.find((a) => a.icao24 === last.icao24)
  }

  if (!target) {
    snapshot =
      query.kind === 'icao24'
        ? await statesFor(query.icao24)
        : await statesEverywhere()
    const matches = snapshot.aircraft.filter((a) =>
      query.kind === 'icao24'
        ? a.icao24 === query.icao24
        : query.callsigns.includes(a.callsign.toUpperCase()),
    )
    target = matches.find(airborne) ?? matches[0]
  }

  const fetchedAt = Date.now()
  if (!target || !snapshot) {
    return {
      key,
      fetchedAt,
      snapshot: { time: snapshot?.time ?? fetchedAt / 1000, aircraft: [] },
      target: null,
      trail: [],
      trailAt: 0,
      ...(await routeWhileGrounded(query, previous)),
    }
  }

  // Keep the neighbourhood only: a worldwide answer is ten thousand aircraft.
  const found = target
  const kept = within(
    found.lat,
    found.lng,
    FLIGHT_CONTEXT_KM,
    snapshot.aircraft,
  )
    .filter((a) => a.icao24 === found.icao24 || airborne(a))
    .sort(byDistanceFrom(found.lat, found.lng))
    .slice(0, MAX_DRAWN)

  return {
    key,
    fetchedAt,
    snapshot: { time: snapshot.time, aircraft: kept },
    target: found.icao24,
    ...(await whereFromAndTo(found, previous, fetchedAt)),
  }
}

/** At most this many candidate callsigns are looked up for one flight number. */
const MAX_ROUTE_LOOKUPS = 3

/**
 * The route of a flight that is not in the air, so the screen can still say
 * where it flies. Only the callsign is needed, not a position. A flight
 * number can map to several callsigns (airlines sharing an IATA code); the
 * first with a known route wins. Remembered across refreshes, found or not.
 */
async function routeWhileGrounded(
  query: FlightQuery,
  previous: Cached | null,
): Promise<Pick<Cached, 'route' | 'routeFor'>> {
  if (query.kind !== 'callsign') return { route: null, routeFor: '' }
  if (previous?.routeFor && query.callsigns.includes(previous.routeFor)) {
    return { route: previous.route ?? null, routeFor: previous.routeFor }
  }
  for (const callsign of query.callsigns.slice(0, MAX_ROUTE_LOOKUPS)) {
    const route = await routeFor(callsign)
    if (route) return { route, routeFor: callsign }
  }
  return { route: null, routeFor: query.callsigns[0] ?? '' }
}

/**
 * Where a followed flight has been, and where it is going. The trail is
 * refetched every ten minutes; the route once per callsign, since it does not
 * change mid-flight.
 */
async function whereFromAndTo(
  found: Aircraft,
  previous: Cached | null,
  fetchedAt: number,
): Promise<Pick<Cached, 'trail' | 'trailAt' | 'route' | 'routeFor'>> {
  const sameFlight = previous?.target === found.icao24
  const trailDue =
    fetchedAt - (sameFlight ? previous.trailAt : 0) > trailRefreshMs()
  const callsign = found.callsign.toUpperCase()
  const routeKnown = previous !== null && previous.routeFor === callsign

  // Both at once: the first screen, and its ready signal, wait for them.
  const [fetchedTrail, fetchedRoute] = await Promise.all([
    trailDue ? trackFor(found.icao24) : null,
    !routeKnown && callsign ? routeFor(callsign) : null,
  ])

  const keptTrail = sameFlight ? previous.trail : []
  return {
    // An attempt counts even when it fails, so a missing path is not retried
    // (and paid for) on every refresh. No answer keeps the trail drawn.
    trail: fetchedTrail ?? keptTrail,
    trailAt: trailDue ? fetchedAt : sameFlight ? previous.trailAt : 0,
    route: routeKnown ? (previous.route ?? null) : fetchedRoute,
    routeFor: callsign,
  }
}

/** One reading for the plan. Throws on any fetch failure; the caller decides. */
export async function fetchFor(
  plan: Plan,
  radiusKm: number,
  previous: Cached | null,
): Promise<Cached> {
  const key = cacheKey(plan, radiusKm)
  if (plan.mode === 'flight') return fetchFlight(key, plan.query, previous)

  const { lat, lng } = plan.mode === 'area' ? plan : plan.airport
  const snapshot = await statesIn(boxAround(lat, lng, radiusKm))
  const showGround =
    plan.mode === 'airport' ||
    getSettingWithDefault<boolean>('show_ground', false)
  const aircraft = within(lat, lng, radiusKm, snapshot.aircraft)
    .filter((a) => showGround || airborne(a))
    .sort(byDistanceFrom(lat, lng))
    .slice(0, MAX_DRAWN)
  // Where the board's arrivals come from and its departures go. A failed
  // lookup is just no route: the rows fall back to the country.
  const routes =
    plan.mode === 'airport'
      ? await routesFor(
          board(plan.airport, aircraft, radiusKm).map((e) =>
            e.aircraft.callsign.toUpperCase(),
          ),
        )
      : {}
  return {
    routes,
    key,
    fetchedAt: Date.now(),
    snapshot: { time: snapshot.time, aircraft },
    target: null,
    trail: [],
    trailAt: 0,
    route: null,
    routeFor: '',
  }
}
