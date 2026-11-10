import { sql } from 'drizzle-orm'
import type { MediaItemDTO, SentimentLabel } from '@media-intel/types'
import { db } from '../../db'
import { toMediaItemDTO } from '../../lib/serialize'
import { sseHub } from '../../lib/sse'
import { getPublisher } from '../../lib/redis'

/**
 * Cosine distances are backend dependent: transformer embeddings (IndoBERT)
 * place same-topic copy at ~0.10–0.20 while the Python lexical fallback lands
 * around 0.35–0.55. The worker publishes its active backend to
 * `nlp:embedding_mode`; when `CLUSTER_DISTANCE_THRESHOLD` is unset (or 0) we
 * pick the matching default instead of hard-coding a value.
 */
const AUTO_THRESHOLDS: Record<string, number> = { transformer: 0.25, lexical: 0.62 }
const DEFAULT_EMBEDDING_MODE = 'transformer'

export async function resolveDistanceThreshold(): Promise<number> {
  const configured = Number(process.env.CLUSTER_DISTANCE_THRESHOLD ?? 0)
  if (Number.isFinite(configured) && configured > 0) return configured

  const publisher = getPublisher()
  if (!publisher) return AUTO_THRESHOLDS[DEFAULT_EMBEDDING_MODE]!
  try {
    const mode = (await publisher.get('nlp:embedding_mode')) ?? DEFAULT_EMBEDDING_MODE
    return AUTO_THRESHOLDS[mode] ?? AUTO_THRESHOLDS[DEFAULT_EMBEDDING_MODE]!
  } catch {
    return AUTO_THRESHOLDS[DEFAULT_EMBEDDING_MODE]!
  }
}

type Row = Record<string, unknown>

export interface ClusteringOptions {
  windowHours?: number
  distanceThreshold?: number
  minItems?: number
  maxSpanHours?: number
}

export interface ClusteringResult {
  scanned: number
  assignedToExisting: number
  clustersCreated: number
  clustersUpdated: number
  skipped: number
  distanceThreshold: number
}

