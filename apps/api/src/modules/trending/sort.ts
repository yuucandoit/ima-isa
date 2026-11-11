import type { SocialTrendItem } from '@media-intel/types'

export type TrendSort = 'volume' | 'rank'

/** Urutan blok di UI: tren X → Google → hashtag → sound TikTok. */
const TYPE_ORDER: Record<SocialTrendItem['type'], number> = {
  x_trend: 0,
  google_search: 1,
  hashtag: 2,
  tiktok_sound: 3,
}

/**
 * Urutkan item tren.
 *
 * `volume` (default) memakai besaran yang dilaporkan platform — untuk Google
 * Trends ini `approx_traffic` ("2000+" → 2000), TikTok jumlah tayangan, dan
 * hashtag jumlah sebutan. `rank` memakai urutan asli feed platform.
 *
 * Item tanpa volume (mis. X via guest token) selalu jatuh ke urutan `rank`.
 */
export function sortTrendItems(items: SocialTrendItem[], sort: TrendSort = 'volume'): SocialTrendItem[] {
  return [...items].sort((a, b) => {
    const typeDelta = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
    if (typeDelta !== 0) return typeDelta

    if (sort === 'volume' && a.volume !== b.volume) {
      if (a.volume > 0 && b.volume > 0) return b.volume - a.volume
      // Yang punya volume selalu di atas yang tidak punya.
      if (a.volume > 0) return -1
      if (b.volume > 0) return 1
    }

    if (a.rank !== null && b.rank !== null && a.rank !== b.rank) {
      return a.rank - b.rank
    }
    if (a.rank === null && b.rank !== null) return 1
    if (a.rank !== null && b.rank === null) return -1
    return a.name.localeCompare(b.name)
  })
}
