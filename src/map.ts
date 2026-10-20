import { escapeHtml } from '@screenly/edge-apps'

import type { Formatter } from './format'
import { KM_PER_DEGREE, nearLongitude, RADIANS } from './geo'
import type { Aircraft, Waypoint } from './opensky'
import { code, type Route } from './route'
import { band } from './traffic'

export interface Area {
  x: number
  y: number
  w: number
  h: number
}

type Locate = (aircraft: Aircraft) => { lat: number; lng: number }

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

function rectOf(element: Element): Rect {
  const { left, top, right, bottom } = element.getBoundingClientRect()
  return { left, top, right, bottom }
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  )
}

/**
 * The flat (equirectangular) world and everything drawn on it. Placing a
 * point is arithmetic rather than a mapping library: longitude is a fraction
 * across the window, latitude a fraction down.
 */
export class MapView {
  private west = 0
  private east = 0
  private north = 0
  private south = 0
  private centreLng = 0
  private markers = new Map<string, HTMLElement>()

  constructor(
    private stage: HTMLElement,
    private world: SVGSVGElement,
    private planes: HTMLElement,
    private home: HTMLElement,
    private glyph: string,
  ) {}

  /**
   * Fits a span of kilometres into the clear area, centred on a point, and
   * stretches longitude by 1/cos(latitude) so distances read true.
   */
  frame(lat: number, lng: number, spanKm: number, area: Area): void {
    const fit = Math.max(Math.min(area.w, area.h), 1)
    const kmPerPx = spanKm / fit
    const cosLat = Math.max(Math.cos(lat * RADIANS), 0.05)
    const degLngPerPx = kmPerPx / (KM_PER_DEGREE * cosLat)
    const degLatPerPx = kmPerPx / KM_PER_DEGREE

    this.centreLng = lng
    this.west = lng - (area.x + area.w / 2) * degLngPerPx
    this.east = this.west + this.stage.clientWidth * degLngPerPx
    this.north = lat + (area.y + area.h / 2) * degLatPerPx
    this.south = this.north - this.stage.clientHeight * degLatPerPx
    this.world.setAttribute(
      'viewBox',
      `${this.west} ${-this.north} ${this.east - this.west} ${this.north - this.south}`,
    )
    this.graticule()
  }

  private graticule(): void {
    const { west, east, north, south } = this
    let step = 0.25
    for (const choice of [20, 10, 5, 2, 1, 0.5]) {
      if (choice <= (north - south) / 6) step = Math.max(step, choice)
    }
    let d = ''
    for (let lng = Math.ceil(west / step) * step; lng < east; lng += step) {
      d += `M${lng} ${-north}V${-south}`
    }
    for (let lat = Math.ceil(south / step) * step; lat < north; lat += step) {
      d += `M${west} ${-lat}H${east}`
    }
    this.path('graticule', d)
  }

  path(id: string, d: string): void {
    this.world.querySelector(`#${id}`)!.setAttribute('d', d)
  }

  /** A path through points, in this window's longitude range. */
  line(points: Array<[number, number]>): string {
    return points
      .map(
        ([lat, lng], i) =>
          `${i === 0 ? 'M' : 'L'}${nearLongitude(lng, this.centreLng).toFixed(4)} ${(-lat).toFixed(4)}`,
      )
      .join('')
  }

  trail(trail: Waypoint[], from: Aircraft, now: { lat: number; lng: number }) {
    const points = trail.map(([, lat, lng]): [number, number] => [lat, lng])
    points.push([from.lat, from.lng], [now.lat, now.lng])
    this.path('trail', this.line(points))
  }

  pixelOf(lat: number, lng: number): [number, number] {
    const x =
      ((nearLongitude(lng, this.centreLng) - this.west) /
        (this.east - this.west)) *
      this.stage.clientWidth
    const y =
      ((this.north - lat) / (this.north - this.south)) * this.stage.clientHeight
    return [x, y]
  }

  placeHome(at: { lat: number; lng: number } | null, tag = ''): void {
    this.pin(this.home, at, tag)
  }

  /**
   * A followed flight's two airports, and the line it still has to fly. The
   * line is drawn straight in this flat projection, which is close enough to
   * the great circle at the scale of one screen.
   */
  ports(route: Route | null, now: { lat: number; lng: number } | null): void {
    this.pin(
      document.getElementById('port-from')!,
      route?.from ?? null,
      route ? code(route.from) : '',
    )
    this.pin(
      document.getElementById('port-to')!,
      route?.to ?? null,
      route ? code(route.to) : '',
    )
    this.path(
      'ahead',
      route && now
        ? this.line([
            [now.lat, now.lng],
            [route.to.lat, route.to.lng],
          ])
        : '',
    )
  }

  private pin(
    marker: HTMLElement,
    at: { lat: number; lng: number } | null,
    tag: string,
  ): void {
    marker.hidden = at === null
    if (!at) return
    const [x, y] = this.pixelOf(at.lat, at.lng)
    marker.style.transform = `translate(${x}px, ${y}px)`
    marker.querySelector('.tag')!.textContent = tag
  }

