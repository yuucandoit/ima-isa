import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSSE } from './useSSE'
import {
  approveClip,
  boostDistribution,
  deleteClipSource,
  distributeClip,
  fetchClipSource,
  fetchClipSources,
  fetchClippingAnalytics,
  fetchClips,
  fetchDistributions,
  ingestClipSource,
  patchClip,
  renderClip,
  requestTrack,
  retryClipSource,
} from '@/lib/api'
import type {
  ClipDistributionStatus,
  ClipRenderMode,
  ClipSourceStatus,
  ClipTargetPlatform,
  GeneratedClipDTO,
} from '@media-intel/types'

/** Sumber klip diproses asinkron: poll cepat saat masih berjalan. */
const ACTIVE_STATUSES = new Set(['pending', 'downloading', 'transcribing', 'analyzing', 'rendering'])

export function useClipSources(status?: string) {
  return useQuery({
    queryKey: ['clipping', 'sources', status ?? 'all'],
    queryFn: () => fetchClipSources({ status: status as never, limit: 30 }),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return 15_000
      return data.some((item) => ACTIVE_STATUSES.has(item.status) || hasActiveRenderForSource(item.id))
        ? 2_000
        : 60_000
    },
  })
}

export function useClipSource(id: number | null) {
  return useQuery({
    queryKey: ['clipping', 'source', id],
    queryFn: () => fetchClipSource(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data
      const status = data?.status
      const hasClipProgress = Boolean(data?.clips.some((clip) => Boolean(clip.renderProgress)))
      if ((status && ACTIVE_STATUSES.has(status)) || hasClipProgress || (id && hasActiveRenderForSource(id))) {
        return 1_500
      }
      return 30_000
    },
  })
}

export function useClips(params: { sourceId?: number } = {}) {
  return useQuery({
    queryKey: ['clipping', 'clips', params],
    queryFn: () => fetchClips({ ...params, limit: 100 }),
    refetchInterval: (query) => {
      const data = query.state.data
      if (hasAnyActiveRender() || data?.some((clip) => Boolean(clip.renderProgress))) {
        return 1_500
      }
      return 30_000
    },
  })
}

export function useDistributions(params: { status?: ClipDistributionStatus } = {}) {
  return useQuery({
    queryKey: ['clipping', 'distributions', params],
    queryFn: () => fetchDistributions({ ...params, limit: 100 }),
    refetchInterval: 30_000,
  })
}

export function useClippingAnalytics() {
  return useQuery({
    queryKey: ['clipping', 'analytics'],
    queryFn: () => fetchClippingAnalytics(),
    refetchInterval: 60_000,
  })
}

export function useIngestSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { url: string; maxClips?: number; language?: string; renderMode?: ClipRenderMode }) =>
      ingestClipSource(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clipping'] })
    },
  })
}

export function useRetrySource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: retryClipSource,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clipping'] })
    },
  })
}

export function useDeleteSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteClipSource,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clipping'] })
    },
  })
}

export interface ClipRenderProgress {
  clipId: number
  sourceId?: number | null
  stage: string
  progress: number
  label: string
  updatedAt: number
  startedAt?: number
  baselineFileHash?: string | null
}

const renderProgressMap = new Map<number, ClipRenderProgress>()
const renderProgressListeners = new Set<() => void>()
const clearTimers = new Map<number, ReturnType<typeof setTimeout>>()
const recentlyCompletedAt = new Map<number, number>()

function notifyRenderProgress() {
  for (const listener of renderProgressListeners) listener()
}

function subscribeRenderProgress(listener: () => void) {
  renderProgressListeners.add(listener)
  return () => {
    renderProgressListeners.delete(listener)
  }
}

function isRenderActive(entry: ClipRenderProgress | undefined): boolean {
  return Boolean(entry) && entry!.stage !== 'completed' && entry!.stage !== 'failed'
}

export function hasAnyActiveRender(): boolean {
  for (const entry of renderProgressMap.values()) {
    if (isRenderActive(entry)) return true
  }
  return false
}

export function hasActiveRenderForSource(sourceId: number): boolean {
  for (const entry of renderProgressMap.values()) {
    if (entry.sourceId === sourceId && isRenderActive(entry)) return true
  }
  return false
}

