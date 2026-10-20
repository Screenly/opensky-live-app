// Where a flight is going. OpenSky has positions, not schedules, so the route
// comes from adsbdb's callsign table: the route an airline usually flies under
// a callsign, not a record of this particular trip. Kept free of the Edge Apps
// library so it can be unit-tested without a DOM.

import { bearing, deadReckon, kmBetween, nearLongitude } from './geo'
import type { Aircraft, Waypoint } from './states'

export interface RoutePlace {
  iata: string
  icao: string
  name: string
  city: string
  lat: number
  lng: number
}

export interface Route {
  airline: string
  from: RoutePlace
  to: RoutePlace
}

function place(value: unknown): RoutePlace | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const lat = Number(v.latitude)
  const lng = Number(v.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    iata: typeof v.iata_code === 'string' ? v.iata_code : '',
    icao: typeof v.icao_code === 'string' ? v.icao_code : '',
    name: typeof v.name === 'string' ? v.name : '',
    city: typeof v.municipality === 'string' ? v.municipality : '',
    lat,
    lng,
  }
}

/** An adsbdb callsign response, or null for "unknown callsign" or anything odd. */
export function parseRoute(value: unknown): Route | null {
  const response = (value as { response?: unknown } | null)?.response
  if (typeof response !== 'object' || response === null) return null
  const flightroute = (response as { flightroute?: unknown }).flightroute
  if (typeof flightroute !== 'object' || flightroute === null) return null
  const r = flightroute as Record<string, unknown>
  const from = place(r.origin)
  const to = place(r.destination)
  if (!from || !to) return null
  const airline = (r.airline as { name?: unknown } | null)?.name
  return { airline: typeof airline === 'string' ? airline : '', from, to }
}

/** "MLE" — the code a passenger knows, else the ICAO one. */
export function code(at: RoutePlace): string {
  return at.iata || at.icao
}

/** "Malé" — the city, else the airport name without "International Airport". */
export function cityOf(at: RoutePlace): string {
  return (
    at.city ||
    at.name.replace(/\s+(International\s+)?Airport$/i, '').trim() ||
    code(at)
  )
}

/**
 * Is the aircraft plausibly flying this route? A callsign can be reused for a
 * different leg, and then the table's route is simply wrong. An aircraft on
 * the route sits near the line between the two airports: going via it is not
 * much longer than going direct.
 */
export function plausible(
  route: Route,
  at: { lat: number; lng: number },
): boolean {
  const { from, to } = route
  const direct = kmBetween(from.lat, from.lng, to.lat, to.lng)
  const via =
    kmBetween(from.lat, from.lng, at.lat, at.lng) +
    kmBetween(at.lat, at.lng, to.lat, to.lng)
  return direct > 50 && via <= direct * 1.25 + 150
}

export interface Progress {
  /** 0 at departure, 1 on arrival. */
  done: number
  remainingKm: number
  /** Seconds to go at the current ground speed, or null when too slow to say. */
  remainingS: number | null
}

/**
 * How far along the route the aircraft is, and roughly how long it has left:
 * the straight-line distance to go at today's ground speed. That ignores the
 * descent and the routing, so it is an estimate and is labelled as one.
 */
export function progress(
  route: Route,
  at: { lat: number; lng: number },
  speedMs: number,
): Progress {
  const { from, to } = route
  const flown = kmBetween(from.lat, from.lng, at.lat, at.lng)
  const remainingKm = kmBetween(at.lat, at.lng, to.lat, to.lng)
  const done = flown + remainingKm > 0 ? flown / (flown + remainingKm) : 0
  const remainingS = speedMs >= 50 ? (remainingKm * 1000) / speedMs : null
  return { done, remainingKm, remainingS }
}

/** The widest a followed flight's view gets, in kilometres. */
const WIDEST_KM = 3200

/**
 * Where a followed flight's view is centred, and how wide it is. When the
 * destination is near enough to fit, the view sits between the aircraft and
 * the airport so both are on screen; otherwise it follows the aircraft, wide
 * enough to show some of where it has been.
 */
export function flightView(
  trail: Waypoint[],
  at: { lat: number; lng: number },
  route: Route | null,
): { lat: number; lng: number; spanKm: number } {
  if (route) {
    const to = route.to
    const remaining = kmBetween(at.lat, at.lng, to.lat, to.lng)
    if (remaining * 1.5 <= WIDEST_KM) {
      return {
        lat: (at.lat + to.lat) / 2,
        lng: (at.lng + nearLongitude(to.lng, at.lng)) / 2,
        spanKm: Math.max(remaining * 1.5, 500),
      }
    }
  }
  let farthest = 0
  for (const [, lat, lng] of trail) {
    farthest = Math.max(farthest, kmBetween(at.lat, at.lng, lat, lng))
  }
  return { ...at, spanKm: Math.min(Math.max(farthest * 1.4, 500), WIDEST_KM) }
}

/**
 * Stops as OpenSky's flight-route service writes them: ICAO codes joined by
 * dashes, "KLAX-KSFO-KLAX" for a flight that stops at SFO on its way back to
 * LAX, or "unknown". Each stop is looked up in the bundled airport table for
 * its name, city and position; one that is not there (a small field) means
 * no route, as there is nothing to show or check.
 */
