import { escapeHtml } from '@screenly/edge-apps'

import { cityOf, code, type Progress, type Route } from './route'

/**
 * The From → To line under a followed flight's callsign: the two airports,
 * a bar filled to how far along it is, and the aircraft riding the bar.
 */
export function routeHtml(
  route: Route,
  ahead: Progress,
  glyph: string,
): string {
  const percent = (Math.min(Math.max(ahead.done, 0), 1) * 100).toFixed(1)
  const end = (at: Route['from'], side: string) =>
    `<div class="end ${side}"><b>${escapeHtml(code(at))}</b>` +
    `<span>${escapeHtml(cityOf(at))}</span></div>`
  return (
    end(route.from, 'from') +
    `<div class="bar"><div class="done" style="width: ${percent}%"></div>` +
    `<div class="craft" style="left: ${percent}%">${glyph}</div></div>` +
    end(route.to, 'to')
  )
}

/**
 * The route on the "not in the air" notice: just the two airports, since
 * there is no position to show progress for. "MLE Malé → DEL Delhi".
 */
export function noticeRouteHtml(route: Route): string {
  const end = (at: Route['from'], side: string) =>
    `<span class="end ${side}"><b>${escapeHtml(code(at))}</b>` +
    ` <span>${escapeHtml(cityOf(at))}</span></span>`
  return `${end(route.from, 'from')}<span class="arrow" aria-label="to">→</span>${end(route.to, 'to')}`
}
