import { useQuery } from '@tanstack/react-query'
import type { FigurePeriod, SourcePlatform, TrendingWindow } from '@media-intel/types'
import { fetchFigureTrending, fetchSocialTrending } from '@/lib/api'

export function useSocialTrending(window: TrendingWindow) {
  return useQuery({
    queryKey: ['trending-social', window],
    queryFn: () => fetchSocialTrending({ window, limit: 20 }),
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
