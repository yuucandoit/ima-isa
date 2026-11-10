import { useQuery } from '@tanstack/react-query'
import {
  fetchAlerts,
  fetchCluster,
  fetchClusters,
  fetchFeed,
  fetchFeeds,
  fetchKeywords,
  fetchLocationAnalytics,
  fetchOverview,
  fetchSources,
  fetchSystemStatus,
  type AlertParams,
  type AnalyticsParams,
} from '@/lib/api'
import type { FeedQuery } from '@media-intel/types'

export function useAnalytics(params: AnalyticsParams) {
  return useQuery({
    queryKey: ['analytics', params],
    queryFn: () => fetchOverview(params),
    refetchInterval: 60_000,
  })
}

export function useLocationAnalytics(params: Omit<AnalyticsParams, 'bucket'>) {
  return useQuery({
    queryKey: ['analytics', 'locations', params],
    queryFn: () => fetchLocationAnalytics(params),
    refetchInterval: 120_000,
  })
}

export function useFeeds(params: FeedQuery) {
  return useQuery({
    queryKey: ['feeds', params],
    queryFn: () => fetchFeeds(params),
    placeholderData: (previous) => previous,
  })
}

export function useFeed(id: string | null) {
  return useQuery({
    queryKey: ['feed', id],
    queryFn: () => fetchFeed(id!),
    enabled: Boolean(id),
  })
}

export function useClusters(limit = 20) {
  return useQuery({
    queryKey: ['clusters', limit],
    queryFn: () => fetchClusters({ limit, minArticles: 5 }),
    refetchInterval: 120_000,
  })
}

export function useCluster(id: string | null) {
  return useQuery({
    queryKey: ['cluster', id],
    queryFn: () => fetchCluster(id!),
    enabled: Boolean(id),
  })
}

export function useAlerts(params: AlertParams, enabled = true) {
  return useQuery({
    queryKey: ['alerts', params],
    queryFn: () => fetchAlerts(params),
    enabled,
    refetchInterval: 60_000,
  })
}

export function useKeywords(withMatches = true) {
  return useQuery({
    queryKey: ['keywords', withMatches],
    queryFn: () => fetchKeywords(withMatches),
  })
}

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: fetchSources,
  })
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: fetchSystemStatus,
    refetchInterval: 30_000,
  })
}
