import { expect, test, type Page, type Request } from '@playwright/test'
import {
  createMockScreenlyForScreenshots,
  setupClockMock,
  setupScreenlyJsMock,
} from '@screenly/edge-apps/test/screenshots'

import { routeBody, statesBody, trackBody } from './opensky-mocks'

/*
  The OpenSky API client settings. Filled in, the app signs in (OAuth2 client
  credentials) and sends the token with every OpenSky request; blank, it is
  anonymous. Half-filled or refused, the screen says which setting to fix.
*/

const SCREEN = {
  coordinates: [37.3861, -122.0839] as [number, number],
  location: 'Silicon Valley, USA',
}

interface Seen {
  token: Request[]
  opensky: Request[]
}

async function open(
  page: Page,
  settings: Record<string, string>,
  { token = 200, tracks = 200 }: { token?: number; tracks?: number } = {},
): Promise<Seen> {
  const seen: Seen = { token: [], opensky: [] }
  const { screenlyJsContent } = createMockScreenlyForScreenshots(SCREEN, {
    mode: 'area',
    display_errors: 'false',
    ...settings,
  })
  await setupClockMock(page)
  await setupScreenlyJsMock(page, screenlyJsContent)
  await page.route(/auth\.opensky-network\.org/, (route) => {
    seen.token.push(route.request())
    return token === 200
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: 'test-token',
            expires_in: 1800,
          }),
        })
      : route.fulfill({
          status: token,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid_client' }),
        })
  })
  await page.route(/opensky-network\.org\/api/, (route) => {
    const url = route.request().url()
    seen.opensky.push(route.request())
    if (url.includes('/tracks')) {
      return tracks === 200
        ? route.fulfill({ status: 200, body: trackBody() })
        : route.fulfill({
            status: tracks,
            headers: { 'X-Rate-Limit-Retry-After-Seconds': '3600' },
            body: '',
          })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: statesBody(url),
    })
  })
  await page.route(/adsbdb\.com/, (route) =>
    route.fulfill({ status: 200, body: routeBody(route.request().url()) }),
  )
  await page.goto('/')
  await page.waitForFunction(
    () => !document.getElementById('stage')?.classList.contains('loading'),
  )
  return seen
}

const text = (page: Page, id: string) => page.locator(`#${id}`).innerText()

test('signs in with the client ID and secret, and sends the token', async ({
  page,
}) => {
  const seen = await open(page, {
    opensky_client_id: 'my-client',
    opensky_client_secret: 'my-secret',
  })
  expect(seen.token).toHaveLength(1)
  const form = new URLSearchParams(seen.token[0]!.postData() ?? '')
  expect(form.get('grant_type')).toBe('client_credentials')
  expect(form.get('client_id')).toBe('my-client')
  expect(form.get('client_secret')).toBe('my-secret')

  expect(seen.opensky.length).toBeGreaterThan(0)
  for (const request of seen.opensky) {
    expect(await request.headerValue('authorization')).toBe('Bearer test-token')
  }
  expect(await text(page, 'updated')).toContain('OpenSky, signed in')
})

test('stays anonymous with the settings blank', async ({ page }) => {
  const seen = await open(page, {})
  expect(seen.token).toHaveLength(0)
  for (const request of seen.opensky) {
    expect(await request.headerValue('authorization')).toBeNull()
  }
  expect(await text(page, 'updated')).toContain('OpenSky, anonymous')
})

test('trims pasted whitespace from both values', async ({ page }) => {
  const seen = await open(page, {
    opensky_client_id: '  my-client\n',
    opensky_client_secret: ' my-secret ',
  })
  const form = new URLSearchParams(seen.token[0]!.postData() ?? '')
  expect(form.get('client_id')).toBe('my-client')
  expect(form.get('client_secret')).toBe('my-secret')
})

test('says which setting to fix when OpenSky refuses the sign-in', async ({
  page,
}) => {
  await open(
    page,
    { opensky_client_id: 'wrong', opensky_client_secret: 'wrong' },
    { token: 401 },
  )
  expect(await text(page, 'notice-title')).toBe('Sign-in not accepted')
  expect(await text(page, 'notice-fix')).toContain('OpenSky Client ID')
})

test('flags a half-entered pair instead of going anonymous', async ({
  page,
}) => {
  const seen = await open(page, { opensky_client_id: 'my-client' })
  expect(await text(page, 'notice-title')).toBe(
    'Client ID and secret both needed',
  )
  expect(seen.token).toHaveLength(0)
  expect(seen.opensky).toHaveLength(0)
})

test('running out of path credits does not stop position updates', async ({
  page,
}) => {
  await open(page, { mode: 'flight', flight_number: 'EI105' }, { tracks: 429 })
  expect(await page.locator('#stage').getAttribute('class')).not.toContain(
    'notice-on',
  )
  expect(await text(page, 'head-big')).toBe('EIN105')
  expect(await text(page, 'updated')).not.toContain('Showing')
})
