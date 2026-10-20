import { getSettingWithDefault } from '@screenly/edge-apps'

import type { Plan } from './data'
import type { NoticeContent } from './notice'
import { findAirport, parseFlightQuery } from './lookup'
import { placeLabel, resolvePosition } from './place'

/** Works out what to watch, or says on screen what is missing. */
export async function resolvePlan(
  say: (id: string, text: string) => void,
  notice: (content: NoticeContent) => void,
): Promise<Plan | null> {
  const mode = getSettingWithDefault<string>('mode', 'area')

  if (mode === 'airport') {
    const code = getSettingWithDefault<string>('airport', '').trim()
    const airport = findAirport(code)
    say('brand-title', 'Airport traffic')
    if (!airport) {
      notice({
        tone: 'error',
        label: 'Airport traffic',
        title: code ? 'Airport not found' : 'No airport set',
        detail: code
          ? `"${code}" isn't one of the 3,000 airports with scheduled service this app knows. Use the IATA or ICAO code, such as LHR or EGLL.`
          : 'Choose the airport to watch with its IATA or ICAO code, such as LHR or EGLL.',
        fix: 'Settings › Airport',
        typed: code,
      })
      return null
    }
    say('brand-sub', airport.iata || airport.icao)
    return { mode: 'airport', airport }
  }

  if (mode === 'flight') {
    const typed = getSettingWithDefault<string>('flight_number', '').trim()
    const query = parseFlightQuery(typed)
    say('brand-title', 'Flight tracker')
    if (!query) {
      notice({
        tone: 'error',
        label: 'Flight tracker',
        title: typed ? 'Not a flight number' : 'No flight set',
        detail:
          'Enter a flight number such as BA283, a callsign such as BAW283, or a six-character ICAO24 address such as 4ca7b5.',
        fix: 'Settings › Flight Number',
        typed,
      })
      return null
    }
    say('brand-sub', query.label)
    return { mode: 'flight', query }
  }

  say('brand-title', 'Live flights')
  const position = resolvePosition()
  if (!position) {
    const override = getSettingWithDefault<string>(
      'override_coordinates',
      '',
    ).trim()
    notice({
      tone: 'error',
      label: 'Live flights',
      title: override ? 'Coordinates not understood' : 'No location set',
      detail: override
        ? 'Enter a latitude and longitude separated by a comma, such as 51.4700,-0.4543.'
        : 'This screen has no location yet. Set one for the screen in Screenly, or give this app coordinates, and the sky above it will follow.',
      fix: 'Settings › Override Coordinates',
      typed: override,
    })
    return null
  }
  const name = await placeLabel(position)
  say('brand-sub', name)
  return { mode: 'area', lat: position.lat, lng: position.lng, name }
}
