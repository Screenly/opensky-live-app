import './style.css'
import {
  getSettingWithDefault,
  readEdgeAppCache,
  reportError,
  setupErrorHandling,
  setupSentry,
  writeEdgeAppCache,
} from '@screenly/edge-apps'

import {
  cacheKey,
  fetchFor,
  freshFor,
  positionOf,
  refreshMs,
  type Cached,
  type Plan,
} from './data'
import { Formatter, rangeKm, resolveUnits } from './format'
import { circlePath, kmBetween, nearLongitude } from './geo'
import { clearAreaOf, MapView } from './map'
import {
  credentials,
  CredentialsRejected,
  hasCredentials,
  RateLimited,
  type Aircraft,
} from './opensky'
import { code, flightView, plausible, type Route } from './route'
import {
  CREDENTIALS_PARTIAL,
  CREDENTIALS_REJECTED,
  STARTUP_FAILED,
  fillNotice,
  type NoticeContent,
} from './notice'
import { legend } from './legend'
import { Panel } from './panel'
import { resolveLocale, resolvePosition, resolveTimeZone } from './place'
import { resolvePlan } from './plan'
import { motionOf } from './traffic'
import { ready } from './ready'
import worldSvg from './world.svg?raw'

const CACHE_NAMESPACE = 'opensky-flight-map'
const CACHE_KEY = 'last'
/** With nothing cached, how soon a failed first load is tried again. */
const OUTAGE_RETRY_MS = 30 * 1000

// Looked up in start(), not here. This file is bundled as a classic script and
// inlined into <head>, so module scope runs before <body> exists.
let stage!: HTMLElement
let view!: MapView
let panel!: Panel
let fmt!: Formatter
let plan: Plan | null = null
let radiusKm = 100
let screenAt: { lat: number; lng: number } | null = null

let current: Cached | null = null
let labelled = new Set<string>()
let refreshTimer = 0

function $(id: string): HTMLElement {
  return document.getElementById(id)!
}

function say(id: string, text: string): void {
  $(id).textContent = text
}

const locate = (aircraft: Aircraft) => positionOf(current, aircraft)

/** What each aircraft is doing, which is the colour it wears. */
const motion = (aircraft: Aircraft) =>
  motionOf(
    aircraft,
    plan?.mode === 'airport' ? plan.airport : null,
    radiusKm,
    current?.routes,
  )

/** What the panels leave clear; the map's focus sits in the middle of it. */
const clearArea = () => clearAreaOf(stage)

function target(): Aircraft | undefined {
  return current?.snapshot.aircraft.find((a) => a.icao24 === current?.target)
}

/** The followed flight's route, unless the aircraft is clearly not on it. */
function route(followed: Aircraft): Route | null {
  const known = current?.route ?? null
  return known && plausible(known, followed) ? known : null
}

function draw(): void {
  if (!current || !plan) return
  const drawn = current.snapshot.aircraft
  if (plan.mode === 'flight') {
    const followed = target()
    if (!followed) return
    const now = locate(followed)
    const known = route(followed)
    const { query } = plan
    labelled = panel.flight(query, followed, screenAt, {
      route: known,
      now,
      lostSince: current.lostAt,
      airline: current.airline,
      origin: current.origin,
    })
    // Out of receiver range: drawn faded, as an estimate.
    stage.classList.toggle('estimated', Boolean(current.lostAt))
    say(
      'brand-sub',
      known
        ? `${plan.query.label} · ${code(known.from)} → ${code(known.to)}`
        : plan.query.label,
    )
    const focus = flightView(current.trail, now, known)
    view.frame(focus.lat, focus.lng, focus.spanKm, clearArea())
    view.path('range', '')
    view.placeHome(screenAt, 'This screen')
    view.ports(known, now)
  } else {
    panel.noRoute()
    view.ports(null, null)
    const centre = plan.mode === 'area' ? plan : plan.airport
    labelled =
      plan.mode === 'area'
        ? panel.area(plan, radiusKm, drawn, current.routes)
        : panel.airport(plan.airport, radiusKm, drawn, current.routes)
    view.frame(centre.lat, centre.lng, radiusKm * 2.3, clearArea())
    view.path('range', circlePath(centre.lat, centre.lng, radiusKm))
    view.placeHome(
      centre,
      plan.mode === 'area'
        ? 'This screen'
        : plan.airport.iata || plan.airport.icao,
    )
  }
  view.render(drawn, locate, labelled, current.target, fmt, motion)
  tick()
}

