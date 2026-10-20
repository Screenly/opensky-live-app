import { readEdgeAppCache, writeEdgeAppCache } from '@screenly/edge-apps'

import { routeFor } from './opensky'
import type { Route } from './route'

/*
  Routes for the airport board, keyed by callsign. A callsign's usual route
  changes rarely, so each is looked up once and kept on the screen for days;
  "unknown" is kept too, for less long, so it is not asked about every
  refresh. adsbdb is free and needs no key, but is a community service, so
  lookups are few, small and bounded.
*/

const CACHE_NAMESPACE = 'opensky-flight-map'
const CACHE_KEY = 'routes'
const FOUND_MS = 3 * 24 * 60 * 60 * 1000
const UNKNOWN_MS = 12 * 60 * 60 * 1000
/** Entries kept at most; the oldest go first. */
const MAX_ENTRIES = 400
/** New lookups per refresh, and how many run at once. */
const MAX_LOOKUPS = 8
const AT_ONCE = 4

interface Entry {
  route: Route | null
  at: number
}

type Table = Record<string, Entry>

function fresh(entry: Entry | undefined, now: number): entry is Entry {
  if (!entry) return false
  return now - entry.at < (entry.route ? FOUND_MS : UNKNOWN_MS)
}

/**
 * The routes for these callsigns, nearest first: from the screen's own table
 * where known, otherwise looked up (at most a few per refresh). A callsign
 * with no known route maps to null.
 */
export async function routesFor(
  callsigns: string[],
): Promise<Record<string, Route | null>> {
  const now = Date.now()
  const table = readEdgeAppCache<Table>(CACHE_NAMESPACE, CACHE_KEY) ?? {}
  const wanted = [...new Set(callsigns.filter(Boolean))]
  const missing = wanted.filter((c) => !fresh(table[c], now))

  const lookups = missing.slice(0, MAX_LOOKUPS)
  for (let i = 0; i < lookups.length; i += AT_ONCE) {
    const batch = lookups.slice(i, i + AT_ONCE)
    const found = await Promise.all(batch.map((c) => routeFor(c)))
    batch.forEach((c, j) => (table[c] = { route: found[j] ?? null, at: now }))
  }

  if (lookups.length > 0) {
    const kept = Object.entries(table)
      .filter(([, entry]) => fresh(entry, now))
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_ENTRIES)
    writeEdgeAppCache(CACHE_NAMESPACE, CACHE_KEY, Object.fromEntries(kept))
  }

  const result: Record<string, Route | null> = {}
  for (const c of wanted) result[c] = table[c]?.route ?? null
  return result
}
