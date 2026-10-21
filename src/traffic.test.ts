import { describe, expect, test } from 'bun:test'

import { findAirport } from './lookup'
import type { Aircraft } from './states'
import { parseRoute } from './route'
import {
  angleBetween,
  board,
  elsewhere,
  listedPhase,
  motionOf,
  phaseAt,
  routeLine,
  secondsSinceTakeOff,
  secondsToLanding,
} from './traffic'

const lhr = findAirport('EGLL')!

function aircraft(overrides: Partial<Aircraft>): Aircraft {
  return {
    icao24: 'abc123',
    callsign: 'TST101',
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
  test('away from an airport, colour follows vertical speed', () => {
    const at = (overrides: Partial<Aircraft>) =>
      motionOf(aircraft(overrides), null, 100)
    expect(at({ onGround: true })).toBe('gnd')
    expect(at({ verticalRate: -5 })).toBe('arr') // descending
    expect(at({ verticalRate: 5 })).toBe('dep') // climbing
    expect(at({ verticalRate: 0.5 })).toBe('pass') // level
  })

  test('at an airport, colour follows arriving, departing or passing', () => {
    const inbound = aircraft({
      lng: lhr.lng + 0.29,
      track: 270,
      verticalRate: -4,
    })
    // Descending, but 50 km away pointed away from Heathrow: someone else's.
    const elsewhere = aircraft({
      lng: lhr.lng + 0.72,
      track: 90,
      verticalRate: -4,
    })
    const cruising = aircraft({ altitude: 11000 })
    expect(motionOf(inbound, lhr, 100)).toBe('arr')
    expect(motionOf(elsewhere, lhr, 100)).toBe('pass')
    expect(motionOf(cruising, lhr, 100)).toBe('pass')
    expect(motionOf(aircraft({ onGround: true }), lhr, 100)).toBe('gnd')
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

  test('arrivals and departures take turns', () => {
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
    ).toEqual(['near', 'out', 'far'])
  })

  test('a busy stream of arrivals cannot push the others off', () => {
    const arrivals = [10, 20, 30, 40, 50].map((km) => inbound(km, `a${km}`))
    const out = aircraft({
      icao24: 'out',
      lng: lhr.lng - 0.1,
      track: 270,
      verticalRate: 8,
    })
    const parked = aircraft({ icao24: 'parked', onGround: true, speed: 0 })
    const rows = board(lhr, [...arrivals, out, parked], 100)
    // Arrivals and departures take turns; the parked aircraft is counted,
    // not listed.
    expect(rows.slice(0, 4).map((e) => e.aircraft.icao24)).toEqual([
      'a10',
      'out',
      'a20',
      'a30',
    ])
    expect(rows.some((e) => e.aircraft.icao24 === 'parked')).toBe(false)
  })

  test('arrivals say where from, departures where to', () => {
    const mleToLhr = route(['MLE', 'VRMM', 'Malé'], ['LHR', 'EGLL', 'London'])
    const lhrToDel = route(['LHR', 'EGLL', 'London'], ['DEL', 'VIDP', 'Delhi'])
    expect(routeLine(lhr, 'arr', [mleToLhr])).toBe('From MLE Malé')
    expect(routeLine(lhr, 'dep', [lhrToDel])).toBe('To DEL Delhi')
  })

  test('a route that does not touch this airport is not shown', () => {
    const elsewhere = route(['MLE', 'VRMM', 'Malé'], ['DEL', 'VIDP', 'Delhi'])
    expect(routeLine(lhr, 'arr', [elsewhere])).toBeNull()
    // Right airports, wrong way round for the phase.
    const lhrToDel = route(['LHR', 'EGLL', 'London'], ['DEL', 'VIDP', 'Delhi'])
    expect(routeLine(lhr, 'arr', [lhrToDel])).toBeNull()
    expect(routeLine(lhr, 'arr', [])).toBeNull()
  })
})

describe('aircraft passing through', () => {
  test('are not on the airport board, nor is the ground', () => {
    const near = aircraft({
      icao24: 'near',
      lng: lhr.lng + 10 / 69.4,
      track: 270,
      verticalRate: -4,
    })
    const over = aircraft({ icao24: 'over', altitude: 11000 })
    const parked = aircraft({ icao24: 'parked', onGround: true, speed: 0 })
    const rows = board(lhr, [over, parked, near], 100)
    expect(rows.map((e) => [e.aircraft.icao24, e.phase])).toEqual([
      ['near', 'arr'],
    ])
    // …but still coloured as passing on the map.
    expect(motionOf(over, lhr, 100)).toBe('pass')
  })
})

describe('board times', () => {
  // 10 km east of Heathrow.
  const tenKmOut = { lng: lhr.lng + 10 / 69.4 }

  test('an arrival lands in distance over ground speed', () => {
    const inbound = aircraft({ ...tenKmOut, speed: 70, verticalRate: -4 })
    expect(secondsToLanding(lhr, inbound)! / 60).toBeCloseTo(2.4, 0)
  })

  test('a departure took off at the average of lift-off and now', () => {
    // 10 km at an average of (75 + 125) / 2 = 100 m/s: about 100 s ago.
    const outbound = aircraft({ ...tenKmOut, speed: 125, verticalRate: 8 })
    expect(secondsSinceTakeOff(lhr, outbound)).toBeCloseTo(100, -1)
  })

  test('no estimate for something barely moving', () => {
    expect(secondsToLanding(lhr, aircraft({ speed: 5 }))).toBeNull()
    expect(secondsSinceTakeOff(lhr, aircraft({ speed: 5 }))).toBeNull()
  })
})

describe("a neighbouring airport's traffic", () => {
  const lgw = findAirport('EGKK')!
  const ams = findAirport('EHAM')!
  const via = (from: typeof lgw, to: typeof lgw) => ({
    airline: '',
    from,
    to,
  })

  test('a route ending at Gatwick takes an "arrival" off the Heathrow board', () => {
    expect(elsewhere(lhr, 'arr', [via(ams, lgw)])).toBe(true)
    // Starting at Gatwick: not a Heathrow departure either.
    expect(elsewhere(lhr, 'dep', [via(lgw, ams)])).toBe(true)
  })

  test('a route here, a far-away (likely stale) route, or none, keeps it', () => {
    expect(elsewhere(lhr, 'arr', [via(ams, lhr)])).toBe(false)
    expect(elsewhere(lhr, 'arr', [via(lhr, findAirport('KLGA')!)])).toBe(false)
    expect(elsewhere(lhr, 'arr', [])).toBe(false)
  })

  test('the board leaves it out', () => {
    const inbound = aircraft({
      callsign: 'EZY37BK',
      lng: lhr.lng + 0.29,
      track: 270,
      verticalRate: -4,
    })
    expect(board(lhr, [inbound], 100)).toHaveLength(1)
    expect(
      board(lhr, [inbound], 100, { EZY37BK: [via(ams, lgw)] }),
    ).toHaveLength(0)
  })
})

describe('taking off and landing on the airfield (UAL1111 at SFO)', () => {
  const sfo = findAirport('KSFO')!
  const lih = findAirport('PHLI')!
  // East of SFO's reference point, on runway 28: heading west, towards it.
  const onRunway28 = (overrides: Partial<Aircraft>) =>
    aircraft({
      callsign: 'UAL1111',
      lat: sfo.lat - 0.005,
      lng: sfo.lng + 0.02,
      track: 280,
      altitude: 30,
      speed: 80,
      ...overrides,
    })

  test('lifting off, level, with no route: left off rather than guessed', () => {
    expect(listedPhase(sfo, onRunway28({ verticalRate: 0 }), 100, {})).toBe(
      null,
    )
  })

  test('lifting off, level, with a route from here: departing', () => {
    const routes = { UAL1111: [{ airline: '', from: sfo, to: lih }] }
    expect(listedPhase(sfo, onRunway28({ verticalRate: 0 }), 100, routes)).toBe(
      'dep',
    )
  })

  test('climbing while still pointed at the middle of the field: departing', () => {
    expect(listedPhase(sfo, onRunway28({ verticalRate: 6 }), 100, {})).toBe(
      'dep',
    )
  })

  test('descending onto the runway: arriving, whatever the route says', () => {
    const stale = { UAL1111: [{ airline: '', from: sfo, to: lih }] }
    expect(listedPhase(sfo, onRunway28({ verticalRate: -3 }), 100, stale)).toBe(
      'arr',
    )
  })
})

describe('the board is ordered by time, not distance', () => {
  const east = (km: number) => lhr.lng + km / 69.4
  const west = (km: number) => lhr.lng - km / 69.4

  test('a faster arrival further out lands first', () => {
    // 10 km at 50 m/s: 200 s. 15 km at 120 m/s: 125 s.
    const slowNear = aircraft({
      icao24: 'slow',
      lng: east(10),
      track: 270,
      verticalRate: -3,
      speed: 50,
    })
    const fastFar = aircraft({
      icao24: 'fast',
      lng: east(15),
      track: 270,
      verticalRate: -3,
      speed: 120,
    })
    expect(
      board(lhr, [slowNear, fastFar], 100).map((e) => e.aircraft.icao24),
    ).toEqual(['fast', 'slow'])
  })

  test('the latest to take off comes first', () => {
    // 8 km at 75 m/s: about 107 s ago. 12 km at 200 m/s: about 87 s ago.
    const slowNear = aircraft({
      icao24: 'earlier',
      lng: west(8),
      track: 270,
      verticalRate: 8,
      speed: 75,
    })
    const fastFar = aircraft({
      icao24: 'latest',
      lng: west(12),
      track: 270,
      verticalRate: 8,
      speed: 200,
    })
    expect(
      board(lhr, [slowNear, fastFar], 100).map((e) => e.aircraft.icao24),
    ).toEqual(['latest', 'earlier'])
  })

  test('no time estimate sorts last', () => {
    const stalled = aircraft({
      icao24: 'stalled',
      lng: east(3),
      track: 270,
      verticalRate: -3,
      speed: 0,
    })
    const moving = aircraft({
      icao24: 'moving',
      lng: east(20),
      track: 270,
      verticalRate: -3,
      speed: 90,
    })
    expect(
      board(lhr, [stalled, moving], 100).map((e) => e.aircraft.icao24),
    ).toEqual(['moving', 'stalled'])
  })
})

describe('a flight with a stop here (SKW6274, LAX-SFO-LAX)', () => {
  const sfo = findAirport('KSFO')!
  const lax = findAirport('KLAX')!
  const legs = [
    { airline: '', from: lax, to: sfo },
    { airline: '', from: sfo, to: lax },
  ]

  test('an arrival is from the leg in, a departure to the leg out', () => {
    expect(routeLine(sfo, 'arr', legs)).toBe('From LAX Los Angeles')
    expect(routeLine(sfo, 'dep', legs)).toBe('To LAX Los Angeles')
  })

  test('a stop both ways does not settle an undecided aircraft', () => {
    const level = aircraft({
      callsign: 'SKW6274',
      lat: sfo.lat,
      lng: sfo.lng + 0.02,
      altitude: 30,
      verticalRate: 0,
    })
    expect(listedPhase(sfo, level, 100, { SKW6274: legs })).toBeNull()
  })
})

describe('private flights', () => {
  test('registrations stay off the board; airline callsigns are listed', () => {
    const inbound = (callsign: string) =>
      aircraft({
        callsign,
        icao24: callsign,
        lng: lhr.lng + 0.29,
        track: 270,
        verticalRate: -4,
      })
    const all = [inbound('BAW213'), inbound('N780SP'), inbound('GABCD')]
    expect(board(lhr, all, 100).map((e) => e.aircraft.callsign)).toEqual([
      'BAW213',
    ])
    // Unless the screen asks for them.
    expect(board(lhr, all, 100, {}, true)).toHaveLength(3)
  })
})