function parseVector(value: string | null | undefined): number[] | null {
  if (!value) return null
  const trimmed = value.trim().replace(/^\[|\]$/g, '')
  if (!trimmed) return null
  const values = trimmed.split(',').map(Number)
  return values.every((entry) => Number.isFinite(entry)) ? values : null
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) return 1
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value.toFixed(6))).join(',')}]`
}

function weightedAverageVector(centroid: number[], weight: number, vector: number[]): number[] {
  const result = new Array(centroid.length).fill(0)
  const nextWeight = weight + 1
  for (let i = 0; i < result.length; i += 1) {
    result[i] = (centroid[i]! * weight + vector[i]!) / nextWeight
  }
  return result
}

function averageVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const result = new Array(vectors[0]!.length).fill(0)
  for (const vector of vectors) {
    for (let i = 0; i < result.length; i += 1) result[i] += vector[i]!
  }
  return result.map((value) => value / vectors.length)
}

function dominantSentiment(items: MediaItemDTO[]): SentimentLabel {
  const scores = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 }
  for (const item of items) scores[item.sentiment] += 1
  return (Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'NEUTRAL') as SentimentLabel
}

const GENERIC_ORGANIZATIONS = new Set([
  'pemerintah', 'dpr', 'dprd', 'mpr', 'bumn', 'partai politik', 'istana',
  'pemerintah provinsi dki jakarta', 'pemprov dki', 'pemkot', 'pemkab',
])

function titleFor(items: MediaItemDTO[]): string {
  const entityCounts = new Map<string, number>()
  for (const item of items) {
    for (const person of item.entities.persons) {
      entityCounts.set(person, (entityCounts.get(person) ?? 0) + 2)
    }
    for (const org of item.entities.organizations) {
      const weight = GENERIC_ORGANIZATIONS.has(org.toLowerCase()) ? 0.25 : 3
      entityCounts.set(org, (entityCounts.get(org) ?? 0) + weight)
    }
    for (const location of item.entities.locations) {
      entityCounts.set(location, (entityCounts.get(location) ?? 0) + 1)
    }
  }
  const ranked = [...entityCounts.entries()].sort((a, b) => b[1] - a[1])
  if (ranked[0]) {
    const secondary = ranked[1]
    return secondary ? `${ranked[0][0]} & ${secondary[0]}` : ranked[0][0]
  }

  const stopwords = new Set([
    'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'akan', 'ini', 'itu',
    'tidak', 'bisa', 'jadi', 'ada', 'juga', 'kata', 'dalam', 'atau', 'the', 'an',
  ])
  const frequency = new Map<string, number>()
  for (const item of items) {
    const words = item.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 4 && !stopwords.has(word))
    for (const word of words) frequency.set(word, (frequency.get(word) ?? 0) + 1)
  }
  const topWords = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word)
  return topWords.length > 0
    ? topWords.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' · ')
    : items[0]?.title.slice(0, 80) ?? 'Klaster isu'
}

interface WorkingItem {
  id: string
  vector: number[]
  publishedAt: Date
  sourceId: string | null
  dto: MediaItemDTO
}

interface WorkingCluster {
  id?: string
  centroid: number[]
  weight: number
  firstSeenAt: Date
  lastSeenAt: Date
  items: WorkingItem[]
}

/**
 * Incremental semantic clustering over pgvector embeddings.
 * A candidate is attached to the nearest centroid when cosine distance < 0.25
 * and the cluster's lifespan stays inside `maxSpanHours`.
 */
export async function rebuildClusters(options: ClusteringOptions = {}): Promise<ClusteringResult> {
  const windowHours = options.windowHours ?? Number(process.env.CLUSTER_WINDOW_HOURS ?? 24)
  const distanceThreshold = options.distanceThreshold ?? (await resolveDistanceThreshold())
  const minItems = options.minItems ?? Number(process.env.CLUSTER_MIN_ITEMS ?? 5)
  const maxSpanHours = options.maxSpanHours ?? 4
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const [itemRows, clusterRows] = await Promise.all([
    db.execute(sql`
      SELECT mi.*, s.name AS source_name, s.domain AS source_domain,
             mi.embedding::text AS embedding_text
      FROM media_items mi
      LEFT JOIN sources s ON s.id = mi.source_id
      WHERE mi.published_at >= ${since.toISOString()}
        AND mi.embedding IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM cluster_items ci WHERE ci.media_item_id = mi.id)
      ORDER BY mi.published_at ASC
    `),
    db.execute(sql`
      SELECT c.id, c.centroid::text AS centroid_text, c.total_articles,
             c.first_seen_at, c.last_updated
      FROM topic_clusters c
      WHERE c.last_updated >= ${new Date(Date.now() - windowHours * 2 * 60 * 60 * 1000).toISOString()}
        AND c.centroid IS NOT NULL
    `),
  ])

  const working: WorkingCluster[] = []
  for (const row of clusterRows as Row[]) {
    const centroid = parseVector(row.centroid_text as string)
    if (!centroid) continue
    working.push({
      id: row.id as string,
      centroid,
      weight: Number(row.total_articles ?? 1),
      firstSeenAt: new Date(row.first_seen_at as string),
      lastSeenAt: new Date(row.last_updated as string),
      items: [],
    })
  }

  const scannedItems: WorkingItem[] = []
  for (const row of itemRows as Row[]) {
    const vector = parseVector(row.embedding_text as string)
    if (!vector) continue
    scannedItems.push({
      id: row.id as string,
      vector,
      publishedAt: new Date(row.published_at as string),
      sourceId: (row.source_id as string | null) ?? null,
      dto: toMediaItemDTO(row as never),
    })
  }

  for (const item of scannedItems) {
    let best: { cluster: WorkingCluster; distance: number } | null = null

    for (const cluster of working) {
      const spanHours =
        (item.publishedAt.getTime() - cluster.firstSeenAt.getTime()) / (60 * 60 * 1000)
      if (spanHours > maxSpanHours) continue
      const distance = cosineDistance(item.vector, cluster.centroid)
      if (distance <= distanceThreshold && (!best || distance < best.distance)) {
        best = { cluster, distance }
      }
    }

    if (best) {
      const cluster = best.cluster
      cluster.centroid = weightedAverageVector(cluster.centroid, cluster.weight, item.vector)
      cluster.weight += 1
      cluster.items.push(item)
      if (item.publishedAt > cluster.lastSeenAt) cluster.lastSeenAt = item.publishedAt
    } else {
      working.push({
        centroid: [...item.vector],
        weight: 1,
        firstSeenAt: item.publishedAt,
        lastSeenAt: item.publishedAt,
        items: [item],
      })
    }
  }

  let clustersCreated = 0
  let clustersUpdated = 0
  let assignedToExisting = 0
  let skipped = 0

  for (const cluster of working) {
    if (cluster.items.length === 0) continue
    const distinctSources = new Set(cluster.items.map((item) => item.sourceId).filter(Boolean)).size

    if (!cluster.id) {
      if (cluster.items.length < minItems || distinctSources < 2) {
        skipped += cluster.items.length
        continue
      }

      const items = cluster.items.map((item) => item.dto)
      const centroid = averageVector(cluster.items.map((item) => item.vector))
      const inserted = await db.execute(sql`
        INSERT INTO topic_clusters
          (title, dominant_sentiment, total_articles, centroid, first_seen_at, last_updated)
        VALUES
          (${titleFor(items)}, ${dominantSentiment(items)}::sentiment_label, ${items.length},
           ${toVectorLiteral(centroid)}::vector, ${cluster.firstSeenAt.toISOString()},
           ${cluster.lastSeenAt.toISOString()})
        RETURNING id
      `)
      const clusterId = (inserted as Row[])[0]?.id as string
      for (const item of cluster.items) {
        await db.execute(sql`
          INSERT INTO cluster_items (cluster_id, media_item_id)
          VALUES (${clusterId}::uuid, ${item.id}::uuid)
          ON CONFLICT DO NOTHING
        `)
      }
      clustersCreated += 1
      continue
    }

    for (const item of cluster.items) {
      await db.execute(sql`
        INSERT INTO cluster_items (cluster_id, media_item_id)
        VALUES (${cluster.id}::uuid, ${item.id}::uuid)
        ON CONFLICT DO NOTHING
      `)
    }
    assignedToExisting += cluster.items.length

    const aggregate = await db.execute(sql`
      SELECT
        count(*)::int AS total,
        avg(mi.embedding)::text AS centroid,
        min(mi.published_at) AS first_seen,
        max(mi.published_at) AS last_seen
      FROM cluster_items ci JOIN media_items mi ON mi.id = ci.media_item_id
      WHERE ci.cluster_id = ${cluster.id}::uuid
    `)
    const agg = (aggregate[0] ?? {}) as Row
    const total = Number(agg.total ?? 0)
    if (total < minItems) {
      skipped += cluster.items.length
      continue
    }

    const memberRows = await db.execute(sql`
      SELECT mi.*, s.name AS source_name, s.domain AS source_domain
      FROM cluster_items ci
      JOIN media_items mi ON mi.id = ci.media_item_id
      LEFT JOIN sources s ON s.id = mi.source_id
      WHERE ci.cluster_id = ${cluster.id}::uuid
      ORDER BY mi.published_at DESC
      LIMIT 30
    `)
    const members = (memberRows as Row[]).map((row) => toMediaItemDTO(row as never))

    await db.execute(sql`
      UPDATE topic_clusters SET
        title = ${titleFor(members)},
        dominant_sentiment = ${dominantSentiment(members)}::sentiment_label,
        total_articles = ${total},
        centroid = ${(agg.centroid as string) ?? toVectorLiteral(cluster.centroid)}::vector,
        first_seen_at = ${new Date(agg.first_seen as string).toISOString()},
        last_updated = ${new Date(agg.last_seen as string).toISOString()}
      WHERE id = ${cluster.id}::uuid
    `)
    clustersUpdated += 1
  }

  const result: ClusteringResult = {
    scanned: scannedItems.length,
    assignedToExisting,
    clustersCreated,
    clustersUpdated,
    skipped,
    distanceThreshold: Number(distanceThreshold.toFixed(2)),
  }

  if (clustersCreated > 0 || clustersUpdated > 0) {
    const payload = { ...result, updatedAt: new Date().toISOString() }
    sseHub.broadcast('cluster', payload, 'clusters')
    await getPublisher()?.publish('clusters:updated', JSON.stringify(payload)).catch(() => 0)
  }

  return result
}
