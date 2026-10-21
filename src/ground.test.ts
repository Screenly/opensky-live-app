import { describe, expect, test } from 'bun:test'

import { groupSpots, hiddenOnGround, SHOWN_PER_SPOT } from './ground'

describe('thinning ground icons', () => {
  test('a pile on an apron shows just two', () => {
    const apron = [0, 4, 8, 12, 6].map((d, i) => ({ id: `a${i}`, x: d, y: d }))
    const hidden = hiddenOnGround(apron, 20)
    expect(SHOWN_PER_SPOT).toBe(2)
    expect(hidden.size).toBe(3)
    // The first two of the spot are the ones kept.
    expect(hidden.has('a0')).toBe(false)
    expect(hidden.has('a1')).toBe(false)
  })

  test('two overlapping, and lone aircraft, are all shown', () => {
    const spots = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 0 },
      { id: 'far', x: 300, y: 300 },
    ]
    expect(groupSpots(spots, 20).map((g) => g.ids)).toEqual([
      ['a', 'b'],
      ['far'],
    ])
    expect(hiddenOnGround(spots, 20).size).toBe(0)
  })

  test('each spot keeps its own two', () => {
    const spot = (prefix: string, x: number) =>
      [0, 3, 6, 9].map((d) => ({ id: `${prefix}${d}`, x: x + d, y: 0 }))
    const hidden = hiddenOnGround([...spot('lhr', 0), ...spot('lgw', 500)], 20)
    expect(hidden.size).toBe(4) // two hidden at each of the two spots
  })
})