export function parseStops(
  codes: string,
  airportByCode: (code: string) => RoutePlace | null,
): RoutePlace[] {
  const parts = codes.trim().toUpperCase().split('-')
  if (parts.length < 2 || parts.some((c) => !/^[A-Z0-9]{4}$/.test(c))) {
    return []
  }
  const stops = parts.map(airportByCode)
  return stops.every((s): s is RoutePlace => s !== null) ? stops : []
}

/** Consecutive stops as legs: LAX-SFO-LAX is LAX → SFO, then SFO → LAX. */
export function legsOf(stops: RoutePlace[], airline = ''): Route[] {
  const legs: Route[] = []
  for (let i = 1; i < stops.length; i++) {
    if (stops[i - 1]!.icao !== stops[i]!.icao) {
      legs.push({ airline, from: stops[i - 1]!, to: stops[i]! })
    }
  }
  return legs
}

/** One answer per callsign from OpenSky's route service, as legs. */
export function parseRouteset(
  value: unknown,
  airportByCode: (code: string) => RoutePlace | null,
): Record<string, Route[]> {
  const found: Record<string, Route[]> = {}
  if (!Array.isArray(value)) return found
  for (const item of value) {
    const { callsign, airport_codes } = (item ?? {}) as Record<string, unknown>
    if (typeof callsign !== 'string' || typeof airport_codes !== 'string') {
      continue
    }
    found[callsign.trim().toUpperCase()] = legsOf(
      parseStops(airport_codes, airportByCode),
    )
  }
  return found
}

/**
 * The leg of an itinerary this aircraft is plausibly flying now — the one it
 * sits between with the least detour — or null if it fits none.
 */
export function legNow(
  legs: Route[],
  at: { lat: number; lng: number },
): Route | null {
  let best: Route | null = null
  let detour = Infinity
  for (const leg of legs) {
    if (!plausible(leg, at)) continue
    const via =
      kmBetween(leg.from.lat, leg.from.lng, at.lat, at.lng) +
      kmBetween(at.lat, at.lng, leg.to.lat, leg.to.lng) -
      kmBetween(leg.from.lat, leg.from.lng, leg.to.lat, leg.to.lng)
    if (via < detour) {
      best = leg
      detour = via
    }
  }
  return best
}

/**
 * Where an aircraft out of receiver range is likely to be: carried from its
 * last fix towards where it is going at its last ground speed, stopping at
 * the airport; with no route, along its last track for at most 30 minutes.
 * Straight in this flat projection, which is close enough for an estimate
 * that is drawn as one.
 */
export function estimateFrom(
  at: { lat: number; lng: number; speed: number; track: number },
  route: Route | null,
  seconds: number,
): { lat: number; lng: number } {
  if (!route) {
    return deadReckon(
      at.lat,
      at.lng,
      at.speed,
      at.track,
      Math.min(seconds, 1800),
    )
  }
  const to = route.to
  const left = kmBetween(at.lat, at.lng, to.lat, to.lng)
  const fraction =
    left > 0 ? Math.min((at.speed * seconds) / 1000 / left, 1) : 1
  return {
    lat: at.lat + (to.lat - at.lat) * fraction,
    lng: at.lng + (nearLongitude(to.lng, at.lng) - at.lng) * fraction,
  }
}

/** Below this altitude a vanished flight may well have landed. */
export const CRUISE_M = 3000
/** A lost flight with no known route is estimated for at most this long. */
const LOST_WITHOUT_ROUTE_MS = 12 * 60 * 60 * 1000
/** And one with a route, until this long after its estimated arrival. */
const LOST_GRACE_MS = 30 * 60 * 1000

/**
 * Is a flight last heard at `lastFixMs`, from `at`, surely still flying at
 * `now`? Only if it was at cruise when last heard, and has not yet had time
 * to reach where it was going (plus half an hour); with no route, for up to
 * twelve hours.
 */
export function stillDue(
  at: { lat: number; lng: number; speed: number; altitude: number | null },
  route: Route | null,
  lastFixMs: number,
  now: number,
): boolean {
  if ((at.altitude ?? 0) < CRUISE_M) return false
  const toGo = route ? progress(route, at, at.speed).remainingS : null
  const deadline =
    toGo === null
      ? lastFixMs + LOST_WITHOUT_ROUTE_MS
      : lastFixMs + toGo * 1000 + LOST_GRACE_MS
  return now <= deadline
}

/**
 * The aircraft as it was last heard, from the end of its recorded path:
 * position and altitude from the last point, speed and heading from the
 * last two. Null for a path too short to tell.
 */
export function lastHeard(
  path: Waypoint[],
  icao24: string,
  callsign: string,
): Aircraft | null {
  if (path.length < 2) return null
  const [t1, lat1, lng1] = path.at(-2)!
  const [t2, lat2, lng2, altitude] = path.at(-1)!
  const seconds = t2 - t1
  if (seconds <= 0) return null
  return {
    icao24,
    callsign,
    country: '',
    lat: lat2,
    lng: lng2,
    altitude,
    onGround: false,
    speed: (kmBetween(lat1, lng1, lat2, lng2) * 1000) / seconds,
    track: bearing(lat1, lng1, lat2, lng2),
    verticalRate: 0,
    squawk: '',
    seen: t2,
  }
}
