/* eslint-disable no-undef -- Node build script; the shared config sets browser globals only. */
// Regenerates src/airports.json and src/airlines.json. Run by hand when the
// tables need refreshing; the output is committed so builds stay offline.
//
//   node scripts/generate-reference-data.mjs
//
// Airports come from OurAirports (public domain): large and medium airports
// with scheduled service and an ICAO code. That is what an operator will type
// into the airport setting, and it keeps the table to a size worth inlining.
//
// Airlines come from OpenFlights (ODbL): the IATA → ICAO designator pairs, so
// a flight number typed as "BA283" can be searched for as the callsign
// "BAW283", which is what aircraft actually transmit.

import fs from 'fs'

const AIRPORTS_URL =
  'https://davidmegginson.github.io/ourairports-data/airports.csv'
const AIRLINES_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat'

/** A minimal RFC 4180 reader: quoted fields, doubled quotes, commas inside. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response.text()
}

async function airports() {
  const [header, ...rows] = parseCsv(await download(AIRPORTS_URL))
  const col = (name) => header.indexOf(name)
  const kept = {}
  for (const row of rows) {
    const type = row[col('type')]
    const icao = (row[col('icao_code')] || row[col('gps_code')] || '').trim()
    if (type !== 'large_airport' && type !== 'medium_airport') continue
    if (row[col('scheduled_service')] !== 'yes') continue
    if (!/^[A-Z]{4}$/.test(icao)) continue
    // [IATA, name, city, lat, lng] — rounded to ~100 m, plenty for a map.
    kept[icao] = [
      row[col('iata_code')] || '',
      row[col('name')],
      row[col('municipality')] || '',
      Number(Number(row[col('latitude_deg')]).toFixed(3)),
      Number(Number(row[col('longitude_deg')]).toFixed(3)),
    ]
  }
  return kept
}

async function airlines() {
  const kept = {}
  for (const row of parseCsv(await download(AIRLINES_URL))) {
    const [, , , iata, icao, , , active] = row
    if (!/^[A-Z0-9]{2}$/.test(iata ?? '')) continue
    if (!/^[A-Z]{3}$/.test(icao ?? '')) continue
    // Several airlines can share an IATA code over time. Active ones go first,
    // so the likeliest callsign is searched for first.
    const list = (kept[iata] ??= [])
    if (list.includes(icao)) continue
    if (active === 'Y') list.unshift(icao)
    else list.push(icao)
  }
  return kept
}

const [airportTable, airlineTable] = await Promise.all([airports(), airlines()])
fs.writeFileSync('src/airports.json', JSON.stringify(airportTable))
fs.writeFileSync('src/airlines.json', JSON.stringify(airlineTable))
console.log(
  `reference data: ${Object.keys(airportTable).length} airports, ${Object.keys(airlineTable).length} airline codes`,
)