/** Once a second: every aircraft moves on along its course. */
function tick(): void {
  if (!current || stage.classList.contains('notice-on')) return
  view.place(current.snapshot.aircraft, locate)
  const followed = target()
  if (!followed) return
  const now = locate(followed)
  view.trail(current.trail, followed, now)
  view.ports(route(followed), now)
}

function show(cached: Cached, staleReason: string | null): void {
  current = cached
  const at = fmt.clock(new Date(cached.fetchedAt))
  $('updated').classList.toggle('stale', staleReason !== null)
  $('live').classList.toggle('stale', staleReason !== null)
  say(
    'updated',
    staleReason
      ? `Showing ${at} — ${staleReason}`
      : `Updated ${at} · OpenSky, ${hasCredentials() ? 'signed in' : 'anonymous'}`,
  )

  if (plan?.mode === 'flight' && cached.target === null) {
    const { query } = plan
    const tried =
      query.kind === 'icao24'
        ? query.icao24
        : cached.routeFor || query.callsigns[0]
    const next = fmt.clock(new Date(cached.fetchedAt + freshFor(plan, cached)))
    // OpenSky has no position either before departure or after landing, and
    // cannot say which, so the wording stays neutral about it.
    notice({
      label: `Flight ${query.label}${cached.route?.airline ? ` · ${cached.route.airline}` : ''}`,
      title: 'Not in the air right now',
      detail: `OpenSky has no position for ${(tried ?? query.label).toUpperCase()}. Checking again at ${next}.`,
      route: cached.route ?? null,
    })
    // Connected: OpenSky answered, the flight just isn't flying.
    return ready()
  }
  stage.classList.remove('loading', 'notice-on')
  draw()
  ready()
}

/** Says what is going on in the middle of the screen, over a dimmed map. */
/** Says what is going on in the middle of the screen, over a dimmed map. */
function notice(content: NoticeContent): void {
  stage.classList.remove('loading')
  stage.classList.add('notice-on')
  stage.dataset.tone = content.tone ?? 'info'
  fillNotice(content)
  const { route } = content
  if (route) {
    // Behind a grounded flight's notice, the map shows where it flies.
    const { from, to } = route
    const km = kmBetween(from.lat, from.lng, to.lat, to.lng)
    const midLng = (from.lng + nearLongitude(to.lng, from.lng)) / 2
    view.frame(
      (from.lat + to.lat) / 2,
      midLng,
      Math.max(km * 1.4, 800),
      clearArea(),
    )
    return
  }
  const centre =
    screenAt ?? (plan?.mode === 'airport' ? plan.airport : { lat: 20, lng: 0 })
  // With no position at all, a region rather than the whole world, which
  // would leave bare bands above and below it on a portrait screen.
  view.frame(centre.lat, centre.lng, screenAt ? 2500 : 12000, clearArea())
}

/**
 * The Edge Apps failure-mode algorithm. Credentials are optional here — the
 * API is public — so only the data half of the diagram applies:
 *
 *   cache fresh       : show it, no request (saves OpenSky credits)
 *   fetch -> ok       : cache it, show it
 *         -> failed   : display_errors ? show the error
 *                                      : cached ? show that, marked stale
 *                                               : say it is unavailable
 *
 * The last row is the diagram's Abort terminal. `screenly.signalAbort()` does
 * not exist yet (Phorge T10903), so for now the app says what happened and the
 * ready signal goes through anyway.
 */
