import { expect, test } from '@playwright/test'
import {
  createMockScreenlyForScreenshots,
  FIXED_SCREENSHOT_DATE,
} from '@screenly/edge-apps/test/screenshots'

import { routeBody, routesetBody, statesBody, trackBody } from './opensky-mocks'

/*
  A followed flight flying out of receiver range — ASA815 over the Pacific
  — vanishes from OpenSky at cruise. It is still flying: the screen keeps it,
  as an estimate, rather than saying it is not in the air.
*/

const EI105 = '4ca7b5'

test('a flight that leaves receiver range at cruise is kept, as an estimate', async ({
  page,
}) => {
  let inRange = true
  const { screenlyJsContent } = createMockScreenlyForScreenshots(
    { coordinates: [37.3861, -122.0839], location: 'Silicon Valley, USA' },
    { mode: 'flight', flight_number: 'EI105', display_errors: 'false' },
  )
  await page.clock.install()
  await page.route('**/screenly.js*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: screenlyJsContent,
    }),
  )
  await page.route(/opensky-network\.org\/api|adsbdb\.com/, (route) => {
    const url = route.request().url()
    if (url.includes('/tracks')) return route.fulfill({ body: trackBody() })
    if (url.includes('adsbdb')) return route.fulfill({ body: routeBody(url) })
    // Out of range: OpenSky simply stops listing it.
    const body = JSON.parse(statesBody(url))
    if (!inRange) {
      body.states = body.states.filter((s: unknown[]) => s[0] !== EI105)
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.route(/flightroutes\.opensky-network\.org/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: routesetBody(route.request().postData()),
    }),
  )
  await page.goto('/')
  await expect(page.locator('#head-big')).toHaveText('EIN105')
  await expect(page.locator('#head-sub')).not.toContainText('out of receiver')

  inRange = false
  await page.clock.runFor(301_000) // past the next refresh

  await expect(page.locator('#head-sub')).toContainText(
    'out of receiver range, last seen',
  )
  await expect(page.locator('#stage')).toHaveClass(/estimated/)
  await expect(page.locator('#stage')).not.toHaveClass(/notice-on/)
  await expect(page.locator('#head-big')).toHaveText('EIN105')

  // The player restarts the app (the next time it comes round in the
  // playlist) while the flight is still out of range. The last reading is
  // in the screen's cache, so it carries on as an estimate.
  await page.reload()
  await expect(page.locator('#head-sub')).toContainText(
    'out of receiver range, last seen',
  )
  await expect(page.locator('#stage')).toHaveClass(/estimated/)
  await expect(page.locator('#stage')).not.toHaveClass(/notice-on/)
})

test('a new screen recovers a flight already out of range from OpenSky', async ({
  page,
}) => {
  const { screenlyJsContent } = createMockScreenlyForScreenshots(
    { coordinates: [37.3861, -122.0839], location: 'Silicon Valley, USA' },
    { mode: 'flight', flight_number: 'EI105', display_errors: 'false' },
  )
  // The mocked path is timed against the screenshot clock.
  await page.clock.install({ time: FIXED_SCREENSHOT_DATE })
  await page.route('**/screenly.js*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: screenlyJsContent,
    }),
  )
  const now = Math.floor(FIXED_SCREENSHOT_DATE.getTime() / 1000)
  await page.route(/opensky-network\.org\/api|adsbdb\.com/, (route) => {
    const url = route.request().url()
    if (url.includes('/tracks')) return route.fulfill({ body: trackBody() })
    if (url.includes('adsbdb')) return route.fulfill({ body: routeBody(url) })
    if (url.includes('/flights/departure')) {
      // OpenSky saw EIN105 leave JFK: that tells it which aircraft it is.
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          { icao24: EI105, callsign: 'EIN105  ', firstSeen: now - 6 * 3600 },
        ]),
      })
    }
    // Never in the live data: out of range since before this screen looked.
    const body = JSON.parse(statesBody(url))
    body.states = body.states.filter((s: unknown[]) => s[0] !== EI105)
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.route(/flightroutes\.opensky-network\.org/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: routesetBody(route.request().postData()),
    }),
  )
  await page.goto('/')

  await expect(page.locator('#head-sub')).toContainText(
    'out of receiver range, last seen',
  )
  await expect(page.locator('#stage')).toHaveClass(/estimated/)
  await expect(page.locator('#stage')).not.toHaveClass(/notice-on/)
})

test('a screen that once saw the flight recovers it by its transponder', async ({
  page,
}) => {
  let live = true
  let departuresAsked = 0
  const { screenlyJsContent } = createMockScreenlyForScreenshots(
    { coordinates: [37.3861, -122.0839], location: 'Silicon Valley, USA' },
    { mode: 'flight', flight_number: 'EI105', display_errors: 'false' },
  )
  await page.clock.install({ time: FIXED_SCREENSHOT_DATE })
  await page.route('**/screenly.js*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: screenlyJsContent,
    }),
  )
  await page.route(/opensky-network\.org\/api|adsbdb\.com/, (route) => {
    const url = route.request().url()
    if (url.includes('/tracks')) return route.fulfill({ body: trackBody() })
    if (url.includes('adsbdb')) return route.fulfill({ body: routeBody(url) })
    if (url.includes('/flights/departure')) {
      // As with ASA815: OpenSky's departure list leaves the flight out.
      departuresAsked += 1
      return route.fulfill({ contentType: 'application/json', body: '[]' })
    }
    const body = JSON.parse(statesBody(url))
    if (!live)
      body.states = body.states.filter((s: unknown[]) => s[0] !== EI105)
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.route(/flightroutes\.opensky-network\.org/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: routesetBody(route.request().postData()),
    }),
  )
  await page.goto('/')
  await expect(page.locator('#head-big')).toHaveText('EIN105')

  // The saved reading is lost (say, the cache was cleared), but the
  // transponder it learned is kept with it; here, simulated by dropping just
  // the position from the saved reading.
  live = false
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      const value = saved?.value ?? saved
      if (value?.key === 'flight|EI105') {
        value.target = null
        value.snapshot = { time: value.snapshot.time, aircraft: [] }
        localStorage.setItem(key, JSON.stringify(saved))
      }
    }
  })
  await page.reload()
  // Shown as "not in the air" from the saved reading until the next check
  // (20 minutes anonymously), which reads the path by the remembered
  // transponder.
  await page.clock.runFor(21 * 60_000)
  await expect(page.locator('#head-sub')).toContainText(
    'out of receiver range, last seen',
  )
  expect(departuresAsked).toBe(0)
})
