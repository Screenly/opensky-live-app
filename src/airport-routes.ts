import { readEdgeAppCache, writeEdgeAppCache } from '@screenly/edge-apps'

import type { Airport } from './lookup'
import { routeFor, routesFromOpenSky, type Aircraft } from './opensky'
import { legNow, type Route } from './route'
import { touches, type Routes } from './traffic'

/*
  Routes for the airport board, and for the list around a screen, keyed by
  callsign. OpenSky's own flight-route
  service is asked first, in one batched request for the whole board; adsbdb
  only for the few callsigns OpenSky has nothing for, or nothing that touches
  this airport. A callsign's itinerary changes rarely, so each is looked up
  once and kept on the screen for days; "unknown" is kept too, for less
  long, so it is not asked about every refresh.
*/

const CACHE_NAMESPACE = 'opensky-flight-map'
/** One table per airport. v2: itineraries as legs, from OpenSky first. */
const cacheKey = (airport: Airport | null) =>
  `routes-v2:${airport?.icao ?? 'area'}`
const FOUND_MS = 3 * 24 * 60 * 60 * 1000
const UNKNOWN_MS = 12 * 60 * 60 * 1000
/** Entries kept at most; the oldest go first. */
const MAX_ENTRIES = 400
/** New callsigns asked about per refresh: one OpenSky request's worth. */
const MAX_LOOKUPS = 30
/** adsbdb fallbacks per refresh, for what OpenSky could not place. */
const MAX_FALLBACKS = 4

interface Entry {
  legs: Route[]
  at: number
}

type Table = Record<string, Entry>

function fresh(entry: Entry | undefined, now: number): entry is Entry {
  if (!entry || !Array.isArray(entry.legs)) return false
  return now - entry.at < (entry.legs.length ? FOUND_MS : UNKNOWN_MS)
}

/**
 * Does an itinerary fit? At an airport, it must start or end there. Around
 * a screen, the aircraft must plausibly be flying one of its legs now.
 */
function fits(airport: Airport | null, legs: Route[], at: Aircraft): boolean {
  if (airport) return legs.some((leg) => touches(airport, leg))
  return legNow(legs, at) !== null
}

/**
 * Looks up the callsigns not already known: OpenSky for all of them at once,
 * then adsbdb for a few of those OpenSky could not tie to this airport.
 */
async function lookUp(
  aircraft: Aircraft[],
  airport: Airport | null,
): Promise<Record<string, Route[]>> {
  const planes = aircraft.map((a) => ({
    callsign: a.callsign.trim().toUpperCase(),
    lat: a.lat,
    lng: a.lng,
  }))
  const opensky = await routesFromOpenSky(planes)
  const found: Record<string, Route[]> = {}
  const unplaced: string[] = []
  const byCallsign = new Map(planes.map((p, i) => [p.callsign, aircraft[i]!]))
  for (const { callsign } of planes) {
    const legs = opensky[callsign] ?? []
    found[callsign] = legs
    if (!fits(airport, legs, byCallsign.get(callsign)!)) unplaced.push(callsign)
  }
  const fallbacks = await Promise.all(
    unplaced.slice(0, MAX_FALLBACKS).map((c) => routeFor(c)),
  )
  unplaced.slice(0, MAX_FALLBACKS).forEach((callsign, i) => {
    const route = fallbacks[i]
    // adsbdb only replaces OpenSky's answer if it does better: it fits, or
    // OpenSky had nothing at all.
    const better =
      route &&
      (fits(airport, [route], byCallsign.get(callsign)!) ||
        found[callsign]!.length === 0)
    if (route && better) {
      found[callsign] = [route]
    }
  })
  return found
}

/**
 * The itineraries for these aircraft, from the screen's own table where
 * known, otherwise looked up. A callsign with no known route maps to [].
 */
export async function routesFor(
  aircraft: Aircraft[],
  airport: Airport | null,
): Promise<Routes> {
  const now = Date.now()
  const key = cacheKey(airport)
  const table = readEdgeAppCache<Table>(CACHE_NAMESPACE, key) ?? {}
  const callsignOf = (a: Aircraft) => a.callsign.trim().toUpperCase()
  const wanted = aircraft.filter(
    (a, i, all) =>
      callsignOf(a) !== '' &&
      all.findIndex((b) => callsignOf(b) === callsignOf(a)) === i,
  )
  const missing = wanted
    .filter((a) => !fresh(table[callsignOf(a)], now))
    .slice(0, MAX_LOOKUPS)

  if (missing.length > 0) {
    const found = await lookUp(missing, airport)
    for (const [callsign, legs] of Object.entries(found)) {
      table[callsign] = { legs, at: now }
    }
    const kept = Object.entries(table)
      .filter(([, entry]) => fresh(entry, now))
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_ENTRIES)
    writeEdgeAppCache(CACHE_NAMESPACE, key, Object.fromEntries(kept))
  }

  const result: Routes = {}
  for (const a of wanted)
    result[callsignOf(a)] = table[callsignOf(a)]?.legs ?? []
  return result
}
