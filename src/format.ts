export type Units = 'aviation' | 'metric' | 'imperial'

export function resolveUnits(value: string): Units {
  return value === 'metric' || value === 'imperial' ? value : 'aviation'
}

const FEET_PER_METRE = 3.28084

export class Formatter {
  constructor(
    private units: Units,
    private locale: string,
  ) {}

  number(value: number, digits = 0): string {
    return new Intl.NumberFormat(this.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
  }

  /** Altitude as a value and its unit, so the two can be styled apart. */
  altitude(metres: number | null, onGround = false): [string, string] {
    if (onGround) return ['GND', '']
    if (metres === null) return ['—', '']
    if (this.units === 'metric') {
      return [this.number(Math.round(metres / 10) * 10), 'm']
    }
    const feet = metres * FEET_PER_METRE
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

  clock(date: Date): string {
    return new Intl.DateTimeFormat(this.locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  degrees(value: number, positive: string, negative: string): string {
    return `${this.number(Math.abs(value), 3)}° ${value < 0 ? negative : positive}`
  }
}
