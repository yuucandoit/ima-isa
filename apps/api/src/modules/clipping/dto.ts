import { t } from 'elysia'

/** TypeBox schemas for the clipping module (dipakai controller + Eden client).
 *
 * Union literal ditulis eksplisit (bukan dihasilkan dari `.map`) karena Eden
 * Treaty menyimpulkan tipe body dari bentuk skema; hasil `.map` membuat TS
 * menyimpulkan `never`.
 */

/**
 * ID numerik dikirim sebagai string lalu di-parse manual: `t.Numeric` pada
 * path param memicu Elysia menulis ulang properti `params` yang read-only pada
 * versi ini ("Attempting to change configurable attribute…").
 */
export const clipIdParams = t.Object({
  id: t.String({ pattern: '^[1-9][0-9]{0,9}$' }),
})

export function parseClipId(value: string): number {
  return Number.parseInt(value, 10)
}

const renderMode = t.Union([
  t.Literal('split_screen'),
  t.Literal('face_reframe'),
  t.Literal('blur_background'),
])

const targetPlatform = t.Union([
  t.Literal('tiktok'),
  t.Literal('reels'),
  t.Literal('shorts'),
])

const distributionStatus = t.Union([
  t.Literal('queued'),
  t.Literal('uploading'),
  t.Literal('published'),
  t.Literal('boosting'),
  t.Literal('shadowbanned'),
  t.Literal('failed'),
])

const sourceStatus = t.Union([
  t.Literal('pending'),
  t.Literal('downloading'),
  t.Literal('transcribing'),
  t.Literal('analyzing'),
  t.Literal('rendering'),
  t.Literal('completed'),
  t.Literal('failed'),
])

export const clipSourceQuery = t.Object({
  status: t.Optional(sourceStatus),
  platform: t.Optional(t.String({ maxLength: 40 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Numeric({ minimum: 0 })),
})

export const ingestBody = t.Object({
  url: t.String({ minLength: 8, maxLength: 2048 }),
  /** Opsional: batasi jumlah klip yang diminta ke worker (3–20). */
  maxClips: t.Optional(t.Numeric({ minimum: 3, maximum: 20 })),
  /** Bahasa transkrip Whisper (`id`, `en`, atau kosong = auto-detect). */
  language: t.Optional(t.String({ maxLength: 8 })),
  /** Paksa mode render default untuk semua klip sumber ini. */
  renderMode: t.Optional(renderMode),
})

export const renderBody = t.Object({
  renderMode: t.Optional(renderMode),
  /** Override batas waktu; berguna saat hook AI meleset beberapa detik. */
  startTime: t.Optional(t.Numeric({ minimum: 0 })),
  endTime: t.Optional(t.Numeric({ minimum: 0 })),
  /** Nama aset filler spesifik (mis. `minecraft_01.mp4`). */
  fillerAsset: t.Optional(t.String({ maxLength: 200 })),
})

export const approveBody = t.Object({ isApproved: t.Boolean() })

export const patchClipBody = t.Object({
  titleHook: t.Optional(t.String({ minLength: 3, maxLength: 280 })),
  startTime: t.Optional(t.Numeric({ minimum: 0 })),
  endTime: t.Optional(t.Numeric({ minimum: 0 })),
  renderMode: t.Optional(renderMode),
  isApproved: t.Optional(t.Boolean()),
})

export const distributeBody = t.Object({
  accounts: t.Array(
    t.Object({
      targetPlatform,
      accountUsername: t.String({ minLength: 1, maxLength: 120 }),
      deviceSerial: t.Optional(t.String({ maxLength: 120 })),
      cpmRateIdr: t.Optional(t.Numeric({ minimum: 0, maximum: 100_000 })),
    }),
    { minItems: 1, maxItems: 50 },
  ),
  /** Aktifkan viral trigger otomatis setelah publish. */
  enableViralTrigger: t.Optional(t.Boolean()),
  /** Target watch-time loop (%) untuk booster, 100–250. */
  watchTimePct: t.Optional(t.Numeric({ minimum: 100, maximum: 250 })),
  /** Jendela drip-feed pertama dalam menit. */
  dripWindowMinutes: t.Optional(t.Numeric({ minimum: 10, maximum: 720 })),
})

export const distributionQuery = t.Object({
  status: t.Optional(distributionStatus),
  clipId: t.Optional(t.Numeric({ minimum: 1 })),
  account: t.Optional(t.String({ maxLength: 120 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
  offset: t.Optional(t.Numeric({ minimum: 0 })),
})

export const boostBody = t.Object({
  /** Jumlah sesi trigger yang diinginkan (1–50). */
  sessions: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
  watchTimePct: t.Optional(t.Numeric({ minimum: 100, maximum: 250 })),
  /** Cari lewat keyword spesifik, bukan hanya username. */
  searchKeyword: t.Optional(t.String({ maxLength: 120 })),
})

export const analyticsQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
})

export type IngestInput = typeof ingestBody.static
export type RenderInput = typeof renderBody.static
export type DistributeInput = typeof distributeBody.static
export type BoostInput = typeof boostBody.static
export type ClipSourceQuery = typeof clipSourceQuery.static
export type DistributionQuery = typeof distributionQuery.static

export const clipListQuery = t.Object({
  sourceId: t.Optional(t.Numeric({ minimum: 1 })),
  approvedOnly: t.Optional(t.Union([t.Literal('true'), t.Literal('false')])),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
  offset: t.Optional(t.Numeric({ minimum: 0 })),
})

export const trackQuery = t.Object({
  distributionId: t.Optional(t.Numeric({ minimum: 1 })),
})

export type ClipListQuery = typeof clipListQuery.static
export type TrackQuery = typeof trackQuery.static
