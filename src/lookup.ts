import airportTable from './airports.json'
import airlineTable from './airlines.json'

/** [IATA, name, city, lat, lng], keyed by ICAO. See scripts/generate-reference-data.mjs. */
type AirportRow = [string, string, string, number, number]

export interface Airport {
  icao: string
  iata: string
  name: string
  city: string
  lat: number
  lng: number
}

const AIRPORTS = airportTable as unknown as Record<string, AirportRow>
const AIRLINES = airlineTable as Record<string, string[]>

function toAirport(icao: string, row: AirportRow): Airport {
  const [iata, name, city, lat, lng] = row
  return { icao, iata, name, city, lat, lng }
}

/** An airport by its ICAO (EGLL) or IATA (LHR) code, or null if unknown. */
export function findAirport(code: string): Airport | null {
  const wanted = code.trim().toUpperCase()
  if (!wanted) return null
  const byIcao = AIRPORTS[wanted]
  if (byIcao) return toAirport(wanted, byIcao)
  if (wanted.length !== 3) return null
  for (const [icao, row] of Object.entries(AIRPORTS)) {
    if (row[0] === wanted) return toAirport(icao, row)
  }
  return null
}

/** A shorter name for a heading: "London Heathrow" rather than "London Heathrow Airport". */
export function shortAirportName(airport: Airport): string {
  return (
    airport.name
      .replace(/\s+(International\s+)?Airport$/i, '')
      .replace(/\s+International$/i, '')
      .trim() || airport.name
  )
}

export type FlightQuery =
  | { kind: 'icao24'; icao24: string; label: string }
  | { kind: 'callsign'; callsigns: string[]; label: string }

/**
 * What an operator typed into the flight setting, turned into what OpenSky
 * can be asked for. Aircraft transmit ICAO callsigns (BAW283), while tickets
 * carry IATA flight numbers (BA283), so the latter are translated through the
 * airline table. A six-character hex string that reads as neither is taken as
 * a transponder address.
 */
export function parseFlightQuery(input: string): FlightQuery | null {
  const compact = input.replace(/[\s-]/g, '').toUpperCase()
  if (!compact) return null

  // ICAO form: three letters, then a flight designator of 1–4 characters.
  if (/^[A-Z]{3}[0-9][0-9A-Z]{0,3}$/.test(compact)) {
    return { kind: 'callsign', callsigns: [compact], label: compact }
  }

  const iata = iataCallsigns(compact)
  if (iata.length > 0) {
    return { kind: 'callsign', callsigns: iata, label: compact }
  }

  if (/^[0-9A-F]{6}$/.test(compact)) {
    return { kind: 'icao24', icao24: compact.toLowerCase(), label: compact }
  }

  // Anything else (a registration-style or private callsign) is searched as-is.
  if (/^[A-Z0-9]{2,8}$/.test(compact)) {
    return { kind: 'callsign', callsigns: [compact], label: compact }
  }
  return null
}

/**
 * IATA flight numbers (two-character airline code, then 1–4 digits and an
 * optional suffix letter) as the ICAO callsigns the aircraft will be using.
 * Leading zeros are dropped: BA0283 flies as BAW283.
 */
function iataCallsigns(compact: string): string[] {
  const match = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(compact)
  if (!match) return []
  const [, airline, number] = match
  const designators = AIRLINES[airline!] ?? []
  const trimmed = number!.replace(/^0+(?=\d)/, '')
  return designators.map((icao) => `${icao}${trimmed}`)
}

/**
 * Is this a public flight's callsign? Airlines (and charter and cargo
 * operators) fly under a three-letter code and a number: UAL1050, SKW425X,
 * EZY37BK. Private aircraft fly under their registration — N780SP, OEELK —
 * which identifies the owner, and those are kept off public lists. The shape
 * is the test, not a table of airline codes: the bundled table is missing
 * real airlines (Breeze, JSX), and a stale table would hide their flights.
 */
export function isPublicCallsign(callsign: string): boolean {
  return /^[A-Z]{3}\d[0-9A-Z]{0,3}$/.test(callsign.trim().toUpperCase())
}

/**
 * Business-jet operators — fractional ownership and private charter — by the
 * three-letter code their flights use, each confirmed against adsbdb. Their
 * flights are private jets: no published route, and the passengers' own
 * plans. The operator is a company and named; owners are never looked up.
 */
const PRIVATE_JET_OPERATORS: Record<string, string> = {
  EJA: 'NetJets',
  NJE: 'NetJets Europe',
  LXJ: 'Flexjet',
  VJT: 'VistaJet',
  XOJ: 'XOJET',
  GAJ: 'Gama Aviation',
  JRE: 'flyExclusive',
}

/** The business-jet operator flying this callsign, or null if it is not one. */
export function privateJetOperator(callsign: string): string | null {
  const c = callsign.trim().toUpperCase()
  if (!isPublicCallsign(c)) return null
  return PRIVATE_JET_OPERATORS[c.slice(0, 3)] ?? null
}

/** A list's line under a private jet's callsign: "Private jet · NetJets". */
export function privateJetLine(aircraft: {
  callsign: string
}): string | undefined {
  const operator = privateJetOperator(aircraft.callsign)
  return operator ? `Private jet · ${operator}` : undefined
}
