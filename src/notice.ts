import { escapeHtml } from '@screenly/edge-apps'

import type { Route } from './route'
import { noticeRouteHtml } from './route-view'

/**
 * What the centred notice says when there is nothing to plot.
 *
 * - `error`: something in the settings, or the app itself, needs attention.
 *   Shown with a warning mark, and `fix` names the setting to change.
 * - `info`: nothing is wrong, there is just nothing to show yet (a flight not
 *   in the air, the first load still under way).
 */
export interface NoticeContent {
  label: string
  title: string
  detail: string
  tone?: 'error' | 'info'
  /** Where to fix it, e.g. `Settings › Airport` — shown as a hint. */
  fix?: string
  /** What was typed into that setting, quoted after the setting's name. */
  typed?: string
  route?: Route | null
}

const ICONS = {
  // A warning triangle.
  error:
    '<svg viewBox="0 0 24 24"><path d="M12 3 2 21h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="18" r="1.2" fill="currentColor"/></svg>',
  // An aircraft, seen from above.
  info: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2c.8 0 1.3.9 1.3 2v5.4l8 4.7v2.3l-8-2.6v4.6l2.4 1.8v1.8L12 21l-3.7 1v-1.8l2.4-1.8v-4.6l-8 2.6v-2.3l8-4.7V4c0-1.1.5-2 1.3-2z"/></svg>',
}

function $(id: string): HTMLElement {
  return document.getElementById(id)!
}

/** Fills the notice. The caller decides what the map behind it shows. */
export function fillNotice(content: NoticeContent): void {
  const tone = content.tone ?? 'info'
  const notice = $('notice')
  notice.dataset.tone = tone
  notice.setAttribute('role', tone === 'error' ? 'alert' : 'status')

  $('notice-icon').innerHTML = ICONS[tone]
  $('notice-label').textContent = content.label
  $('notice-title').textContent = content.title
  $('notice-detail').textContent = content.detail

  const route = $('notice-route')
  route.hidden = !content.route
  route.innerHTML = content.route ? noticeRouteHtml(content.route) : ''

  const fix = $('notice-fix')
  fix.hidden = !content.fix
  fix.innerHTML = content.fix
    ? `<span class="how">How to fix</span><b>${escapeHtml(content.fix)}</b>` +
      (content.typed ? `<q>${escapeHtml(content.typed)}</q>` : '')
    : ''
}

const CREDENTIALS_FIX = 'Settings › OpenSky Client ID and Client Secret'

/** One of the pair is filled in and the other is not. */
export const CREDENTIALS_PARTIAL: NoticeContent = {
  tone: 'error',
  label: 'OpenSky sign-in',
  title: 'Client ID and secret both needed',
  detail:
    'Only one of the two is filled in. Enter both to sign in, or clear both to use anonymous access (400 credits a day).',
  fix: CREDENTIALS_FIX,
}

/** OpenSky refused the pair. Cached positions are no answer to a wrong key. */
export const CREDENTIALS_REJECTED: NoticeContent = {
  tone: 'error',
  label: 'OpenSky sign-in',
  title: 'Sign-in not accepted',
  detail:
    'The client ID or secret is wrong, or the API client was deleted. Copy both again from your OpenSky account page, or clear both to use anonymous access.',
  fix: CREDENTIALS_FIX,
}

/** Start-up threw: nothing else can be drawn, but this can. */
export const STARTUP_FAILED: NoticeContent = {
  tone: 'error',
  label: 'Live flights',
  title: 'Something went wrong',
  detail:
    'The app could not start. It has been reported, and will try again the next time it is shown.',
}
