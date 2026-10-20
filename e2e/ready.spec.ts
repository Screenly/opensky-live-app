import { expect, test, type Page } from '@playwright/test'
import { createMockScreenlyForScreenshots } from '@screenly/edge-apps/test/screenshots'

import { routeBody, statesBody, trackBody } from './opensky-mocks'

/*
  The ready signal, following the Edge Apps standard and the 8-bit fireplace:
  `ready_signal: true` keeps the app hidden until signalReadyForRendering() is
  called. It must be called once, synchronously after drawing (no animation
  frame wait: frames don't run while the player hides the app), and only when
  there is something worth showing — data, a flight OpenSky says is not in the
  air, or a setting to fix. Never for "connecting", and never for an outage
  with nothing cached: then the player keeps showing what it had.
*/

interface Seen {
  calls: number
  stage: string
  /** The centred notice's title at signal time, if one was showing. */
  notice: string
  text: string
}

const SCREEN = {
  coordinates: [37.3861, -122.0839] as [number, number],
  location: 'Silicon Valley, USA',
}

type OpenSky = 'ok' | 'down' | 'slow-sign-in'

/** Mutable, so a test can bring OpenSky back mid-run. */
interface Network {
  opensky: OpenSky
}

async function open(
  page: Page,
  settings: Record<string, string>,
  network: Network,
  extra = '',
): Promise<void> {
  const { screenlyJsContent } = createMockScreenlyForScreenshots(SCREEN, {
    mode: 'area',
    display_errors: 'false',
    ...settings,
  })
  const recorder = `
    window.__ready = { calls: 0, stage: '', notice: '', text: '' };
    window.screenly.signalReadyForRendering = function () {
      const r = window.__ready;
      r.calls += 1;
      if (r.calls === 1) {
        const stage = document.getElementById('stage');
        r.stage = stage.className;
        r.text = stage.innerText;
        r.notice = r.stage.includes('notice-on')
          ? document.getElementById('notice-title').textContent
          : '';
      }
    };
    ${extra}`
  // Fake timers, so a 30 s retry can be jumped over rather than waited out.
  await page.clock.install()
  await page.route('**/screenly.js*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: screenlyJsContent + recorder,
    }),
  )
  await page.route(/opensky-network\.org|adsbdb\.com/, async (route) => {
    const url = route.request().url()
    if (url.includes('/token')) {
      if (network.opensky === 'slow-sign-in') {
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: 't', expires_in: 1800 }),
      })
    }
    if (network.opensky === 'down' && !url.includes('adsbdb')) {
      return route.fulfill({ status: 503, body: '' })
    }
    const body = url.includes('/tracks')
      ? trackBody()
      : url.includes('adsbdb')
        ? routeBody(url)
        : statesBody(url)
    return route.fulfill({ status: 200, contentType: 'application/json', body })
  })
  // OpenSky's route service knows none of these: registered last, so it
  // wins over the API mocks (and is not one of the API's own requests).
  await page.route(/flightroutes\.opensky-network\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.goto('/')
}

const seen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ready: Seen }).__ready)

async function signal(page: Page, timeout = 15000): Promise<Seen> {
  await page.waitForFunction(
    () => (window as unknown as { __ready: Seen }).__ready.calls > 0,
    null,
    { timeout },
  )
  // Give a stray second call the chance to show up.
  await page.clock.runFor(2000)
  return seen(page)
}

test('signals once, after the map and panel are drawn', async ({ page }) => {
  await open(page, {}, { opensky: 'ok' })
  const s = await signal(page)
  expect(s.calls).toBe(1)
  expect(s.stage).not.toContain('loading')
  expect(s.notice).toBe('')
  expect(s.text).toContain('AIRCRAFT OVERHEAD')
})

test('signals even though animation frames never run (hidden on a Pi)', async ({
  page,
}) => {
  await open(
    page,
    {},
    { opensky: 'ok' },
    'window.requestAnimationFrame = function () { return 0 };',
  )
  const s = await signal(page)
  expect(s.calls).toBe(1)
  expect(s.text).toContain('AIRCRAFT OVERHEAD')
})

test('waits through a slow connection, with no "connecting" screen', async ({
  page,
}) => {
  // Signed in, with a sign-in that takes 3 s.
  await open(
    page,
    { opensky_client_id: 'id', opensky_client_secret: 'secret' },
    { opensky: 'slow-sign-in' },
  )
  await page.waitForTimeout(1500)
  expect((await seen(page)).calls).toBe(0)
  const s = await signal(page)
  expect(s.calls).toBe(1)
  expect(s.notice).toBe('')
  expect(s.text).toContain('AIRCRAFT OVERHEAD')
})

test('does not signal while OpenSky is down with nothing cached, then signals when it is back', async ({
  page,
}) => {
  const network: Network = { opensky: 'down' }
  await open(page, {}, network)
  // The failed first load has been handled…
  await page.waitForFunction(() =>
    document.getElementById('stage')?.classList.contains('notice-on'),
  )
  await page.clock.runFor(5000)
  // …and nothing has been signalled: the player keeps its previous asset.
  expect((await seen(page)).calls).toBe(0)

  network.opensky = 'ok'
  await page.clock.runFor(31000) // past the 30 s retry
  const s = await signal(page)
  expect(s.calls).toBe(1)
  expect(s.notice).toBe('')
  expect(s.text).toContain('AIRCRAFT OVERHEAD')
})

test('signals when a setting is missing, so an operator sees it', async ({
  page,
}) => {
  await open(page, { mode: 'airport', airport: '' }, { opensky: 'ok' })
  const s = await signal(page)
  expect(s.calls).toBe(1)
  expect(s.notice).toBe('No airport set')
})

test('signals when start-up throws', async ({ page }) => {
  await open(
    page,
    {},
    { opensky: 'ok' },
    `Object.defineProperty(window.screenly.metadata, 'coordinates', {
       get() { throw new Error('bridge fault') },
     });`,
  )
  const s = await signal(page)
  expect(s.calls).toBe(1)
  expect(s.notice).toBe('Something went wrong')
})
