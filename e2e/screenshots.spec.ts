import { test, type Browser } from '@playwright/test'
import {
  createMockScreenlyForScreenshots,
  getScreenshotsDir,
  RESOLUTIONS,
  setupClockMock,
  setupScreenlyJsMock,
} from '@screenly/edge-apps/test/screenshots'
import path from 'path'

import { routeBody, statesBody, trackBody } from './opensky-mocks'

const METADATA = {
  coordinates: [37.3861, -122.0839] as [number, number],
  location: 'Silicon Valley, USA',
}

const BASE_SETTINGS = {
  mode: 'area',
  radius_km: '100',
  units: 'aviation',
  color_scheme: 'dark',
  display_errors: 'false',
  // Ignored on purpose: each theme has its own fixed accent.
  screenly_color_accent: '#00a86b',
}

/** What else is different about a screenshot: where it is, and whether OpenSky answers. */
interface Scenario {
  metadata?: typeof METADATA
  openskyDown?: boolean
}

async function capture(
  browser: Browser,
  name: string,
  width: number,
  height: number,
  settings: Record<string, string>,
  { metadata = METADATA, openskyDown = false }: Scenario = {},
): Promise<void> {
  const { screenlyJsContent } = createMockScreenlyForScreenshots(metadata, {
    ...BASE_SETTINGS,
    ...settings,
  })
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()

  await setupClockMock(page)
  await setupScreenlyJsMock(page, screenlyJsContent)
  await page.route(/opensky-network\.org\/api\/states\/all/, (route) =>
    openskyDown
      ? route.fulfill({ status: 503, body: '' })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: statesBody(route.request().url()),
        }),
  )
  // Only reached with credentials set; the screenshots use made-up ones.
  await page.route(/auth\.opensky-network\.org/, (route) =>
    route.fulfill({ status: 401, body: '{"error":"invalid_client"}' }),
  )
  await page.route(/opensky-network\.org\/api\/tracks/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: trackBody(),
    }),
  )

  await page.route(/api\.adsbdb\.com\/v0\/callsign/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: routeBody(route.request().url()),
    }),
  )

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(
    () => !document.getElementById('stage')?.classList.contains('loading'),
  )

  await page.screenshot({
    path: path.join(getScreenshotsDir(), `${name}-${width}x${height}.png`),
    fullPage: false,
  })
  await context.close()
}

for (const { width, height } of RESOLUTIONS) {
  test(`screenshot ${width}x${height}`, async ({ browser }) => {
    await capture(browser, 'opensky-flight-map', width, height, {})
  })
}

const VARIANTS: Array<[string, Record<string, string>]> = [
  ['airport', { mode: 'airport', airport: 'SFO', radius_km: '60' }],
  ['flight', { mode: 'flight', flight_number: 'EI105' }],
  ['grounded', { mode: 'flight', flight_number: 'AI264' }],
  ['light', { color_scheme: 'light', units: 'metric' }],
]

for (const [variant, settings] of VARIANTS) {
  for (const [width, height] of [
    [1920, 1080],
    [1080, 1920],
  ] as const) {
    test(`screenshot ${variant} ${width}x${height}`, async ({ browser }) => {
      await capture(
        browser,
        `opensky-flight-map-${variant}`,
        width,
        height,
        settings,
      )
    })
  }
}

/*
  What the screen says when something is wrong: a setting it cannot use, or
  OpenSky with nothing cached. Each names the setting to change.
*/
const ERRORS: Array<[string, Record<string, string>, Scenario?]> = [
  ['error-airport', { mode: 'airport', airport: 'XYZQ' }],
  ['error-flight', { mode: 'flight', flight_number: 'hello!' }],
  ['error-location', {}, { metadata: { coordinates: [0, 0], location: '' } }],
  [
    'error-signin',
    { opensky_client_id: 'not-a-client', opensky_client_secret: 'wrong' },
  ],
]

for (const [variant, settings, scenario] of ERRORS) {
  for (const [width, height] of [
    [1920, 1080],
    [1080, 1920],
  ] as const) {
    test(`screenshot ${variant} ${width}x${height}`, async ({ browser }) => {
      await capture(
        browser,
        `opensky-flight-map-${variant}`,
        width,
        height,
        settings,
        scenario,
      )
    })
  }
}
