[![Version](https://img.shields.io/github/v/release/Screenly/opensky-live-app)](https://github.com/Screenly/opensky-live-app/releases/latest)

# OpenSky Live — Screenly Edge App

![The sky around the screen, with the closest aircraft listed](screenshots/opensky-flight-map-1920x1080.webp)

Live air traffic from [The OpenSky Network](https://opensky-network.org/),
drawn on a full-bleed map with the numbers in glass panels. Three modes, chosen
with the **What to Show** setting:

| Mode                   | Setting values                  | Shows                                                                                                                                         |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Around this screen** | `mode: area`, `radius_km`       | Every aircraft within the radius, the closest listed, highest / fastest / closest.                                                            |
| **Airport**            | `mode: airport`, `airport`      | Arriving, departing and on-ground counts, and the inbound and outbound traffic.                                                               |
| **Flight**             | `mode: flight`, `flight_number` | One flight followed across the map: From → To (e.g. MLE Malé → DEL Delhi), progress, estimated arrival, flown path, altitude, speed, heading. |

![Airport mode at SFO](screenshots/opensky-flight-map-airport-1920x1080.webp)
![Flight mode following EI105 over Ireland](screenshots/opensky-flight-map-flight-1920x1080.webp)

Every aircraft is coloured by altitude band (ground, below FL100, FL100–300,
above FL300) and drawn pointing along its track. Between refreshes each one
keeps moving along its last known course and speed, so the map is alive even
though OpenSky is only asked every few minutes.

## Settings

- **Airport** takes an IATA or ICAO code (`LHR` or `EGLL`). The ~3,000 large
  and medium airports with scheduled service are bundled, so there is no lookup
  call.
- **Flight Number** takes what is printed on a ticket (`BA283`), an ICAO
  callsign (`BAW283`) or a 6-character ICAO24 transponder address (`4ca7b5`).
  Aircraft transmit ICAO callsigns, so IATA flight numbers are translated
  through a bundled airline table (`BA` → `BAW`). Some airlines fly under
  alphanumeric callsigns that differ from the flight number (`BAW25M`); for
  those, enter the callsign itself.
- **Units**: aviation (ft / flight levels, kt, nm), metric or imperial.
- **Theme** (advanced): dark (radar, purple `#972eff` accent) or light
  (paper, deep purple `#6d28d9` accent). The accents are fixed per theme.
- **OpenSky Client ID / Secret** (optional): an API client from the OpenSky
  account page. See _Credits and refresh_ below.
- **Override Coordinates**: centres _Around this screen_ somewhere other than
  the player's own position, and is used for the "From this screen" distance in
  flight mode.

## Where airport traffic is coming from and going to

On the airport board, the line under each callsign says where that flight is
from or going: **From MLE Malé** for an arrival, **To DEL Delhi** for a
departure. Routes come from the same [adsbdb](https://www.adsbdb.com/) lookup
as flight mode.

- A route is shown only if it really ends at this airport (for an arrival) or
  starts here (for a departure). A callsign's usual route that doesn't touch
  this airport is the wrong route for this trip, so the row shows the
  aircraft's country instead — as it also does for private, military and
  other callsigns adsbdb doesn't know.
- Each callsign is looked up once and remembered on the screen for three
  days (twelve hours if unknown). At most eight new lookups are made per
  refresh, four at a time, for the rows nearest the top of the board.
- City names are adsbdb's: Goa's airport, for example, is listed under its
  town, Vasco da Gama.

## Route and estimated arrival (flight mode)

OpenSky has positions but no schedules, so the route comes from
[adsbdb](https://www.adsbdb.com/) (free, no key): the route an airline usually
flies under that callsign. It is looked up once per callsign and cached.

- The panel shows the two airports (`AMD Ahmedabad → PNQ Pune`), a progress
  bar, the estimated arrival time and the distance to go. The map pins both
  airports and draws the remaining leg; when the destination is close enough,
  the view is framed to hold both the aircraft and the airport.
- The estimate is the straight-line distance to go at the current ground
  speed. It ignores the descent and routing, so it is labelled "Est." and is
  not a scheduled time.
- A flight that is not in the air still shows its route ("MLE Malé → DEL
  Delhi · Not in the air right now"), with the map behind it centred on the
  route. OpenSky has no position either before departure or after landing and
  cannot say which, so the wording does not guess. There are no scheduled
  times: that would need a paid schedule API.
- A callsign is sometimes reused for a different leg. If the aircraft is not
  roughly between the two airports, the route is treated as wrong and hidden.
- If adsbdb doesn't know the callsign (private flights, some airlines) or
  can't be reached, the panel shows the squawk and distance from this screen
  instead, as before.

## When something is wrong

A setting the app can't use gets a full-screen notice instead of an empty
map: a warning mark, what is wrong in plain words, and a **How to fix** hint
naming the exact setting and quoting what was typed.

| Situation                    | Notice                                                       |
| ---------------------------- | ------------------------------------------------------------ |
| Unknown airport code         | Airport not found · Settings › Airport "XYZQ"                |
| Airport mode with no airport | No airport set · Settings › Airport                          |
| Unreadable flight number     | Not a flight number · Settings › Flight Number "hello!"      |
| Flight mode with no flight   | No flight set · Settings › Flight Number                     |
| No screen location           | No location set · Settings › Override Coordinates            |
| Bad override coordinates     | Coordinates not understood · Settings › Override Coordinates |
| Start-up fault               | Something went wrong (reported to Sentry when configured)    |

OpenSky being down with nothing cached is not shown at all: the app doesn't
signal ready, so the player keeps its previous content (see _Ready signal_).

A flight that is simply not in the air is not an error: it gets the aircraft
mark, its route and the next check time.

![Airport not found](screenshots/opensky-flight-map-error-airport-1920x1080.webp)

## Ready signal

`ready_signal: true` is set in the manifest, per the Edge Apps standard, so
the player keeps the app hidden until `screenly.signalReadyForRendering()` is
called. `src/ready.ts` follows the 8-bit fireplace's pattern:

- **Synchronously, right after drawing.** No wait for an animation frame:
  frames don't run while the player hides the app, and it stays hidden until
  it signals, so that wait would time out on Pi / Player Max and the asset
  would be skipped.
- **Only when there is something worth showing:**

  | Situation                                                | Signal                          |
  | -------------------------------------------------------- | ------------------------------- |
  | Positions drawn, live or from the last good reading      | Yes                             |
  | A followed flight that OpenSky reports is not in the air | Yes                             |
  | A setting to fix (airport, flight number, credentials)   | Yes, so an operator sees it     |
  | Start-up crash                                           | Yes, so the player is not held  |
  | Still connecting                                         | **No** — no "connecting" screen |
  | OpenSky down and nothing cached yet                      | **No** — retried every 30 s     |

  Without a signal the player keeps showing what came before and moves on;
  once OpenSky answers, the next showing has data. (A cached reading is shown,
  marked stale, rather than nothing.)

- **Once.** Later calls do nothing.

The trail and route lookups in flight mode run in parallel, so the first
screen — and its signal — comes as soon as possible.

`e2e/ready.spec.ts` checks each row above, including a run where animation
frames never fire and one where OpenSky comes back after an outage.

## OpenSky credentials (optional)

Without credentials the app uses OpenSky anonymously: 400 credits a day,
counted per internet address, so **every screen on the same network shares
them**. A free OpenSky account with an API client raises that to 4,000 a day,
counted per account.

1. Create a free account at [opensky-network.org](https://opensky-network.org/)
   and log in.
2. Open your [Account page](https://opensky-network.org/my-opensky/account) and
   create an **API client**. OpenSky shows its `client_id` and
   `client_secret`.
3. In Screenly, open this app's settings, show the **Advanced** settings, and
   paste the `client_id` into **OpenSky Client ID** and the `client_secret`
   into **OpenSky Client Secret** (stored as a secret).

That is all. With both filled in, the app signs in (OAuth2 client
credentials), sends the 30-minute token with every OpenSky request and renews
it as needed. The status line at the bottom says which mode it is in:
`Updated 12:04 · OpenSky, signed in` or `· OpenSky, anonymous`.

| Situation                        | What the screen does                                    |
| -------------------------------- | ------------------------------------------------------- |
| Both blank                       | Anonymous access, 5-minute refresh                      |
| Both filled in, accepted         | Signed in, 1-minute refresh                             |
| Only one filled in               | "Client ID and secret both needed", nothing is fetched  |
| OpenSky refuses them (`401`)     | "Sign-in not accepted", with the settings to fix        |
| OpenSky's sign-in server is down | Treated like any outage: the last reading, marked stale |

A refused sign-in is shown even when older positions are cached: it is a
setting to fix, and riding it out on stale data would hide it.

### How many screens fit

|                                | Anonymous (400/day) | Signed in (4,000/day)                                   |
| ------------------------------ | ------------------- | ------------------------------------------------------- |
| One screen, default refresh    | 288 — fits          | 1,440 — fits                                            |
| Two screens, default refresh   | 576 — **over**      | 2,880 — fits                                            |
| Three screens, default refresh | 864 — **over**      | 4,320 — **over**: set Refresh Interval to 120 s or more |

Flown paths in flight mode come from a separate allowance and are refreshed
every 30 minutes anonymously (192 credits a day) or every 10 signed in. If
that allowance runs out, the path stops updating until OpenSky's reset; the
aircraft's position keeps updating.

## Credits and refresh

OpenSky meters its API in credits, per day, per IP for anonymous use:

|                         | Anonymous | With a client |
| ----------------------- | --------- | ------------- |
| Daily credits           | 400       | 4,000         |
| Default refresh         | 300 s     | 60 s          |
| Fastest allowed refresh | 240 s     | 30 s          |

A query for a box up to 25 square degrees costs 1 credit — a 100 km radius
stays inside that — and a worldwide query costs 4. The app keeps to the cheap
end:

- The last reading is cached. A playlist that shows the app every minute does
  not refetch until the refresh interval has passed.
- A followed flight is searched for worldwide once, then re-found in a 300 km
  box around its last position.
- A flight that is not airborne is checked again after 20 minutes (5 with a
  client), not every refresh.
- A `429` honours OpenSky's `X-Rate-Limit-Retry-After-Seconds`.

Sign-in is OAuth2 client credentials; OpenSky no longer accepts username and
password. Tokens are reused until a minute before they expire.

## Behaviour when the feed fails

This follows the Edge Apps failure-mode algorithm. Credentials are optional —
the API is public — so only the data half of the diagram applies:

| Feed   | `display_errors`   | Result                                     |
| ------ | ------------------ | ------------------------------------------ |
| Fresh  | —                  | Draw the cached reading, no request        |
| OK     | —                  | Cache it, draw it                          |
| Failed | on                 | Show the error                             |
| Failed | off, cache present | Draw the last reading, status marked stale |
| Failed | off, no cache      | Say it is unavailable                      |

`screenly.signalAbort()` does not exist yet (Phorge T10903), so the last row
says what happened and signals ready anyway. OpenSky is given 8 seconds, inside
the screenshotter's budget.

## How it works

- `src/data.ts` — what to fetch for each mode, the cache shape, the refresh
  policy and dead reckoning.
- `src/opensky.ts` — the API client: OAuth token, CORS proxy, rate limits.
- `src/states.ts` — the state-vector wire format, parsed and narrowed.
- `src/map.ts` — the equirectangular map, markers and collision-free labels.
- `src/panel.ts` — the glass panel for each mode.
- `src/traffic.ts` — altitude bands and the arrival / departure heuristic: low,
  descending and pointed at the field is an arrival; low, climbing and pointed
  away is a departure.
- `src/lookup.ts` — airports and flight numbers.

The map is the same public-domain Natural Earth outline as the Earthquake app,
injected from `src/world.svg`. Every size is a multiple of one unit — a
hundredth of the screen's width, or of its height scaled to 16:9, whichever is
smaller — so the layout fills any screen shape. In portrait the panel drops
below the map. The build is folded into one self-contained `index.html` by
`scripts/inline-bundle.mjs`.

`src/airports.json` and `src/airlines.json` are generated from
[OurAirports](https://ourairports.com/data/) (public domain) and
[OpenFlights](https://openflights.org/data) (ODbL) by
`bun run generate-reference-data`, and committed so builds stay offline.

## Accessibility

Every text and component colour is held to **WCAG AA** in both themes by
`src/contrast.test.ts`, which reads the tokens straight out of `src/style.css`:

- 4.5:1 for all text. The 3:1 large-text allowance is not used, because sizes
  scale with the screen and are small on 800×480 players.
- 3:1 for components and meaningful graphics: aircraft, legend dots, airport
  pins, the radius ring, flight paths, the progress bar and coastlines.
- Translucent layers are composited first, and each colour is measured over
  both sea and land, so the worst case is what passes.

Map labels sit on a glass backing above ordinary aircraft, so an aircraft never
covers their text. Change a colour, run `bun run test`.

## Development

```bash
bun install
bun run dev
```

`dev` starts the CORS proxy alongside the dev server, so OpenSky is reachable
locally. Edit `mock-data.yml` to switch modes; there are commented examples.

```bash
bun run type-check
bun run lint
bun run format
bun run test         # unit tests
bun run screenshots  # Playwright, against mocked OpenSky data
```

## Deployment

Create and deploy the Edge App (first time):

```bash
screenly edge-app create --name opensky-live-app --in-place
bun run deploy
screenly edge-app instance create
```

Or use the manual **Initialize Edge App** GitHub Action for stage, then
production. After each run, set `STAGE_EDGE_APP_ID` /
`PRODUCTION_EDGE_APP_ID` from the printed id. Both environments need the
`SCREENLY_API_TOKEN` secret.

To deploy by hand later:

```bash
bun run deploy
```

The manifest's icon points at
`https://playground.srly.io/edge-apps/icons/opensky-flight-map.svg`; upload
`icon.svg` there before the first deploy.

### Releasing

Pushes to `master` deploy to stage automatically. To release to production,
tag a commit on `master` and push the tag (the workflow refuses tags not on
the default branch):

```bash
git checkout master && git pull
git tag v26.10.0
git push origin v26.10.0
```

Then publish a GitHub Release whose notes list the pull requests merged since
the previous release. Add `--draft` to review the notes before publishing:

```bash
gh release create v26.10.0 --verify-tag --generate-notes --title v26.10.0
```

Use the `vYY.M.PATCH` scheme (e.g. `v26.10.0` for the first release in
October 2026, `v26.10.1` for the next one that month).

Flight data © The OpenSky Network, used under its
[terms of use](https://opensky-network.org/about/terms-of-use).
