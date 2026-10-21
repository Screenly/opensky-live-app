import { signalReady } from '@screenly/edge-apps'

/*
  The ready signal, per the Edge Apps standard and the 8-bit fireplace's
  pattern. The manifest sets `ready_signal: true`, so the player keeps this
  app hidden until `screenly.signalReadyForRendering()` is called.

  - It is sent synchronously, right after the screen is drawn. Waiting for
    requestAnimationFrame first deadlocks on Pi / Player Max: animation frames
    do not run while the player keeps the app hidden, and it stays hidden
    until it signals, so the asset times out and is skipped.
  - It is sent only once there is something worth showing: positions drawn
    (live or cached), a flight that OpenSky reports as not in the air, or a
    setting an operator has to fix. Never for a "connecting" state: until
    OpenSky answers, the player keeps showing whatever came before.
  - It is sent once. Later calls do nothing.
*/

let signalled = false

/** Tells the player the screen is ready to show. Later calls do nothing. */
export function ready(): void {
  if (signalled) return
  signalled = true
  signalReady()
}
