import { getSettingWithDefault } from '@screenly/edge-apps'

import type { Box } from './geo'
import { findAirport } from './lookup'
import { parseRoute, parseRouteset, type Route } from './route'
import { parseStates, type Snapshot, type Waypoint } from './states'

export type { Aircraft, Snapshot, Waypoint } from './states'

const API = 'https://opensky-network.org/api'
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

/**
 * The screenshotter gives the page 10s to go quiet and then up to 10s more for
 * the ready signal. Time OpenSky out well inside that, so a hanging API still
 * leaves room to fall back to cache, draw, and signal.
 */
const FETCH_TIMEOUT_MS = 8000

/** OpenSky ran out of credits for this client; retry after this many seconds. */
export class RateLimited extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`OpenSky rate limit reached; retry in ${retryAfterSeconds}s`)
  }
}

/**
 * OpenSky refused the client ID and secret (HTTP 400/401, `invalid_client`).
 * A setting to fix, not an outage: cached data is no answer to it.
 */
export class CredentialsRejected extends Error {
  constructor(status: number) {
    super(`OpenSky did not accept the client ID and secret (HTTP ${status})`)
  }
}

function proxied(url: string): string {
  return `${screenly.cors_proxy_url}/${url}`
}

/**
 * Whether the OpenSky API client settings are filled in: neither (anonymous
 * access), both (signed in), or only one — a half-entered pair, which is
 * flagged rather than quietly treated as anonymous.
 */
export function credentials(): 'none' | 'partial' | 'complete' {
  const id = getSettingWithDefault<string>('opensky_client_id', '').trim()
  const secret = getSettingWithDefault<string>(
    'opensky_client_secret',
    '',
  ).trim()
  if (id && secret) return 'complete'
  return id || secret ? 'partial' : 'none'
}

export function hasCredentials(): boolean {
  return credentials() === 'complete'
}

let token: { value: string; expires: number } | null = null

/**
 * An OAuth2 client-credentials token. Tokens last 30 minutes; one is reused
 * until a minute before it runs out. No credentials means anonymous access.
 */
async function bearer(): Promise<string | null> {
  if (!hasCredentials()) return null
  if (token && Date.now() < token.expires) return token.value

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: getSettingWithDefault<string>('opensky_client_id', '').trim(),
    client_secret: getSettingWithDefault<string>(
      'opensky_client_secret',
      '',
    ).trim(),
  })
  const response = await fetch(proxied(TOKEN_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (response.status === 400 || response.status === 401) {
    throw new CredentialsRejected(response.status)
  }
  if (!response.ok) {
    throw new Error(`OpenSky sign-in returned ${response.status}`)
  }
  const granted = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }
  if (!granted.access_token) throw new Error('OpenSky sign-in gave no token')
  const lifetimeMs = (granted.expires_in ?? 1800) * 1000
  token = {
    value: granted.access_token,
    expires: Date.now() + lifetimeMs - 60000,
  }
  return token.value
}

