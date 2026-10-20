export const RADIANS = Math.PI / 180
export const KM_PER_DEGREE = 111.32

/** Haversine: 2R·asin(√h). 12742 km is the Earth's mean diameter, the 2R. */
export function kmBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthDiameterKm = 12742
  const dLat = (lat2 - lat1) * RADIANS
  const dLng = (lng2 - lng1) * RADIANS
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RADIANS) *
      Math.cos(lat2 * RADIANS) *
      Math.sin(dLng / 2) ** 2
  return earthDiameterKm * Math.asin(Math.sqrt(Math.min(1, h)))
}

/** Initial great-circle bearing from the first point to the second, 0–360°. */
export function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const φ1 = lat1 * RADIANS
  const φ2 = lat2 * RADIANS
  const dLng = (lng2 - lng1) * RADIANS
  const y = Math.sin(dLng) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng)
  return (Math.atan2(y, x) / RADIANS + 360) % 360
}

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
]

export function compass(degrees: number): string {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16]!
}

/**
 * A longitude moved by whole turns into the half-turn either side of a
 * reference, so a point just over the antimeridian reads as near rather than
 * half a world away.
 */
export function nearLongitude(lng: number, reference: number): number {
  if (lng - reference > 180) return lng - 360
  if (lng - reference < -180) return lng + 360
  return lng
}

/**
 * Where something moving at a steady speed and course will be after a while.
 * Flat-earth over a few minutes of flight is well inside a marker's width.
 */
export function deadReckon(
  lat: number,
  lng: number,
  speedMs: number,
  trackDegrees: number,
  seconds: number,
): { lat: number; lng: number } {
  const km = (speedMs * seconds) / 1000
  const north = km * Math.cos(trackDegrees * RADIANS)
  const east = km * Math.sin(trackDegrees * RADIANS)
  const cosLat = Math.max(Math.cos(lat * RADIANS), 0.01)
  return {
    lat: lat + north / KM_PER_DEGREE,
    lng: lng + east / (KM_PER_DEGREE * cosLat),
  }
}

export interface Box {
  lamin: number
  lomin: number
  lamax: number
  lomax: number
}

/**
 * The latitude/longitude box that holds a circle. OpenSky charges by the box's
 * area in square degrees, so it is kept no bigger than the circle needs.
 */
export function boxAround(lat: number, lng: number, radiusKm: number): Box {
  const dLat = radiusKm / KM_PER_DEGREE
  const cosLat = Math.max(Math.cos(lat * RADIANS), 0.05)
  const dLng = Math.min(radiusKm / (KM_PER_DEGREE * cosLat), 180)
  return {
    lamin: Math.max(lat - dLat, -90),
    lamax: Math.min(lat + dLat, 90),
    lomin: Math.max(lng - dLng, -180),
    lomax: Math.min(lng + dLng, 180),
  }
}

/** A circle as an SVG path in the map's degree space (y = -latitude). */
export function circlePath(lat: number, lng: number, radiusKm: number): string {
  const steps = 96
  const cosLat = Math.max(Math.cos(lat * RADIANS), 0.01)
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    const y = lat + (radiusKm / KM_PER_DEGREE) * Math.cos(angle)
    const x = lng + (radiusKm / (KM_PER_DEGREE * cosLat)) * Math.sin(angle)
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(4)} ${(-y).toFixed(4)}`
  }
  return d
}