export function setClipRenderProgress(next: ClipRenderProgress, options: { reset?: boolean } = {}) {
  const existingTimer = clearTimers.get(next.clipId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    clearTimers.delete(next.clipId)
  }

  const prev = renderProgressMap.get(next.clipId)
  const merged: ClipRenderProgress = {
    ...next,
    sourceId: next.sourceId ?? prev?.sourceId ?? null,
    startedAt: options.reset ? (next.startedAt ?? Date.now()) : (prev?.startedAt ?? next.startedAt ?? Date.now()),
    baselineFileHash:
      options.reset
        ? next.baselineFileHash
        : next.baselineFileHash !== undefined
          ? next.baselineFileHash
          : prev?.baselineFileHash,
    // Jangan mundurkan angka persen di tengah satu sesi render aktif.
    progress:
      !options.reset &&
      prev &&
      isRenderActive(prev) &&
      isRenderActive(next) &&
      next.progress < prev.progress
        ? prev.progress
        : next.progress,
  }

  if (options.reset) {
    recentlyCompletedAt.delete(next.clipId)
  }
  renderProgressMap.set(next.clipId, merged)
  notifyRenderProgress()

  if (merged.stage === 'completed') {
    recentlyCompletedAt.set(next.clipId, Date.now())
    const timer = setTimeout(() => {
      const current = renderProgressMap.get(next.clipId)
      if (current && current.stage === 'completed') {
        renderProgressMap.delete(next.clipId)
        notifyRenderProgress()
      }
      clearTimers.delete(next.clipId)
    }, 900)
    clearTimers.set(next.clipId, timer)
  }
}

export function clearClipRenderProgress(clipId: number) {
  const existingTimer = clearTimers.get(clipId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    clearTimers.delete(clipId)
  }
  if (renderProgressMap.delete(clipId)) {
    notifyRenderProgress()
  }
}

export function useClipRenderProgress(clipId: number): ClipRenderProgress | undefined {
  return useSyncExternalStore(
    subscribeRenderProgress,
    useCallback(() => renderProgressMap.get(clipId), [clipId]),
    () => undefined,
  )
}

/**
 * Gabungkan progres realtime SSE + snapshot Redis dari server, sekaligus
 * membersihkan progres lokal bila video hasil render sudah muncul di DB.
 */
export function useResolvedClipRenderProgress(
  clip: GeneratedClipDTO,
  sourceStatus?: ClipSourceStatus,
): ClipRenderProgress | undefined {
  const local = useClipRenderProgress(clip.id)
  const rawRemote = clip.renderProgress ?? null
  const recentDone = recentlyCompletedAt.get(clip.id)
  const remoteStale = Boolean(
    !rawRemote ||
      sourceStatus === 'completed' ||
      sourceStatus === 'failed' ||
      (rawRemote.baselineFileHash !== undefined &&
        clip.fileHash &&
        clip.fileHash !== rawRemote.baselineFileHash) ||
      (recentDone && rawRemote.updatedAt <= recentDone && Date.now() - recentDone < 30_000),
  )
  const remote = remoteStale ? null : rawRemote

  const finishedByHash = Boolean(
    local &&
      isRenderActive(local) &&
      clip.fileHash &&
      local.baselineFileHash !== undefined &&
      clip.fileHash !== local.baselineFileHash,
  )
  const finishedBySource = Boolean(
    local &&
      isRenderActive(local) &&
      !remote &&
      sourceStatus === 'completed' &&
      clip.videoUrl &&
      Date.now() - (local.startedAt ?? local.updatedAt) > 2500,
  )

  useEffect(() => {
    if (finishedByHash || finishedBySource) {
      setClipRenderProgress({
        clipId: clip.id,
        sourceId: clip.sourceId,
        stage: 'completed',
        progress: 100,
        label: 'Selesai dirender',
        updatedAt: Date.now(),
      })
      return
    }

    if (local && isRenderActive(local) && sourceStatus === 'failed') {
      setClipRenderProgress({
        clipId: clip.id,
        sourceId: clip.sourceId,
        stage: 'failed',
        progress: 0,
        label: 'Render gagal',
        updatedAt: Date.now(),
      })
      return
    }

    if (remote && remote.stage !== 'completed' && remote.stage !== 'failed') {
      if (
        !local ||
        (local.stage !== 'completed' &&
          (remote.updatedAt > local.updatedAt || remote.progress > local.progress))
      ) {
        setClipRenderProgress({
          clipId: clip.id,
          sourceId: clip.sourceId,
          stage: remote.stage,
          progress: remote.progress,
          label: remote.label,
          updatedAt: remote.updatedAt,
          baselineFileHash: local?.baselineFileHash ?? remote.baselineFileHash ?? clip.fileHash,
        })
      }
    }
  }, [
    clip.id,
    clip.sourceId,
    clip.fileHash,
    clip.videoUrl,
    remote,
    local,
    sourceStatus,
    finishedByHash,
    finishedBySource,
  ])

  if (finishedByHash || finishedBySource) {
    return undefined
  }
  if (local) return local
  if (remote) {
    return {
      clipId: clip.id,
      sourceId: clip.sourceId,
      stage: remote.stage,
      progress: remote.progress,
      label: remote.label,
      updatedAt: remote.updatedAt,
    }
  }
  return undefined
}