async function refresh(): Promise<void> {
  if (!plan) return
  window.clearTimeout(refreshTimer)
  const stored = readEdgeAppCache<Cached>(CACHE_NAMESPACE, CACHE_KEY)
  const previous = stored?.key === cacheKey(plan, radiusKm) ? stored : null

  if (previous) {
    // A lost flight keeps its last fix as fetchedAt; when OpenSky was last
    // asked is checkedAt.
    const age = Date.now() - (previous.checkedAt ?? previous.fetchedAt)
    if (age < freshFor(plan, previous)) {
      show(previous, null)
      schedule(freshFor(plan, previous) - age)
      return
    }
  }

  let next: Cached
  try {
    next = await fetchFor(plan, radiusKm, previous)
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown))
    reportError(error, { source: 'opensky' })
    const limited = error instanceof RateLimited
    schedule(
      limited
        ? Math.max(refreshMs(), error.retryAfterSeconds * 1000)
        : refreshMs(),
    )
    // A wrong key is a setting to fix, not an outage to ride out on cache.
    if (error instanceof CredentialsRejected) {
      notice(CREDENTIALS_REJECTED)
      return ready()
    }
    if (getSettingWithDefault<boolean>('display_errors', false)) {
      notice({
        tone: 'error',
        label: 'Display Errors is on',
        title: 'OpenSky request failed',
        detail: error.message,
        fix: 'Settings › Display Errors (off shows the last good reading)',
      })
      return ready()
    }
    const reason = limited
      ? 'OpenSky daily allowance used up'
      : 'OpenSky unreachable'
    const fallback = previous ?? current
    if (fallback) return show(fallback, reason)
    // Not connected and nothing to show: no ready signal, so the player keeps
    // what it was showing. Try again soon; the first answer signals.
    if (!limited) schedule(OUTAGE_RETRY_MS)
    notice({
      tone: 'error',
      label: 'Live flights',
      title: 'Unavailable',
      detail: `${reason}, and nothing is cached yet. The map will fill in on the next try.`,
      ...(limited && !hasCredentials()
        ? { fix: 'Settings › OpenSky Client ID and Client Secret' }
        : {}),
    })
    return
  }
  // Outside the catch on purpose: a fault in drawing is not a fetch failure
  // and must not be answered by falling back to cache.
  writeEdgeAppCache(CACHE_NAMESPACE, CACHE_KEY, next)
  show(next, null)
  schedule(freshFor(plan, next))
}

function schedule(ms: number): void {
  window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => void refresh(), Math.max(ms, 5000))
}

/**
 * Start-up, with the ready signal guaranteed: sent after the first frame is
 * drawn, after a failure, or when the first load overruns its budget.
 */
async function start(): Promise<void> {
  // The manifest offers a sentry_dsn setting; without this call it does
  // nothing. No DSN set means setupSentry returns immediately.
  setupSentry('opensky-flight-map')
  setupErrorHandling()
  try {
    await boot()
  } catch (thrown) {
    reportError(thrown, { source: 'start-up' })
    try {
      notice(STARTUP_FAILED)
    } catch {
      // Too early to draw anything; the signal still goes out.
    }
    // As the 8-bit fireplace does: a crashed app must not hold the player.
    ready()
  }
}

async function boot(): Promise<void> {
  stage = $('stage')
  $('map').insertAdjacentHTML('afterbegin', worldSvg)
  const glyph = ($('plane-glyph') as HTMLTemplateElement).innerHTML
  view = new MapView(
    stage,
    document.querySelector<SVGSVGElement>('#world')!,
    $('planes'),
    $('home'),
    glyph,
  )

  const units = resolveUnits(getSettingWithDefault<string>('units', 'metric'))
  // Where the screen is, first: its timezone comes from its position. The
  // bridge hands coordinates over as strings; resolvePosition converts them.
  const position = resolvePosition()
  screenAt = position ? { lat: position.lat, lng: position.lng } : null
  fmt = new Formatter(units, resolveLocale(), resolveTimeZone(position))
  panel = new Panel(fmt, glyph)

  radiusKm = rangeKm(getSettingWithDefault<number>('radius_km', 100), units)

  plan = await resolvePlan(say, notice)
  // A setting to fix: shown, so an operator sees it.
  if (!plan) return ready()
  stage.dataset.mode = plan.mode
  panel.motion = motion
  panel.includePrivate = getSettingWithDefault<boolean>('show_private', false)
  legend(plan.mode === 'airport')
  if (credentials() === 'partial') {
    notice(CREDENTIALS_PARTIAL)
    return ready()
  }

  window.addEventListener('resize', () => {
    if (!stage.classList.contains('notice-on')) draw()
  })

  await refresh()
  window.setInterval(tick, 1000)
}

document.addEventListener('DOMContentLoaded', () => void start())
