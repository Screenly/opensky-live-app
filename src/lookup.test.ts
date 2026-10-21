import { describe, expect, test } from 'bun:test'

import {
  findAirport,
  isPublicCallsign,
  privateJetLine,
  privateJetOperator,
  parseFlightQuery,
  shortAirportName,
} from './lookup'

describe('findAirport', () => {
  test('finds by ICAO and IATA, in any case', () => {
    expect(findAirport('EGLL')?.iata).toBe('LHR')
    expect(findAirport('lhr')?.icao).toBe('EGLL')
    expect(findAirport(' sfo ')?.icao).toBe('KSFO')
  })

  test('returns null for unknown or blank codes', () => {
    expect(findAirport('')).toBeNull()
    expect(findAirport('ZZZ')).toBeNull()
    expect(findAirport('LHRX')).toBeNull()
  })

  test('shortens the name for the heading', () => {
    expect(shortAirportName(findAirport('LHR')!)).toBe('London Heathrow')
  })
})

describe('parseFlightQuery', () => {
  test('translates IATA flight numbers to ICAO callsigns', () => {
    expect(parseFlightQuery('BA283')).toEqual({
      kind: 'callsign',
      callsigns: ['BAW283'],
      label: 'BA283',
    })
  })

  test('drops leading zeros and tolerates spaces', () => {
    const query = parseFlightQuery('ba 0283')
    expect(query?.kind === 'callsign' && query.callsigns).toEqual(['BAW283'])
  })

  test('keeps ICAO callsigns as typed', () => {
    expect(parseFlightQuery('UAL90')).toEqual({
      kind: 'callsign',
      callsigns: ['UAL90'],
      label: 'UAL90',
    })
  })

  test('reads a hex transponder address as icao24', () => {
    expect(parseFlightQuery('4CA7B5')).toEqual({
      kind: 'icao24',
      icao24: '4ca7b5',
      label: '4CA7B5',
    })
  })

  test('rejects nonsense', () => {
    expect(parseFlightQuery('')).toBeNull()
    expect(parseFlightQuery('not a flight')).toBeNull()
  })
})

describe('isPublicCallsign', () => {
  test('airline, charter and cargo callsigns are public', () => {
    for (const c of ['UAL1050', 'SKW425X', 'EZY37BK', 'MXY812', 'FDX1800']) {
      expect(isPublicCallsign(c)).toBe(true)
    }
  })

  test('registrations, and no callsign, are private', () => {
    for (const c of ['N780SP', 'N25JX', 'OEELK', 'GABCD', '']) {
      expect(isPublicCallsign(c)).toBe(false)
    }
  })
})

describe('private jets', () => {
  test('business-jet operators are named and labelled', () => {
    expect(privateJetOperator('EJA888')).toBe('NetJets')
    expect(privateJetOperator('LXJ431')).toBe('Flexjet')
    expect(privateJetLine({ callsign: 'EJA888' })).toBe('Private jet · NetJets')
  })

  test('airlines and registrations are not', () => {
    expect(privateJetOperator('UAL1050')).toBeNull()
    expect(privateJetOperator('EXS123')).toBeNull() // Jet2, an airline
    // A registration is private, but its owner is never named.
    expect(privateJetOperator('N780SP')).toBeNull()
    expect(privateJetLine({ callsign: 'UAL1050' })).toBeUndefined()
  })
})
