// The OpenSky wire format, kept free of the Edge Apps library so it can be
// unit-tested without a DOM.

/** One aircraft, trimmed to the state-vector fields this app draws. */
export interface Aircraft {
  icao24: string
  callsign: string
  country: string
  lat: number
  lng: number
  /** Metres. Barometric when known, else geometric, else null. */
  altitude: number | null
  onGround: boolean
  /** Ground speed, m/s. */
  speed: number
  /** True track, degrees clockwise from north. */
  track: number
  /** m/s, positive climbing. */
  verticalRate: number
  squawk: string
  /** Unix seconds of the position fix. */
  seen: number
}

/** A batch of positions, and the moment OpenSky took them. */
export interface Snapshot {
  time: number
  aircraft: Aircraft[]
}

/** A flown path: [unix seconds, lat, lng, baro altitude (m)]. */
export type Waypoint = [number, number, number, number | null]

type StateRow = [
  string, // 0 icao24
  string | null, // 1 callsign
  string, // 2 origin_country
  number | null, // 3 time_position
  number, // 4 last_contact
  number | null, // 5 longitude
  number | null, // 6 latitude
  number | null, // 7 baro_altitude
  boolean, // 8 on_ground
  number | null, // 9 velocity
  number | null, // 10 true_track
  number | null, // 11 vertical_rate
  unknown, // 12 sensors
  number | null, // 13 geo_altitude
  string | null, // 14 squawk
  ...unknown[],
]

/**
 * State vectors off the wire. The envelope is checked; rows without a position
 * are dropped, since there is nothing to draw for them.
 */
export function parseStates(value: unknown): Snapshot {
  if (typeof value !== 'object' || value === null) {
    throw new Error('OpenSky returned something other than JSON')
  }
  const { time, states } = value as { time?: unknown; states?: unknown }
  if (typeof time !== 'number') throw new Error('OpenSky response had no time')
  // `states` is null, not [], when nothing is in the box.
  const rows = Array.isArray(states) ? (states as StateRow[]) : []
  const aircraft: Aircraft[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const lat = row[6]
    const lng = row[5]
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    aircraft.push({
      icao24: String(row[0]),
      callsign: (row[1] ?? '').trim(),
      country: row[2] ?? '',
      lat,
      lng,
      altitude: row[7] ?? row[13] ?? null,
      onGround: row[8] === true,
      speed: row[9] ?? 0,
      track: row[10] ?? 0,
      verticalRate: row[11] ?? 0,
      squawk: row[14] ?? '',
      seen: row[3] ?? row[4] ?? time,
    })
  }
  return { time, aircraft }
}
