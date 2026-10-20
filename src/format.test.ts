import { describe, expect, test } from 'bun:test'

import { Formatter, resolveUnits } from './format'

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

  test('unknown units fall back to aviation', () => {
    expect(resolveUnits('furlongs')).toBe('aviation')
    expect(resolveUnits('metric')).toBe('metric')
  })
})