async function get(path: string): Promise<Response> {
  const send = async () => {
    const auth = await bearer()
    return fetch(proxied(`${API}${path}`), {
      headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  }
  let response = await send()
  // A 401 with credentials means the token lapsed early. Sign in again, once.
  if (response.status === 401 && token) {
    token = null
    response = await send()
  }
  if (response.status === 429) {
    const wait = Number(
      response.headers.get('X-Rate-Limit-Retry-After-Seconds') ?? 600,
    )
    throw new RateLimited(Number.isFinite(wait) ? wait : 600)
  }
  return response
}

async function states(query: string): Promise<Snapshot> {
  const response = await get(`/states/all${query}`)
  if (!response.ok) {
    throw new Error(
      `OpenSky returned ${response.status} ${response.statusText}`.trim(),
    )
  }
  return parseStates(await response.json())
}

/** Everything inside a box. 1 credit up to 25 square degrees, 4 past 400. */
export function statesIn(box: Box): Promise<Snapshot> {
  const { lamin, lomin, lamax, lomax } = box
  const q = (n: number) => n.toFixed(4)
  return states(
    `?lamin=${q(lamin)}&lomin=${q(lomin)}&lamax=${q(lamax)}&lomax=${q(lomax)}`,
  )
}

/** One transponder, wherever it is. */
export function statesFor(icao24: string): Promise<Snapshot> {
  return states(`?icao24=${encodeURIComponent(icao24)}`)
}

/** The whole world. 4 credits — used only to find a flight by callsign. */
export function statesEverywhere(): Promise<Snapshot> {
  return states('')
}

/** Paths have their own daily allowance; when it runs out, pause until reset. */
let tracksPausedUntil = 0

/**
 * The path a flight has flown so far, or null when it could not be fetched
 * (keep whatever trail is already drawn). Experimental on OpenSky's side, and
 * metered separately from positions, so no failure here — running out of
 * path credits included — is allowed to fail the position update: the trail
 * is decoration, the position is the content.
 */
export async function trackFor(icao24: string): Promise<Waypoint[] | null> {
  if (Date.now() < tracksPausedUntil) return null
  try {
    const response = await get(
      `/tracks/all?icao24=${encodeURIComponent(icao24)}&time=0`,
    )
    if (!response.ok) return null
    const body = (await response.json()) as { path?: unknown }
    if (!Array.isArray(body.path)) return null
    return (body.path as unknown[][])
      .filter(
        (point) =>
          Array.isArray(point) &&
          typeof point[1] === 'number' &&
          typeof point[2] === 'number',
      )
      .map((point) => [
        point[0] as number,
        point[1] as number,
        point[2] as number,
        (point[3] as number | null) ?? null,
      ])
  } catch (error) {
    if (error instanceof RateLimited) {
      tracksPausedUntil = Date.now() + error.retryAfterSeconds * 1000
    }
    console.warn('No track for', icao24, error)
    return null
  }
}

/**
 * The route usually flown under a callsign, from adsbdb (free, no key). Like
 * the trail, it is decoration: any failure, or an unknown callsign, is no
 * route rather than an error.
 */
export async function routeFor(callsign: string): Promise<Route | null> {
  try {
    const response = await fetch(
      proxied(
        `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`,
      ),
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    )
    if (!response.ok) return null
    return parseRoute(await response.json())
  } catch (error) {
    console.warn('No route for', callsign, error)
    return null
  }
}

/** Callsigns asked about in one request to OpenSky's route service. */
const ROUTESET_BATCH = 30

/**
 * Routes from OpenSky's flight-route service — the one behind its own live
 * map (map.opensky-network.org), not part of the documented REST API, so it
 * may change without notice. Free, no key, no credits, and batched: one
 * request answers a whole board. Each callsign maps to its itinerary as
 * legs; [] means OpenSky does not know it. A callsign missing from the
 * result (any failure) has no answer, and the caller falls back.
 */
export async function routesFromOpenSky(
  planes: Array<{ callsign: string; lat?: number; lng?: number }>,
): Promise<Record<string, Route[]>> {
  const found: Record<string, Route[]> = {}
  for (let i = 0; i < planes.length; i += ROUTESET_BATCH) {
    try {
      const response = await fetch(
        proxied('https://flightroutes.opensky-network.org/api/routeset'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planes: planes.slice(i, i + ROUTESET_BATCH) }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      )
      if (!response.ok) continue
      Object.assign(found, parseRouteset(await response.json(), findAirport))
    } catch (error) {
      console.warn('OpenSky route service failed', error)
    }
  }
  return found
}

/** A departure OpenSky saw: which aircraft, under which callsign, when. */
export interface Departure {
  icao24: string
  callsign: string
  firstSeen: number
}

/**
 * Flights OpenSky saw leave an airport between two times (Unix seconds).
 * Used to learn which aircraft a callsign is when it is not in the live data
 * — out of receiver range — so its recorded path can be read. Costs credits
 * from the flights allowance; any failure is no departures.
 */
export async function departuresFrom(
  airportIcao: string,
  begin: number,
  end: number,
): Promise<Departure[]> {
  try {
    const response = await get(
      `/flights/departure?airport=${encodeURIComponent(airportIcao)}&begin=${Math.floor(begin)}&end=${Math.floor(end)}`,
    )
    if (!response.ok) return []
    const body = (await response.json()) as unknown
    if (!Array.isArray(body)) return []
    return body
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x.icao24 === 'string')
      .map((x) => ({
        icao24: String(x.icao24),
        callsign: String(x.callsign ?? '')
          .trim()
          .toUpperCase(),
        firstSeen: Number(x.firstSeen),
      }))
  } catch (error) {
    console.warn('No departures for', airportIcao, error)
    return []
  }
}
