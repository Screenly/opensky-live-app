import { FIXED_SCREENSHOT_DATE } from '@screenly/edge-apps/test/screenshots'

const NOW = Math.floor(FIXED_SCREENSHOT_DATE.getTime() / 1000)

/**
 * [icao24, callsign, country, lat, lng, altitude m, on ground, speed m/s,
 * track °, vertical m/s]. Traffic around the Bay Area, frozen against the
 * screenshot clock so every resolution shows the same sky.
 */
type Plane = [
  string,
  string,
  string,
  number,
  number,
  number | null,
  boolean,
  number,
  number,
  number,
]

const BAY_AREA: Plane[] = [
  // Arriving SFO from the south-east and the east.
  [
    'a1b2c3',
    'UAL1532',
    'United States',
    37.5,
    -122.18,
    1450,
    false,
    82,
    305,
    -4,
  ],
  [
    'a2b3c4',
    'ASA312',
    'United States',
    37.42,
    -121.98,
    2300,
    false,
    108,
    300,
    -5,
  ],
  [
    'a3c4d5',
    'DAL2635',
    'United States',
    37.66,
    -122.0,
    3300,
    false,
    125,
    255,
    -6,
  ],
  // Departing SFO to the north-west and south.
  [
    'a4d5e6',
    'SWA1554',
    'United States',
    37.71,
    -122.5,
    1600,
    false,
    95,
    300,
    9,
  ],
  [
    'a5e6f7',
    'BAW286',
    'United Kingdom',
    37.82,
    -122.62,
    3500,
    false,
    140,
    320,
    11,
  ],
  // Overflying, high.
  [
    'a6f708',
    'UAE226',
    'United Arab Emirates',
    37.2,
    -122.3,
    11300,
    false,
    245,
    20,
    0,
  ],
  [
    'a70819',
    'AAL2158',
    'United States',
    37.9,
    -121.7,
    10650,
    false,
    236,
    115,
    0,
  ],
  [
    'a8192a',
    'JBU915',
    'United States',
    37.0,
    -121.8,
    9800,
    false,
    230,
    140,
    -1,
  ],
  // Mid-level, around San Jose and Oakland.
  [
    'a92a3b',
    'SKW5102',
    'United States',
    37.33,
    -121.85,
    4200,
    false,
    150,
    160,
    7,
  ],
  [
    'aa3b4c',
    'FDX1800',
    'United States',
    37.78,
    -122.15,
    5600,
    false,
    170,
    75,
    8,
  ],
  [
    'ab4c5d',
    'NKS1720',
    'United States',
    38.1,
    -122.25,
    7300,
    false,
    200,
    200,
    -7,
  ],
  ['ac5d6e', 'N428CL', 'United States', 37.55, -122.55, 900, false, 55, 180, 0],
  // On the ground at SFO.
  [
    'ad6e7f',
    'UAL837',
    'United States',
    37.616,
    -122.383,
    null,
    true,
    6,
    280,
    0,
  ],
  ['ae7f80', 'CPA873', 'Hong Kong', 37.613, -122.392, null, true, 0, 10, 0],
  ['af8091', 'QFA74', 'Australia', 37.618, -122.389, null, true, 4, 100, 0],
]

/** A transatlantic flight over Ireland, and its company in the tracks. */
const ATLANTIC: Plane[] = [
  ['4ca7b5', 'EIN105', 'Ireland', 53.2, -11.4, 11280, false, 245, 92, -0.3],
  ['400f01', 'BAW178', 'United Kingdom', 53.6, -12.6, 10970, false, 250, 95, 0],
  ['3c6589', 'DLH401', 'Germany', 52.7, -12.1, 11580, false, 248, 88, 0],
  ['a0f1c2', 'UAL90', 'United States', 53.0, -13.4, 11890, false, 252, 96, 0],
  ['4b1814', 'SWR17', 'Switzerland', 52.4, -10.6, 10360, false, 240, 98, -2],
]

