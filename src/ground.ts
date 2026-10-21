/*
  Aircraft on the ground pile up on an apron: a dozen grey icons stacked on
  one spot reads as a smudge. Wherever icons overlap, at most two are drawn;
  two overlapping still read as two aircraft, more do not. The Ground count
  on the board still counts them all. Only the ground is thinned: aircraft
  in the air, labelled aircraft and the followed flight are always drawn.
*/

/** Overlapping ground icons drawn per spot. */
export const SHOWN_PER_SPOT = 2

export interface Spot {
  id: string
  x: number
  y: number
}

export interface Group {
  ids: string[]
  x: number
  y: number
}

/**
 * Greedy grouping by distance: each spot joins the first group whose middle
 * is within `radius` pixels (icons that would overlap), or starts its own.
 * Stable for a given input order, so groups do not shuffle between ticks.
 */
export function groupSpots(spots: Spot[], radius: number): Group[] {
  const groups: Array<Group & { sx: number; sy: number }> = []
  for (const spot of spots) {
    const near = groups.find(
      (g) => (g.x - spot.x) ** 2 + (g.y - spot.y) ** 2 <= radius * radius,
    )
    if (near) {
      near.ids.push(spot.id)
      near.sx += spot.x
      near.sy += spot.y
      near.x = near.sx / near.ids.length
      near.y = near.sy / near.ids.length
    } else {
      groups.push({
        ids: [spot.id],
        x: spot.x,
        y: spot.y,
        sx: spot.x,
        sy: spot.y,
      })
    }
  }
  return groups.map(({ ids, x, y }) => ({ ids, x, y }))
}

/**
 * Which ground icons to hide: in every spot, all but the first two. The
 * first two of a spot stay put from tick to tick, as the grouping is stable.
 */
export function hiddenOnGround(spots: Spot[], radius: number): Set<string> {
  const hidden = new Set<string>()
  for (const group of groupSpots(spots, radius)) {
    for (const id of group.ids.slice(SHOWN_PER_SPOT)) hidden.add(id)
  }
  return hidden
}

/** Hides the extra icons. Runs once a second, with the planes. */
export function thinGround(
  spots: Spot[],
  markers: Map<string, HTMLElement>,
  radius: number,
): void {
  const hidden = hiddenOnGround(spots, radius)
  for (const { id } of spots) {
    markers.get(id)?.classList.toggle('grouped', hidden.has(id))
  }
}
