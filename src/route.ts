// Where a flight is going. OpenSky has positions, not schedules, so the route
// comes from adsbdb's callsign table: the route an airline usually flies under
// a callsign, not a record of this particular trip. Kept free of the Edge Apps
// library so it can be unit-tested without a DOM.

import { kmBetween, nearLongitude } from './geo'
import type { Waypoint } from './states'

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
