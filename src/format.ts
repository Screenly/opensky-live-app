import tzlookup from '@photostructure/tz-lookup'

export type Units = 'aviation' | 'metric' | 'imperial'

export function resolveUnits(value: string): Units {
  return value === 'aviation' || value === 'imperial' ? value : 'metric'
}

const KM_PER: Record<Units, number> = {
  metric: 1,
  aviation: 1.852,
  imperial: 1.609344,
}

/** A distance given in the chosen units, in kilometres: 100 nm is 185.2 km. */
export function toKm(value: number, units: Units): number {
  return value * KM_PER[units]
}

/**
 * The Range setting in kilometres. It is 50, 100 or 200 in the chosen units
 * (km, nm or mi); any other number from an older install still works. Kept
 * between 10 and 400 km.
 */
export function rangeKm(setting: number, units: Units): number {
  const km = toKm(Number.isFinite(setting) ? setting : 100, units)
  return Math.min(Math.max(km, 10), 400)
}

const FEET_PER_METRE = 3.28084
/** Below these, an airborne altitude is "<100 ft" / "<30 m", not a number. */
const LOW_FT = 100
const LOW_M = 30

export class Formatter {
  constructor(
    private units: Units,
    private locale: string,
    /** The screen's timezone; clock times are in it unless told otherwise. */
    private timeZone?: string,
  ) {}

  number(value: number, digits = 0): string {
    return new Intl.NumberFormat(this.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
  }

  /** Altitude as a value and its unit, so the two can be styled apart. */
  /**
   * Altitude as a value and its unit. OpenSky's altitude is pressure
   * altitude (from air pressure, assuming a standard day), not height above
   * the ground: an aircraft on short final, or on a high-pressure day, can
   * read 0 or even below sea level while still airborne. Anything under
   * 100 ft (30 m) is written as just that, never as "0" or a negative.
   */
  altitude(metres: number | null, onGround = false): [string, string] {
    if (onGround) return ['GND', '']
    if (metres === null) return ['—', '']
    if (this.units === 'metric') {
      if (metres < LOW_M) return [`<${LOW_M}`, 'm']
      return [this.number(Math.round(metres / 10) * 10), 'm']
    }
    const feet = metres * FEET_PER_METRE
    if (feet < LOW_FT) return [`<${LOW_FT}`, 'ft']
    // Above 18,000 ft pilots speak in flight levels; the board does the same.
    if (this.units === 'aviation' && feet >= 18000) {
      return [`FL${String(Math.round(feet / 100)).padStart(3, '0')}`, '']
    }
    return [this.number(Math.round(feet / 100) * 100), 'ft']
  }

  speed(metresPerSecond: number): [string, string] {
    if (this.units === 'metric') {
      return [this.number(Math.round(metresPerSecond * 3.6)), 'km/h']
    }
    if (this.units === 'imperial') {
      return [this.number(Math.round(metresPerSecond * 2.23694)), 'mph']
    }
    return [this.number(Math.round(metresPerSecond * 1.94384)), 'kt']
  }

  /** Vertical speed per minute, signed, in the altitude's unit. */
  climb(metresPerSecond: number): [string, string] {
    const perMinute =
      this.units === 'metric'
        ? metresPerSecond * 60
        : metresPerSecond * 60 * FEET_PER_METRE
    const step = this.units === 'metric' ? 10 : 50
    const rounded = Math.round(perMinute / step) * step
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
    return [
      `${sign}${this.number(Math.abs(rounded))}`,
      this.units === 'metric' ? 'm/min' : 'ft/min',
    ]
  }

  distance(km: number): [string, string] {
    if (this.units === 'metric') return [this.number(Math.round(km)), 'km']
    if (this.units === 'imperial') {
      return [this.number(Math.round(km / 1.609344)), 'mi']
    }
    return [this.number(Math.round(km / 1.852)), 'nm']
  }

  /** A radius setting, in the same units as the distances. */
  radius(km: number): string {
    const [value, unit] = this.distance(km)
    return `${value} ${unit}`
  }

  /** "3 h 20 m", "45 m" — rounded to five minutes, since it is an estimate. */
  duration(seconds: number): string {
    const minutes = Math.max(5, Math.round(seconds / 300) * 5)
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    if (hours === 0) return `${rest} m`
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`
  }

  /** "~5 min", "~1 h 10 min" — whole minutes, marked as an estimate. */
  estimate(seconds: number): string {
    const minutes = Math.max(1, Math.round(seconds / 60))
    if (minutes < 60) return `~${minutes} min`
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest === 0 ? `~${hours} h` : `~${hours} h ${rest} min`
  }

  /**
   * "12:55 AM IST": a time in a timezone — the screen's, unless another is
   * given — with that zone's name, so a time is never ambiguous on a screen
   * whose viewers may be anywhere.
   */
  clock(date: Date, timeZone = this.timeZone): string {
    return `${this.time(date, timeZone)} ${zoneName(date, timeZone)}`
  }

  /** Just the time, in a timezone: "09:43 PM". */
  time(date: Date, timeZone = this.timeZone): string {
    return new Intl.DateTimeFormat(this.locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date)
  }

  degrees(value: number, positive: string, negative: string): string {
    return `${this.number(Math.abs(value), 3)}° ${value < 0 ? negative : positive}`
  }
}

/** The timezone at a place, as an IANA name: "Pacific/Honolulu". */
export function zoneAt(lat: number, lng: number): string {
  return tzlookup(lat, lng)
}

/** English locales tried, in turn, for a zone's everyday abbreviation. */
const ZONE_LOCALES = [
  'en-US',
  'en-GB',
  'en-IE',
  'en-IN',
  'en-AU',
  'en-NZ',
  'en-CA',
]

/**
 * A timezone's short name at a moment: "PDT", "HST", "BST", "IST". Browsers
 * only abbreviate a zone in the locales that use it (London is "GMT+1" in US
 * English, "BST" in British), so several are tried; where none has a name,
 * the offset is shown instead: "GMT+5".
 */
export function zoneName(date: Date, timeZone?: string): string {
  let offset = ''
  for (const locale of ZONE_LOCALES) {
    const part = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: 'short',
    })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value
    if (!part) continue
    if (/^[A-Z]{2,5}$/.test(part)) return part
    offset ||= part
  }
  // Some browsers write no offset as "GMT+0" (or "UTC"): it is just GMT.
  return /^(GMT|UTC)([+-]0(:00)?)?$/.test(offset) ? 'GMT' : offset
}
