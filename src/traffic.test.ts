import { describe, expect, test } from 'bun:test'

import { findAirport } from './lookup'
import type { Aircraft } from './states'
import { parseRoute } from './route'
import { angleBetween, band, board, phaseAt, routeLine } from './traffic'

const lhr = findAirport('EGLL')!

function aircraft(overrides: Partial<Aircraft>): Aircraft {
  return {
    icao24: 'abc123',
    callsign: 'TEST1',
    country: 'United Kingdom',
    lat: lhr.lat,
    lng: lhr.lng,
    altitude: 1000,
    onGround: false,
    speed: 80,
    track: 0,
    verticalRate: 0,
    squawk: '',
    seen: 0,
    ...overrides,
  }
}

describe('traffic', () => {
  test('altitude bands', () => {
    expect(band(aircraft({ onGround: true }))).toBe('gnd')
    expect(band(aircraft({ altitude: 1000 }))).toBe('low')
    expect(band(aircraft({ altitude: 6000 }))).toBe('mid')
    expect(band(aircraft({ altitude: 11000 }))).toBe('high')
  })

  test('angles wrap', () => {
    expect(angleBetween(350, 10)).toBe(20)
    expect(angleBetween(90, 270)).toBe(180)
  })

  test('descending towards the field is an arrival', () => {
    // 20 km east of Heathrow, heading west, descending.
    const inbound = aircraft({
      lng: lhr.lng + 0.29,
      track: 270,
      verticalRate: -4,
    })
    expect(phaseAt(lhr, inbound, 100)).toBe('arr')
  })

  test('climbing away from the field is a departure', () => {
    const outbound = aircraft({
      lng: lhr.lng - 0.15,
      track: 270,
      verticalRate: 8,
    })
    expect(phaseAt(lhr, outbound, 100)).toBe('dep')
  })

  test('cruising traffic and other airports are ignored', () => {
    expect(
      phaseAt(lhr, aircraft({ altitude: 11000, verticalRate: -4 }), 100),
    ).toBeNull()
    // On the ground 40 km away: someone else's apron.
    expect(
      phaseAt(lhr, aircraft({ onGround: true, lat: lhr.lat + 0.36 }), 100),
    ).toBeNull()
    expect(phaseAt(lhr, aircraft({ onGround: true }), 100)).toBe('gnd')
  })
})

function route(from: [string, string, string], to: [string, string, string]) {
  const place = ([iata, icao, city]: [string, string, string]) => ({
    iata_code: iata,
    icao_code: icao,
    municipality: city,
    name: `${city} Airport`,
    latitude: 0,
    longitude: 0,
  })
  return parseRoute({
    response: {
      flightroute: { origin: place(from), destination: place(to) },
    },
  })!
}

describe('airport board', () => {
  const inbound = (km: number, id: string) =>
    aircraft({
      icao24: id,
      lng: lhr.lng + km / 69.4,
      track: 270,
      verticalRate: -4,
    })

  test('arrivals nearest first, then departures', () => {
    const far = inbound(30, 'far')
    const near = inbound(10, 'near')
    const out = aircraft({
      icao24: 'out',
      lng: lhr.lng - 0.1,
      track: 270,
      verticalRate: 8,
    })
    const cruising = aircraft({ icao24: 'high', altitude: 11000 })
    expect(
      board(lhr, [out, far, cruising, near], 100).map((e) => e.aircraft.icao24),
    ).toEqual(['near', 'far', 'out'])
  })

  test('arrivals say where from, departures where to', () => {
    const mleToLhr = route(['MLE', 'VRMM', 'Malé'], ['LHR', 'EGLL', 'London'])
    const lhrToDel = route(['LHR', 'EGLL', 'London'], ['DEL', 'VIDP', 'Delhi'])
    expect(routeLine(lhr, 'arr', mleToLhr)).toBe('From MLE Malé')
    expect(routeLine(lhr, 'dep', lhrToDel)).toBe('To DEL Delhi')
  })

  test('a route that does not touch this airport is not shown', () => {
    const elsewhere = route(['MLE', 'VRMM', 'Malé'], ['DEL', 'VIDP', 'Delhi'])
    expect(routeLine(lhr, 'arr', elsewhere)).toBeNull()
    // Right airports, wrong way round for the phase.
    const lhrToDel = route(['LHR', 'EGLL', 'London'], ['DEL', 'VIDP', 'Delhi'])
    expect(routeLine(lhr, 'arr', lhrToDel)).toBeNull()
    expect(routeLine(lhr, 'arr', null)).toBeNull()
  })
})
