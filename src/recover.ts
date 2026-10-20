import type { Cached } from './data'
import type { FlightQuery } from './lookup'
import {
  departuresFrom,
  trackFor,
  type Aircraft,
  type Waypoint,
} from './opensky'
import { lastHeard, stillDue, type Route } from './route'

/*
  A followed flight that is not in OpenSky's live data, and that this
  screen has no last position for — set up, or showing "not found", while
  the flight was out of receiver range. OpenSky still knows it: its departure
  records say which aircraft flew the callsign out of its origin, and that
  aircraft's recorded path ends where it was last heard. If that was at
  cruise, recently enough that it cannot have arrived, it is still flying,
  and the screen can carry it on as an estimate like any flight it lost
  sight of itself.
*/

/** How far back to look for the flight's departure. */
const DEPARTED_WITHIN_S = 16 * 60 * 60

export interface Recovery {
  /** The aircraft as last heard, if it is surely still flying. */
  aircraft: Aircraft | null
  /** Its path so far. */
  trail: Waypoint[]
  /** Its transponder, remembered so the departure need not be looked up again. */
  icao24: string | null
}

/** Which aircraft is flying this callsign: asked of the origin's departures. */
async function aircraftFor(
  query: FlightQuery,
  route: Route | null,
  hint: string | undefined,
): Promise<string | null> {
  if (query.kind === 'icao24') return query.icao24
  if (hint) return hint
  if (!route) return null
  const now = Date.now() / 1000
  const departed = await departuresFrom(
    route.from.icao,
    now - DEPARTED_WITHIN_S,
    now,
  )
  const ours = departed
    .filter((d) => query.callsigns.includes(d.callsign))
    .sort((a, b) => b.firstSeen - a.firstSeen)[0]
  return ours?.icao24 ?? null
}

export async function recoverLost(
  query: FlightQuery,
  route: Route | null,
  hint: string | undefined,
  now: number,
): Promise<Recovery> {
  const icao24 = await aircraftFor(query, route, hint)
  if (!icao24) return { aircraft: null, trail: [], icao24: null }
  const trail = (await trackFor(icao24)) ?? []
  const callsign =
    query.kind === 'callsign' ? (query.callsigns[0] ?? '') : query.label
  const last = lastHeard(trail, icao24, callsign)
  const due = last && stillDue(last, route, last.seen * 1000, now)
  return { aircraft: due ? last : null, trail, icao24 }
}

/**
 * A followed flight that has vanished from OpenSky but is surely still
 * flying: it was at cruise altitude when last heard, and has not yet had
 * time to reach where it was going. Over an ocean there are no receivers —
 * ASA815, San Diego to Honolulu, drops out a few hundred miles off the coast
 * — and "not in the air" would be wrong. Kept, flagged as lost, and carried
 * along its route until it is heard again or should have landed.
 */
export function stillFlying(
  previous: Cached | null,
  last: Aircraft | undefined,
  now: number,
): Cached | null {
  if (!previous || !last || last.onGround) return null
  const lastFix = previous.fetchedAt
  if (!stillDue(last, previous.route, lastFix, now)) return null
  return {
    ...previous,
    snapshot: { time: previous.snapshot.time, aircraft: [last] },
    lostAt: previous.lostAt ?? lastFix,
    checkedAt: now,
  }
}

/**
 * The followed flight is not in OpenSky's live data, and this screen had not
 * lost it at cruise itself: recovered from OpenSky's records if it is still
 * flying out of receiver range, else not in the air.
 */
export async function notInLiveData(
  key: string,
  query: FlightQuery,
  previous: Cached | null,
  grounded: Pick<Cached, 'route' | 'routeFor'>,
  liveTime: number | undefined,
  fetchedAt: number,
): Promise<Cached> {
  // No position of our own: OpenSky may still know where it was last heard
  // (out of receiver range since before this screen looked).
  const found = await recoverLost(
    query,
    grounded.route,
    previous?.hint,
    fetchedAt,
  )
  const hint = found.icao24 ?? previous?.hint
  if (found.aircraft) {
    const lastFix = found.aircraft.seen * 1000
    return {
      key,
      fetchedAt: lastFix,
      snapshot: { time: found.aircraft.seen, aircraft: [found.aircraft] },
      target: found.aircraft.icao24,
      trail: found.trail,
      trailAt: fetchedAt,
      ...grounded,
      lostAt: lastFix,
      checkedAt: fetchedAt,
      hint,
    }
  }
  return {
    key,
    fetchedAt,
    snapshot: { time: liveTime ?? fetchedAt / 1000, aircraft: [] },
    target: null,
    trail: [],
    trailAt: 0,
    ...grounded,
    hint,
  }
}
