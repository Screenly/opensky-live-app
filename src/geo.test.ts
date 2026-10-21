import { describe, expect, test } from 'bun:test'

import {
  bearing,
  boxAround,
  compass,
  deadReckon,
  kmBetween,
  nearLongitude,
} from './geo'

describe('geo', () => {
  test('London to Paris is about 344 km', () => {
    expect(kmBetween(51.5074, -0.1278, 48.8566, 2.3522)).toBeCloseTo(344, -1)
  })

  test('bearings and compass points', () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(0)
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(90)
    expect(compass(0)).toBe('N')
    expect(compass(359)).toBe('N')
    expect(compass(225)).toBe('SW')
  })

  test('longitudes are brought next to the reference', () => {
    expect(nearLongitude(-179, 179)).toBe(181)
    expect(nearLongitude(179, -179)).toBe(-181)
    expect(nearLongitude(10, 0)).toBe(10)
  })

  test('dead reckoning moves along the track', () => {
    // 250 m/s due east for 400 s is 100 km.
    const moved = deadReckon(0, 0, 250, 90, 400)
    expect(moved.lat).toBeCloseTo(0)
    expect(kmBetween(0, 0, moved.lat, moved.lng)).toBeCloseTo(100, 0)
  })

  test('a 100 km box stays inside one credit (25 square degrees)', () => {
    const { lamin, lamax, lomin, lomax } = boxAround(51.47, -0.46, 100)
    expect((lamax - lamin) * (lomax - lomin)).toBeLessThan(25)
  })
})
