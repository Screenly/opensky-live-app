import { describe, expect, test } from 'bun:test'

import { Formatter, resolveUnits, toKm, zoneAt, zoneName } from './format'

describe('Formatter', () => {
  const aviation = new Formatter('aviation', 'en')
  const metric = new Formatter('metric', 'en')

  test('aviation altitudes switch to flight levels above 18,000 ft', () => {
    expect(aviation.altitude(1524)).toEqual(['5,000', 'ft'])
    expect(aviation.altitude(11278)).toEqual(['FL370', ''])
    expect(aviation.altitude(100, true)).toEqual(['GND', ''])
    expect(aviation.altitude(null)).toEqual(['—', ''])
  })

  test('airborne but under 100 ft never reads 0 or negative', () => {
    expect(aviation.altitude(10)).toEqual(['<100', 'ft']) // short final
    expect(aviation.altitude(-30)).toEqual(['<100', 'ft']) // high pressure
    expect(aviation.altitude(31)).toEqual(['100', 'ft'])
    expect(metric.altitude(-30)).toEqual(['<30', 'm'])
    expect(metric.altitude(40)).toEqual(['40', 'm'])
    // On the ground is still GND, whatever the altitude says.
    expect(aviation.altitude(-30, true)).toEqual(['GND', ''])
  })

  test('speeds and distances follow the units', () => {
    expect(aviation.speed(250)).toEqual(['486', 'kt'])
    expect(metric.speed(250)).toEqual(['900', 'km/h'])
    expect(aviation.distance(185.2)).toEqual(['100', 'nm'])
    expect(metric.radius(100)).toBe('100 km')
  })

  test('climb is signed per minute', () => {
    expect(aviation.climb(5.08)).toEqual(['+1,000', 'ft/min'])
    expect(aviation.climb(-5.08)).toEqual(['−1,000', 'ft/min'])
    expect(aviation.climb(0)).toEqual(['0', 'ft/min'])
  })

  test('durations round to five minutes', () => {
    expect(aviation.duration(12000)).toBe('3 h 20 m')
    expect(aviation.duration(7200)).toBe('2 h')
    expect(aviation.duration(2700)).toBe('45 m')
    expect(aviation.duration(30)).toBe('5 m')
  })

  test('estimates are whole minutes, marked with ~', () => {
    expect(aviation.estimate(20)).toBe('~1 min')
    expect(aviation.estimate(300)).toBe('~5 min')
    expect(aviation.estimate(3600)).toBe('~1 h')
    expect(aviation.estimate(4200)).toBe('~1 h 10 min')
  })

  test('unknown or unset units fall back to metric', () => {
    expect(resolveUnits('furlongs')).toBe('metric')
    expect(resolveUnits('')).toBe('metric')
    expect(resolveUnits('aviation')).toBe('aviation')
  })

  test('range is in the chosen units', () => {
    expect(toKm(100, 'metric')).toBe(100)
    expect(toKm(100, 'aviation')).toBeCloseTo(185.2)
    expect(toKm(100, 'imperial')).toBeCloseTo(160.9, 1)
    // Read back on screen, it is the number that was chosen.
    expect(new Formatter('aviation', 'en').radius(toKm(100, 'aviation'))).toBe(
      '100 nm',
    )
  })
})

describe('times with their timezone', () => {
  // 20 October 2026, 19:59 UTC: summer time still on in the US and UK.
  const at = new Date(Date.UTC(2026, 9, 20, 19, 59))

  test('a place gives its timezone', () => {
    expect(zoneAt(21.318, -157.92)).toBe('Pacific/Honolulu')
    expect(zoneAt(9.93, 76.27)).toBe('Asia/Kolkata')
  })

  test('zones get their everyday abbreviation, else their offset', () => {
    expect(zoneName(at, 'America/Los_Angeles')).toBe('PDT')
    expect(zoneName(at, 'Pacific/Honolulu')).toBe('HST')
    expect(zoneName(at, 'Europe/London')).toBe('BST')
    expect(zoneName(at, 'Asia/Kolkata')).toBe('IST')
    expect(zoneName(at, 'Indian/Maldives')).toBe('GMT+5')
    expect(zoneName(at, 'Europe/Dublin')).toBe('IST')
  })

  test('no offset is plain GMT', () => {
    const winter = new Date(Date.UTC(2026, 0, 15, 12))
    expect(zoneName(winter, 'Europe/Dublin')).toBe('GMT')
    // A screen set to UTC is named so.
    expect(zoneName(winter, 'UTC')).toBe('UTC')
  })

  test("a clock time is in the screen's zone, or another one given", () => {
    const screen = new Formatter('aviation', 'en-US', 'America/Los_Angeles')
    expect(screen.clock(at)).toBe('12:59 PM PDT')
    expect(screen.clock(at, 'Pacific/Honolulu')).toBe('09:59 AM HST')
  })
})
