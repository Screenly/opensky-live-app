import { describe, expect, test } from 'bun:test'

import {
  cityOf,
  code,
  flightView,
  parseRoute,
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
