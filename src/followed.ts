import type { Cached } from './data'
import {
  hasCredentials,
  lastTakeOff,
  routeFor,
  routesFromOpenSky,
  trackFor,
  type Aircraft,
} from './opensky'
import { legNow, plausible, type Route } from './route'

/*
  What a followed flight carries beyond its position: the path it has flown,
  its route, who flies it, and — when no route is known, as for charters
  (NetJets' EJA888) — where OpenSky saw it take off.
*/

/**
 * How often a flown path is refetched. Paths cost 4 credits each from their
 * own allowance: every 30 minutes is 192 a day, inside the anonymous 400;
 * signed in, every 10 minutes is 576 of 4,000.
 */
function trailRefreshMs(): number {
  return (hasCredentials() ? 10 : 30) * 60 * 1000
}

/**
 * A followed flight's route: the leg of OpenSky's itinerary the aircraft is
 * plausibly flying now, else adsbdb's route if that fits, else none — a
 * route the aircraft is clearly not flying is worse than no route at all.
 * adsbdb is asked alongside either way, for the airline's name, which
 * OpenSky's route service does not give: kept even when its route is not.
 */
async function fittingRoute(
  callsign: string,
  at: Aircraft,
): Promise<{ route: Route | null; airline: string }> {
  const [opensky, adsbdb] = await Promise.all([
    routesFromOpenSky([{ callsign, lat: at.lat, lng: at.lng }]),
    routeFor(callsign),
  ])
  const airline = adsbdb?.airline ?? ''
  const leg = legNow(opensky[callsign] ?? [], at)
  if (leg) return { route: { ...leg, airline }, airline }
  return { route: adsbdb && plausible(adsbdb, at) ? adsbdb : null, airline }
}

type Extras = Pick<
  Cached,
  | 'trail'
  | 'trailAt'
  | 'route'
  | 'routeFor'
  | 'airline'
  | 'origin'
  | 'originFor'
>

/** No route: where did it take off? Asked once per aircraft. */
async function originOf(
  found: Aircraft,
  previous: Cached | null,
  fetchedAt: number,
): Promise<Cached['origin']> {
  if (previous?.originFor === found.icao24) return previous.origin ?? null
  return lastTakeOff(found.icao24, fetchedAt / 1000)
}

/**
 * Where a followed flight has been, and where it is going. The trail is
 * refetched every ten minutes; the route once per callsign, and the origin
 * once per aircraft, since neither changes mid-flight.
 */
export async function whereFromAndTo(
  found: Aircraft,
  previous: Cached | null,
  fetchedAt: number,
): Promise<Extras> {
  const sameFlight = previous?.target === found.icao24
  const trailDue =
    fetchedAt - (sameFlight ? previous.trailAt : 0) > trailRefreshMs()
  const callsign = found.callsign.toUpperCase()
  const routeKnown = previous !== null && previous.routeFor === callsign

  // Both at once: the first screen, and its ready signal, wait for them.
  const [fetchedTrail, fetched] = await Promise.all([
    trailDue ? trackFor(found.icao24) : null,
    !routeKnown && callsign ? fittingRoute(callsign, found) : null,
  ])
  const route = routeKnown ? (previous.route ?? null) : (fetched?.route ?? null)
  const airline = routeKnown ? previous.airline : fetched?.airline

  const origin = route ? null : await originOf(found, previous, fetchedAt)

  const keptTrail = sameFlight ? previous.trail : []
  return {
    // An attempt counts even when it fails, so a missing path is not retried
    // (and paid for) on every refresh. No answer keeps the trail drawn.
    trail: fetchedTrail ?? keptTrail,
    trailAt: trailDue ? fetchedAt : sameFlight ? previous.trailAt : 0,
    route,
    routeFor: callsign,
    airline,
    origin,
    originFor: route ? previous?.originFor : found.icao24,
  }
}
