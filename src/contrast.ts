// WCAG 2.x contrast, with alpha compositing, so translucent tokens (glass
// panels, rgba inks, opacity) are measured as they are actually seen. Kept
// free of the Edge Apps library so it can be unit-tested without a DOM.

export type Rgba = [number, number, number, number]

/** #rgb, #rrggbb or rgb()/rgba(). Anything else is null. */
export function parseColor(value: string): Rgba | null {
  const text = value.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const digits =
      hex[1]!.length === 3 ? hex[1]!.replace(/./g, (d) => d + d) : hex[1]!
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
      1,
    ]
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
      text,
    )
  if (rgb) {
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ]
  }
  return null
}

/** A colour seen through `opacity`, laid over an opaque backdrop. */
export function over(top: Rgba, backdrop: Rgba, opacity = 1): Rgba {
  const a = top[3] * opacity
  return [
    top[0] * a + backdrop[0] * (1 - a),
    top[1] * a + backdrop[1] * (1 - a),
    top[2] * a + backdrop[2] * (1 - a),
    1,
  ]
}

function luminance([r, g, b]: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG contrast ratio between two opaque colours, 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** AA: 4.5:1 for text, 3:1 for components and meaningful graphics. */
export const AA_TEXT = 4.5
export const AA_NON_TEXT = 3

/**
 * The custom properties declared in one CSS block, with var() references
 * resolved. Values that are not plain colours are left out.
 */
export function tokens(
  css: string,
  selector: string,
  inherited: Record<string, Rgba> = {},
): Record<string, Rgba> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`No "${selector} {" block in the stylesheet`)
  const body = css.slice(start, css.indexOf('}', start))
  const found: Record<string, Rgba> = { ...inherited }
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const reference = /^var\(--([\w-]+)\)$/.exec(value!.trim())
    const color = reference ? found[reference[1]!] : parseColor(value!)
    if (color) found[name!] = color
  }
  return found
}
