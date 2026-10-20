import { describe, expect, test } from 'bun:test'

import { parseStates } from './states'

/** A state-vector row in OpenSky's index order, with only what a test sets. */
function row(fields: Record<number, unknown>): unknown[] {
  const values: unknown[] = Array(18).fill(null)
  values[8] = false
  for (const [index, value] of Object.entries(fields)) {
    values[Number(index)] = value
  }
  return values
}

describe('parseStates', () => {
  test('reads state vectors and drops rows with no position', () => {
    const snapshot = parseStates({
      time: 1792482207,
      states: [
        row({ 0: 'a3689e', 1: 'DAL2635 ', 3: 1792482194, 5: -122.38 }),
        row({ 0: 'a841f5', 1: 'FDX1800 ', 5: -122.2, 6: 37.7, 7: 3000 }),
        row({ 0: 'b00000', 8: true, 5: -122.38, 6: 37.61, 14: '6641' }),
      ],
    })
    expect(snapshot.time).toBe(1792482207)
    expect(snapshot.aircraft.map((a) => a.icao24)).toEqual(['a841f5', 'b00000'])
    expect(snapshot.aircraft[0]).toMatchObject({
      callsign: 'FDX1800',
      altitude: 3000,
      onGround: false,
      seen: 1792482207,
    })
    expect(snapshot.aircraft[1]).toMatchObject({
      callsign: '',
      onGround: true,
      squawk: '6641',
    })
  })

  test('falls back to geometric altitude', () => {
    const { aircraft } = parseStates({
      time: 1,
      states: [row({ 0: 'a', 5: 1, 6: 1, 13: 4200 })],
    })
    expect(aircraft[0]?.altitude).toBe(4200)
  })

  test('an empty box comes back as states: null', () => {
    expect(parseStates({ time: 1, states: null }).aircraft).toEqual([])
  })

  test('rejects something that is not a states response', () => {
    expect(() => parseStates('<html>')).toThrow()
    expect(() => parseStates({ states: [] })).toThrow()
  })
})
