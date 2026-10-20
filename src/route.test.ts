import { describe, expect, test } from 'bun:test'

import { kmBetween } from './geo'
import { findAirport } from './lookup'

import {
  cityOf,
  code,
  flightView,
  estimateFrom,
  lastHeard,
  legNow,
  legsOf,
  parseRoute,
  parseRouteset,
  parseStops,
  plausible,
  progress,
} from './route'

const MLE_DEL = {
  response: {
    flightroute: {
      airline: { name: 'Air India' },
      origin: {
        iata_code: 'MLE',
        icao_code: 'VRMM',
        name: 'Velana International Airport',
        municipality: 'Malé',
        latitude: 4.1918,
        longitude: 73.529,
      },
      destination: {
        iata_code: 'DEL',
        icao_code: 'VIDP',
        name: 'Indira Gandhi International Airport',
        municipality: 'Delhi',
        latitude: 28.5665,
        longitude: 77.1031,
      },
    },
  },
}

describe('route', () => {
  const route = parseRoute(MLE_DEL)!

  test('reads an adsbdb route', () => {
    expect(route.airline).toBe('Air India')
    expect(`${code(route.from)} ${cityOf(route.from)}`).toBe('MLE Malé')
    expect(`${code(route.to)} ${cityOf(route.to)}`).toBe('DEL Delhi')
  })

  test('unknown callsigns and odd bodies are no route', () => {
    expect(parseRoute({ response: 'unknown callsign' })).toBeNull()
    expect(parseRoute(null)).toBeNull()
    expect(parseRoute({ response: { flightroute: { origin: {} } } })).toBeNull()
  })

  test('falls back from city to a shortened airport name', () => {
    const noCity = { ...route.to, city: '' }
    expect(cityOf(noCity)).toBe('Indira Gandhi')
  })

  test('an aircraft between the airports is on the route', () => {
    // Over Bengaluru, roughly on the way.
    expect(plausible(route, { lat: 13.0, lng: 77.6 })).toBe(true)
    // Over London: the callsign is flying some other leg today.
    expect(plausible(route, { lat: 51.5, lng: -0.1 })).toBe(false)
  })

  test('progress and time to go', () => {
    const halfway = { lat: 16.38, lng: 75.3 }
    const ahead = progress(route, halfway, 250)
    expect(ahead.done).toBeGreaterThan(0.45)
    expect(ahead.done).toBeLessThan(0.55)
    expect(ahead.remainingS).toBeCloseTo((ahead.remainingKm * 1000) / 250)
    expect(progress(route, halfway, 10).remainingS).toBeNull()
  })
})

describe('flightView', () => {
  const route = parseRoute(MLE_DEL)!

  test('a near destination is framed with the aircraft', () => {
    const view = flightView([], { lat: 24, lng: 76 }, route)
    expect(view.lat).toBeCloseTo((24 + 28.5665) / 2)
    expect(view.spanKm).toBeGreaterThan(500)
  })

  test('a far one, or none, follows the aircraft', () => {
    expect(flightView([], { lat: 5, lng: 73.6 }, route)).toEqual({
      lat: 5,
      lng: 73.6,
      spanKm: 500,
    })
    expect(flightView([], { lat: 10, lng: 20 }, null).lat).toBe(10)
  })
})

describe("OpenSky's flight-route service", () => {
  const lookup = (code: string) => findAirport(code)

  test('stops become legs, with names and cities', () => {
    const legs = parseRouteset(
      [
        { callsign: 'SKW6274', airport_codes: 'KLAX-KSFO-KLAX', plausible: 1 },
        { callsign: 'UAL1768', airport_codes: 'KIAH-KSFO', plausible: 1 },
      ],
      lookup,
    )
    expect(legs.UAL1768!.map((l) => `${code(l.from)}-${code(l.to)}`)).toEqual([
      'IAH-SFO',
    ])
    expect(legs.SKW6274!.map((l) => `${code(l.from)}-${code(l.to)}`)).toEqual([
      'LAX-SFO',
      'SFO-LAX',
    ])
    expect(cityOf(legs.UAL1768![0]!.from)).toBe('Houston')
  })

  test('"unknown", junk and airports not in the table are no legs', () => {
    const legs = parseRouteset(
      [
        { callsign: 'ZZZ9999', airport_codes: 'unknown', plausible: 0 },
        { callsign: 'ODD1', airport_codes: 'KSFO-ZZZZ', plausible: 1 },
        { airport_codes: 'KSFO-KLAX' },
      ],
      lookup,
    )
    expect(legs).toEqual({ ZZZ9999: [], ODD1: [] })
    expect(parseRouteset('<html>', lookup)).toEqual({})
    expect(parseStops('KSFO', lookup)).toEqual([])
  })

  test('the leg being flown now is the one the aircraft sits on', () => {
    const legs = legsOf(parseStops('KLAX-KSFO-KSEA', lookup))
    // Over Oregon, between SFO and Seattle.
    const now = legNow(legs, { lat: 43.5, lng: -122.8 })
    expect(now && `${code(now.from)}-${code(now.to)}`).toBe('SFO-SEA')
    // Over London: neither leg.
    expect(legNow(legs, { lat: 51.5, lng: -0.1 })).toBeNull()
  })
})

describe('out of receiver range (ASA815, San Diego to Honolulu)', () => {
  const san = findAirport('KSAN')!
  const hnl = findAirport('PHNL')!
  const route = { airline: '', from: san, to: hnl }
  // Last heard 250 miles off the coast, at cruise.
  const lastFix = { lat: 33.92, lng: -123.53, speed: 226, track: 260 }

  test('carried on towards its destination at its last speed', () => {
    const hour = estimateFrom(lastFix, route, 3600)
    // 226 m/s for an hour is about 814 km further on, and nearer Honolulu.
    expect(kmBetween(lastFix.lat, lastFix.lng, hour.lat, hour.lng)).toBeCloseTo(
      814,
      -2,
    )
    expect(kmBetween(hour.lat, hour.lng, hnl.lat, hnl.lng)).toBeLessThan(
      kmBetween(lastFix.lat, lastFix.lng, hnl.lat, hnl.lng),
    )
  })

  test('never past the airport', () => {
    const late = estimateFrom(lastFix, route, 24 * 3600)
    expect(late.lat).toBeCloseTo(hnl.lat)
    expect(late.lng).toBeCloseTo(hnl.lng)
  })

  test('with no route, along its last track for half an hour at most', () => {
    const a = estimateFrom(lastFix, null, 1800)
    const b = estimateFrom(lastFix, null, 7200)
    expect(b).toEqual(a)
  })
})

describe('the aircraft as last heard, from its recorded path', () => {
  test('position and altitude from the last point; speed and heading from the last two', () => {
    // Ten minutes heading due west at 0.1° of longitude a minute, at FL400.
    const path: Array<[number, number, number, number | null]> = [
      [1000, 34, -123.0, 12192],
      [1600, 34, -124.0, 12192],
    ]
    const last = lastHeard(path, 'a48379', 'ASA815')!
    expect([last.lat, last.lng, last.altitude]).toEqual([34, -124, 12192])
    expect(last.seen).toBe(1600)
    expect(last.track).toBeCloseTo(270, 0)
    // 1° of longitude at 34°N is about 92 km: over 600 s, about 154 m/s.
    expect(last.speed).toBeCloseTo(154, -1)
  })

  test('a path too short to tell is no aircraft', () => {
    expect(lastHeard([[1, 34, -123, 1000]], 'x', 'X1')).toBeNull()
  })
})
