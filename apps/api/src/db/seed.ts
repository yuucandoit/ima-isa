import { sqlClient } from './index'

const googleNews = (domain: string) =>
  `https://news.google.com/rss/search?q=site:${domain}&hl=id&gl=ID&ceid=ID:id`

/**
 * The 10 Indonesian outlets that anchor the ingestion matrix.
 * `domain` is the dedupe namespace and the attribution key; `rssUrl` is what the
 * Python poller actually fetches (several outlets front their own RSS with a
 * Cloudflare bot wall, so a Google News site-scoped mirror is used instead).
 */
export const SEED_SOURCES = [
  { name: 'Kompas.com', domain: 'kompas.com', rssUrl: googleNews('kompas.com') },
  { name: 'Tempo.co', domain: 'tempo.co', rssUrl: 'https://rss.tempo.co/nasional' },
  {
    name: 'CNN Indonesia',
    domain: 'cnnindonesia.com',
    rssUrl: 'https://www.cnnindonesia.com/nasional/rss',
  },
  { name: 'Detik.com', domain: 'detik.com', rssUrl: googleNews('detik.com') },
  {
    name: 'Tribunnews.com',
    domain: 'tribunnews.com',
    rssUrl: 'https://www.tribunnews.com/rss',
  },
  {
    name: 'Kumparan.com',
    domain: 'kumparan.com',
    rssUrl: 'https://lapi.kumparan.com/v2.0/rss',
  },
  { name: 'Tirto.id', domain: 'tirto.id', rssUrl: 'https://tirto.id/rss' },
  {
    name: 'BBC News Indonesia',
    domain: 'bbc.com',
    rssUrl: 'https://feeds.bbci.co.uk/indonesia/rss.xml',
  },
  { name: 'Bisnis.com', domain: 'bisnis.com', rssUrl: 'https://www.bisnis.com/rss' },
  {
    name: 'CNBC Indonesia',
    domain: 'cnbcindonesia.com',
    rssUrl: 'https://www.cnbcindonesia.com/rss',
  },
] as const

export const SEED_KEYWORDS = [
  {
    label: 'Ekonomi & Rupiah',
    booleanQuery: 'rupiah OR inflasi OR "bank indonesia" OR ekonomi',
  },
  {
    label: 'Politik Nasional',
    booleanQuery: '(pemilu OR presiden OR dpr) AND NOT hoaks',
  },
  {
    label: 'Energi & BBM',
    booleanQuery: 'bbm OR pertalite OR "energi baru" OR listrik',
  },
  {
    label: 'Krisis & Bencana',
    booleanQuery: 'banjir OR gempa OR kebakaran OR darurat',
  },
] as const

async function seed() {
  console.log('▸ Seeding 10 sumber media…')
  for (const source of SEED_SOURCES) {
    await sqlClient`
      INSERT INTO sources (name, domain, platform, rss_url, is_active)
      VALUES (${source.name}, ${source.domain}, 'NEWS_MEDIA', ${source.rssUrl}, 'true')
      ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name, rss_url = EXCLUDED.rss_url
    `
  }

  console.log('▸ Seeding kata kunci pantauan…')
  const existing = await sqlClient<{ count: string }[]>`
    SELECT count(*)::text AS count FROM monitored_keywords
  `
  if (Number(existing[0]?.count ?? 0) === 0) {
    for (const keyword of SEED_KEYWORDS) {
      await sqlClient`
        INSERT INTO monitored_keywords (label, boolean_query, is_active)
        VALUES (${keyword.label}, ${keyword.booleanQuery}, 'true')
      `
    }
  }

  const count = await sqlClient<{ sources: string; keywords: string }[]>`
    SELECT
      (SELECT count(*) FROM sources)::text AS sources,
      (SELECT count(*) FROM monitored_keywords)::text AS keywords
  `
  console.log(
    `✓ Seed selesai — ${count[0]?.sources} sumber, ${count[0]?.keywords} kata kunci.`,
  )
  await sqlClient.end()
}

await seed()
