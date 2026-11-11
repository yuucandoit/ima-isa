import { useQuery } from '@tanstack/react-query'
import type { FigurePeriod, SourcePlatform, TrendSort, TrendingWindow } from '@media-intel/types'
import { fetchFigureTrending, fetchSocialTrending } from '@/lib/api'

export function useSocialTrending(
  window: TrendingWindow,
  platform?: 'TWITTER_X' | 'TIKTOK' | 'GOOGLE_TRENDS',
  sort: TrendSort = 'volume',
  hours = 24,
) {
  return useQuery({
    queryKey: ['trending-social', window, platform ?? 'all', sort, hours],
    queryFn: () => fetchSocialTrending({ window, limit: 60, platform, sort, hours }),
    refetchInterval: 60_000,
  })
}

export function useFigureTrending(
  period: FigurePeriod,
  filters: { sourceId?: string; platform?: SourcePlatform } = {},
) {
  return useQuery({
    queryKey: ['trending-figures', period, filters],
    queryFn: () => fetchFigureTrending({ period, limit: 20, ...filters }),
    refetchInterval: 60_000,
  })
}