  /**
   * One marker per aircraft, reused across refreshes so it glides to its new
   * position. Labelled aircraft carry a tag; the target is drawn large.
   */
  render(
    drawn: Aircraft[],
    locate: Locate,
    labelled: Set<string>,
    target: string | null,
    fmt: Formatter,
  ): void {
    const keep = new Set<string>()
    for (const aircraft of drawn) {
      keep.add(aircraft.icao24)
      let marker = this.markers.get(aircraft.icao24)
      if (!marker) {
        marker = document.createElement('div')
        marker.innerHTML = `<div class="glyph">${this.glyph}</div><div class="tag"></div>`
        // Placed before it is attached, so it appears in place rather than
        // gliding in from the corner.
        this.move(marker, locate(aircraft))
        this.markers.set(aircraft.icao24, marker)
        this.planes.append(marker)
      }
      const isTarget = aircraft.icao24 === target
      const isHot = isTarget || labelled.has(aircraft.icao24)
      marker.className = `plane ${band(aircraft)}${isHot ? ' hot' : ''}${isTarget ? ' target' : ''}`
      const glyph = marker.firstElementChild as HTMLElement
      glyph.style.transform = `rotate(${aircraft.track}deg)`
      const tag = marker.lastElementChild as HTMLElement
      tag.hidden = !isHot || isTarget
      if (!tag.hidden) tag.innerHTML = tagFor(aircraft, fmt)
    }
    for (const [icao24, marker] of this.markers) {
      if (keep.has(icao24)) continue
      marker.remove()
      this.markers.delete(icao24)
    }
  }

  /**
   * Moves every marker to where it should be now, then steers each tag to a
   * side where it covers no other tag, labelled aircraft or fixed marker.
   * Nearest aircraft are placed first; a tag with no clear side is hidden for
   * this second rather than drawn over another. Runs once a second.
   */
  place(drawn: Aircraft[], locate: Locate): void {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const taken: Rect[] = Array.from(
      this.stage.querySelectorAll(
        '.marker:not([hidden]) .dot, .marker:not([hidden]) .tag',
      ),
    ).map(rectOf)
    const tags: Array<{ tag: HTMLElement; x: number; y: number; r: number }> =
      []
    for (const aircraft of drawn) {
      const marker = this.markers.get(aircraft.icao24)
      if (!marker) continue
      const [x, y] = this.move(marker, locate(aircraft))
      if (!marker.classList.contains('hot')) continue
      const r = (marker.firstElementChild as HTMLElement).offsetWidth / 2
      taken.push({ left: x - r, top: y - r, right: x + r, bottom: y + r })
      const tag = marker.lastElementChild as HTMLElement
      if (!tag.hidden) tags.push({ tag, x, y, r: r + 0.4 * rem })
    }
    for (const { tag, x, y, r } of tags) {
      const w = tag.offsetWidth
      const h = tag.offsetHeight
      const sides: Array<[number, number]> = [
        [r, -h / 2],
        [-r - w, -h / 2],
        [-w / 2, r],
        [-w / 2, -r - h],
      ]
      const clear = sides.find(([dx, dy]) => {
        const box = {
          left: x + dx,
          top: y + dy,
          right: x + dx + w,
          bottom: y + dy + h,
        }
        return !taken.some((other) => overlaps(box, other))
      })
      tag.style.visibility = clear ? 'visible' : 'hidden'
      if (!clear) continue
      const [dx, dy] = clear
      tag.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`
      taken.push({
        left: x + dx,
        top: y + dy,
        right: x + dx + w,
        bottom: y + dy + h,
      })
    }
  }

  private move(
    marker: HTMLElement,
    at: { lat: number; lng: number },
  ): [number, number] {
    const [x, y] = this.pixelOf(at.lat, at.lng)
    marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
    return [x, y]
  }
}

function tagFor(aircraft: Aircraft, fmt: Formatter): string {
  const [altitude, altitudeUnit] = fmt.altitude(
    aircraft.altitude,
    aircraft.onGround,
  )
  const [speed, speedUnit] = fmt.speed(aircraft.speed)
  const name = aircraft.callsign || aircraft.icao24.toUpperCase()
  const detail = `${altitude} ${altitudeUnit}`.trim()
  return `<b>${escapeHtml(name)}</b><span>${escapeHtml(detail)} · ${escapeHtml(`${speed} ${speedUnit}`)}</span>`
}

/**
 * What the panels leave clear: the map's focus sits in the middle of it. In
 * landscape that is left of the panel, between the brand and the status; in
 * portrait, between the status and the panel below.
 */
export function clearAreaOf(stage: HTMLElement): Area {
  const width = stage.clientWidth
  const height = stage.clientHeight
  const whole = { x: 0, y: 0, w: width, h: height }
  if (stage.classList.contains('notice-on')) return whole
  const box = (selector: string) =>
    stage.querySelector(selector)!.getBoundingClientRect()
  const panel = box('.panel')
  const status = box('.status')
  const area =
    height > width
      ? { x: 0, y: status.bottom, w: width, h: panel.top - status.bottom }
      : {
          x: 0,
          y: box('.brand').bottom,
          w: panel.left,
          h: status.top - box('.brand').bottom,
        }
  // A panel that somehow covers the map leaves nothing clear: use it all.
  return area.w > 0 && area.h > 0 ? area : whole
}
