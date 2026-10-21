import type { Motion } from './traffic'

/*
  Colour means what an aircraft is doing, everywhere on the screen: the list
  icons, the map, the board's section keys and the legend all use the same
  four, and a word and arrow always say it too, so colour is never the only
  cue.
*/
const LEGEND: Record<'airport' | 'sky', Record<Motion, string>> = {
  airport: {
    arr: '↘ Arriving',
    dep: '↗ Departing',
    pass: '→ Passing',
    gnd: 'Ground',
  },
  sky: {
    arr: '↘ Descending',
    dep: '↗ Climbing',
    pass: '→ Level',
    gnd: 'Ground',
  },
}

/** The colour legend: arriving/departing at an airport, else by vertical speed. */
export function legend(atAirport: boolean): void {
  const labels = LEGEND[atAirport ? 'airport' : 'sky']
  for (const motion of Object.keys(labels) as Motion[]) {
    document.getElementById(`band-${motion}`)!.textContent = labels[motion]
  }
}
