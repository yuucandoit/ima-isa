import type { ClusterDTO, MediaItemDTO } from '@media-intel/types'
import { chatComplete, llmSummary, type LlmProvider } from './llm'

export interface SummaryOutput {
  summary: string
  model: string
  provider: LlmProvider
  fallback: boolean
}

const SYSTEM_PROMPT = `Anda adalah analis intelijen media senior Indonesia. Tugas Anda menulis executive briefing yang padat, faktual, dan netral untuk pimpinan redaksi / manajemen krisis.
Aturan:
- Gunakan Bahasa Indonesia formal.
- Jangan berhalusinasi. Hanya gunakan fakta dari artikel yang diberikan.
- Selalu sertakan sitasi nama portal di dalam tanda kurung, contoh (Kompas.com).
- Struktur wajib: **Latar Belakang**, **Eskalasi**, **Respons Pihak Terkait**, **Sumber Rujukan**.
- Maksimum 220 kata.
- Jangan tulis proses berpikir, analisis internal, atau draf. Langsung tulis hasil akhir.`

function buildUserPrompt(cluster: ClusterDTO, articles: MediaItemDTO[]): string {
  const lines = articles
    .slice(0, 8)
    .map((article, index) => {
      const source = article.sourceName ?? article.sourceDomain ?? 'Media'
      const date = new Date(article.publishedAt).toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta',
      })
      const excerpt = article.cleanContent.replace(/\s+/g, ' ').slice(0, 400)
      return `${index + 1}. [${source}, ${date}] ${article.title}\n   ${excerpt}`
    })
    .join('\n')

  return `Klaster isu: ${cluster.title}
Jumlah artikel: ${cluster.totalArticles} dari ${cluster.sourceCount} portal.
Sentimen dominan: ${cluster.dominantSentiment ?? 'NEUTRAL'}.
Rentang waktu: ${new Date(cluster.firstSeenAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} — ${new Date(cluster.lastUpdated).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}.

Artikel:
${lines}

Tulis executive briefing sesuai struktur yang diminta.`
}

function extractiveFallback(cluster: ClusterDTO, articles: MediaItemDTO[]): string {
  const sources = [...new Set(articles.map((a) => a.sourceName ?? a.sourceDomain ?? 'Media'))]
  const negatives = articles.filter((a) => a.sentiment === 'NEGATIVE').length
  const start = new Date(cluster.firstSeenAt).toLocaleString('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  })
  const headlines = articles
    .slice(0, 5)
    .map((a) => `- ${a.title} (${a.sourceName ?? a.sourceDomain ?? 'Media'})`)
    .join('\n')

  return `**Latar Belakang**
Isu "${cluster.title}" terdeteksi pada ${start} WIB dan telah diberitakan oleh ${sources.length} portal (${sources.slice(0, 5).join(', ')}). Total ${cluster.totalArticles} artikel tergabung dalam klaster ini.

**Eskalasi**
Dari ${articles.length} artikel terbaru, ${negatives} bernada negatif dengan sentimen dominan ${cluster.dominantSentiment ?? 'NEUTRAL'}. Volume pemberitaan perlu dipantau untuk mendeteksi lonjakan lebih lanjut.

**Respons Pihak Terkait**
Belum ada pernyataan resmi yang terverifikasi di dalam klaster ini. Analis disarankan melakukan konfirmasi ke kanal resmi instansi terkait.

**Sumber Rujukan**
${headlines}

_Ringkasan ini dihasilkan secara ekstraktif karena LLM eksternal belum dikonfigurasi atau tidak dapat dihubungi._`
}

/**
 * Minta executive briefing dari LLM eksternal yang dikonfigurasi di `.env`
 * (`LLM_URL` bisa berupa endpoint OpenAI-compatible penuh atau base `/v1`).
 * Bila belum dikonfigurasi / gagal, pakai ringkasan ekstraktif deterministik
 * agar dashboard tetap berfungsi tanpa model lokal.
 */
export async function generateClusterSummary(
  cluster: ClusterDTO,
  articles: MediaItemDTO[],
): Promise<SummaryOutput> {
  if (articles.length === 0) {
    return {
      summary: extractiveFallback(cluster, articles),
      model: 'extractive-fallback',
      provider: llmSummary().provider,
      fallback: true,
    }
  }

  try {
    const result = await chatComplete([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(cluster, articles) },
    ])

    return {
      summary: result.text,
      model: result.model,
      provider: result.provider,
      fallback: false,
    }
  } catch (error) {
    console.warn(
      '[llm] fallback extractive:',
      error instanceof Error ? error.message : String(error),
    )
    return {
      summary: extractiveFallback(cluster, articles),
      model: 'extractive-fallback',
      provider: llmSummary().provider,
      fallback: true,
    }
  }
}