function row(plane: Plane): unknown[] {
  const [icao24, callsign, country, lat, lng, altitude, onGround] = plane
  const [, , , , , , , speed, track, vertical] = plane
  return [
    icao24,
    callsign.padEnd(8),
    country,
    NOW - 3,
    NOW - 1,
    lng,
    lat,
    altitude,
    onGround,
    speed,
    track,
    vertical,
    null,
    altitude === null ? null : altitude + 60,
    onGround ? null : '1200',
    false,
    0,
  ]
}

export function statesBody(url: string): string {
  const params = new URL(url.slice(url.indexOf('https://'))).searchParams
  const planes = params.has('lamin')
    ? [...BAY_AREA, ...ATLANTIC].filter(
        ([, , , lat, lng]) =>
          lat >= Number(params.get('lamin')) &&
          lat <= Number(params.get('lamax')) &&
          lng >= Number(params.get('lomin')) &&
          lng <= Number(params.get('lomax')),
      )
    : [...BAY_AREA, ...ATLANTIC]
  return JSON.stringify({ time: NOW, states: planes.map(row) })
}

/** EIN105's path so far: out of New York, across the Atlantic. */
export function trackBody(): string {
  const path: number[][] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    path.push([
      NOW - (24 - i) * 600,
      40.64 + (53.2 - 40.64) * t + Math.sin(t * Math.PI) * 4,
      -73.78 + (-11.4 + 73.78) * t,
      11000,
      70,
      0,
    ])
  }
  return JSON.stringify({ icao24: '4ca7b5', callsign: 'EIN105', path })
}

type Place = [
  iata: string,
  icao: string,
  city: string,
  lat: number,
  lng: number,
]

const PLACES: Record<string, Place> = {
  SFO: ['SFO', 'KSFO', 'San Francisco', 37.619, -122.375],
  LAX: ['LAX', 'KLAX', 'Los Angeles', 33.942, -118.408],
  SEA: ['SEA', 'KSEA', 'Seattle', 47.449, -122.309],
  LAS: ['LAS', 'KLAS', 'Las Vegas', 36.08, -115.152],
  LHR: ['LHR', 'EGLL', 'London', 51.47, -0.454],
  JFK: ['JFK', 'KJFK', 'New York', 40.64, -73.779],
  DUB: ['DUB', 'EIDW', 'Dublin', 53.421, -6.27],
  MLE: ['MLE', 'VRMM', 'Malé', 4.192, 73.529],
  DEL: ['DEL', 'VIDP', 'Delhi', 28.567, 77.103],
}

/**
 * Routes as adsbdb would give them, by callsign. AIC264 is not in the air in
 * the mocked sky, so it shows the "not in the air" notice with its route.
 * DAL2635 is left unknown, so the SFO board shows a row falling back to the
 * country.
 */
const ROUTES: Record<string, [string, string, string]> = {
  EIN105: ['Aer Lingus', 'JFK', 'DUB'],
  AIC264: ['Air India', 'MLE', 'DEL'],
  UAL1532: ['United Airlines', 'LAX', 'SFO'],
  ASA312: ['Alaska Airlines', 'SEA', 'SFO'],
  SWA1554: ['Southwest Airlines', 'SFO', 'LAS'],
  BAW286: ['British Airways', 'SFO', 'LHR'],
}

function place([iata, icao, city, lat, lng]: Place) {
  return {
    iata_code: iata,
    icao_code: icao,
    municipality: city,
    name: `${city} Airport`,
    latitude: lat,
    longitude: lng,
  }
}

export function routeBody(url: string): string {
  const callsign = url.slice(url.lastIndexOf('/') + 1)
  const known = ROUTES[callsign]
  if (!known) return JSON.stringify({ response: 'unknown callsign' })
  const [airline, from, to] = known
  return JSON.stringify({
    response: {
      flightroute: {
        callsign,
        airline: { name: airline },
        origin: place(PLACES[from]!),
        destination: place(PLACES[to]!),
      },
    },
  })
}