export function useClippingSSE(sourceId?: number) {
  const queryClient = useQueryClient()
  return useSSE('clipping', {
    clip: (raw) => {
      if (raw && typeof raw === 'object') {
        const payload = raw as Record<string, unknown>
        const rawType = typeof payload.type === 'string' ? payload.type : undefined
        const clipId = typeof payload.clipId === 'number' ? payload.clipId : Number(payload.clipId)
        const eventSourceId =
          typeof payload.sourceId === 'number' ? payload.sourceId : Number(payload.sourceId)

        if (
          rawType === 'clip' &&
          Number.isFinite(clipId) &&
          typeof payload.progress === 'number' &&
          typeof payload.stage === 'string'
        ) {
          setClipRenderProgress({
            clipId,
            sourceId: Number.isFinite(eventSourceId) ? eventSourceId : null,
            stage: payload.stage,
            progress: Math.max(0, Math.min(100, payload.progress)),
            label:
              typeof payload.label === 'string' && payload.label
                ? payload.label
                : payload.stage === 'completed'
                  ? 'Selesai dirender'
                  : 'Merender klip…',
            updatedAt:
              typeof payload.updatedAt === 'number' ? payload.updatedAt : Date.now(),
          })

          if (payload.stage === 'completed' || payload.stage === 'failed') {
            void queryClient.invalidateQueries({ queryKey: ['clipping'] })
            if (sourceId) {
              void queryClient.invalidateQueries({ queryKey: ['clipping', 'source', sourceId] })
            }
          }
          return
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['clipping'] })
      if (sourceId) {
        void queryClient.invalidateQueries({ queryKey: ['clipping', 'source', sourceId] })
      }
    },
    source: (raw) => {
      if (raw && typeof raw === 'object') {
        const payload = raw as Record<string, unknown>
        const eventSourceId =
          typeof payload.sourceId === 'number' ? payload.sourceId : Number(payload.sourceId)
        const status = typeof payload.status === 'string' ? payload.status : undefined
        if (Number.isFinite(eventSourceId) && (status === 'completed' || status === 'failed')) {
          for (const entry of renderProgressMap.values()) {
            if (
              entry.sourceId === eventSourceId &&
              isRenderActive(entry) &&
              Date.now() - (entry.startedAt ?? entry.updatedAt) > 1500
            ) {
              setClipRenderProgress({
                clipId: entry.clipId,
                sourceId: eventSourceId,
                stage: status,
                progress: status === 'completed' ? 100 : 0,
                label: status === 'completed' ? 'Selesai dirender' : 'Render gagal',
                updatedAt: Date.now(),
              })
            }
          }
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['clipping'] })
      if (sourceId) {
        void queryClient.invalidateQueries({ queryKey: ['clipping', 'source', sourceId] })
      }
    },
  })
}

export function useRenderClip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      renderMode,
    }: {
      id: number
      renderMode?: ClipRenderMode
      sourceId?: number
      currentFileHash?: string | null
    }) => renderClip(id, { renderMode }),
    onMutate: ({ id, sourceId, currentFileHash }) => {
      setClipRenderProgress(
        {
          clipId: id,
          sourceId: sourceId ?? null,
          stage: 'queued',
          progress: 4,
          label: 'Mengirim ke antrean render…',
          updatedAt: Date.now(),
          startedAt: Date.now(),
          baselineFileHash: currentFileHash ?? null,
        },
        { reset: true },
      )
    },
    onError: (error, { id, sourceId }) => {
      setClipRenderProgress({
        clipId: id,
        sourceId: sourceId ?? null,
        stage: 'failed',
        progress: 0,
        label: error instanceof Error ? error.message : 'Gagal mengirim antrean render',
        updatedAt: Date.now(),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clipping'] })
    },
  })
}

export function useApproveClip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isApproved }: { id: number; isApproved: boolean }) =>
      approveClip(id, isApproved),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clipping'] })
    },
  })
}

export function usePatchClip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; titleHook?: string; renderMode?: ClipRenderMode }) =>
      patchClip(id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clipping'] })
    },
  })
}

export interface DistributionAccountInput {
  targetPlatform: ClipTargetPlatform
  accountUsername: string
  deviceSerial?: string
  cpmRateIdr?: number
}

export function useDistributeClip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      accounts,
      enableViralTrigger,
      watchTimePct,
      dripWindowMinutes,
    }: {
      id: number
      accounts: DistributionAccountInput[]
      enableViralTrigger?: boolean
      watchTimePct?: number
      dripWindowMinutes?: number
    }) => distributeClip(id, { accounts, enableViralTrigger, watchTimePct, dripWindowMinutes }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clipping'] })
    },
  })
}

export function useBoostDistribution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      sessions,
      watchTimePct,
    }: {
      id: number
      sessions?: number
      watchTimePct?: number
    }) => boostDistribution(id, { sessions, watchTimePct }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clipping'] })
    },
  })
}

export function useTrackMetrics() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (distributionId?: number) => requestTrack(distributionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clipping'] })
    },
  })
}
