import { sql } from 'drizzle-orm'
import type { SentimentLabel } from '@media-intel/types'
import { db } from '../../db'
import { rebuildClusters, type ClusteringResult } from '../clusters/clustering'
import { scanForSpikes } from '../alerts/service'

type Row = Record<string, unknown>

interface DemoTopic {
  key: string
  headline: string
  titles: string[]
  content: string
  sentimentPattern: SentimentLabel[]
  persons: string[]
  organizations: string[]
  locations: string[]
  recentMinutes: number
}

const DEMO_TOPICS: DemoTopic[] = [
  {
    key: 'rupiah',
    headline: 'Rupiah',
    recentMinutes: 180,
    titles: [
      'Rupiah Melemah ke Rp16.480 per Dolar AS, Bank Indonesia Buka Suara',
      'Nilai Tukar Rupiah Tertekan Sentimen The Fed, Analis Sebut Masih Wajar',
      'Bank Indonesia Pastikan Stabilisasi Rupiah Lewat Triple Intervention',
      'Rupiah Ditutup Melemah, Pasar Menanti Data Inflasi Amerika Serikat',
      'Sri Mulyani Sebut Pelemahan Rupiah Masih Terkendali',
      'Perry Warjiyo: Cadangan Devisa Cukup untuk Jaga Stabilitas Rupiah',
      'Dolar AS Menguat, Mata Uang Asia Termasuk Rupiah Ikut Tertekan',
      'Importir Diminta Lindungi Diri dari Risiko Fluktuasi Rupiah',
      'Rupiah Berpotensi Menguat jika Inflasi AS Melandai',
      'Ekonom: Pelemahan Rupiah Bisa Tekan Harga Barang Modal',
      'Bank Indonesia Naikkan Suku Bunga Acuan untuk Jaga Rupiah',
      'Pemerintah Siapkan Insentif agar Arus Modal Asing Kembali',
    ],
    content:
      'Nilai tukar rupiah kembali menjadi sorotan pasar setelah bergerak melemah terhadap dolar Amerika Serikat. Bank Indonesia menyatakan terus melakukan intervensi di pasar spot, forward, dan surat berharga negara. Pelaku pasar mencermati arah kebijakan suku bunga The Fed serta data inflasi domestik. Kementerian Keuangan menegaskan fundamental ekonomi masih kuat dan defisit anggaran terjaga.',
    sentimentPattern: [
      'NEGATIVE', 'NEGATIVE', 'POSITIVE', 'NEGATIVE', 'NEUTRAL', 'POSITIVE',
      'NEGATIVE', 'NEUTRAL', 'POSITIVE', 'NEGATIVE', 'NEUTRAL', 'POSITIVE',
    ],
    persons: ['Sri Mulyani', 'Perry Warjiyo'],
    organizations: ['Bank Indonesia', 'Kementerian Keuangan', 'The Fed'],
    locations: ['Jakarta', 'Amerika Serikat'],
  },
  {
    key: 'bbm',
    headline: 'BBM',
    recentMinutes: 25,
    titles: [
      'Harga BBM Pertalite Naik, Warga Keluhkan Biaya Transportasi',
      'Kenaikan Harga BBM Picu Demo Mahasiswa di Depan Istana',
      'Pemerintah Bela Kenaikan BBM: Subsidi Dinilai Semakin Membebani APBN',
      'Harga Pertalite dan Solar Naik Mulai Hari Ini, Ini Rinciannya',
      'Ekonom: Kenaikan BBM Bisa Dorong Inflasi hingga 0,8 Persen',
      'SPBU Padat Jelang Kenaikan Harga BBM, Masyarakat Antre Berjam-jam',
      'Serikat Buruh Tolak Kenaikan BBM, Ancam Mogok Nasional',
      'DPR Minta Pemerintah Kaji Ulang Kenaikan Harga BBM',
      'Kenaikan BBM Tekan Daya Beli, Pedagang Kecil Mengeluh',
      'Pemerintah Janji Bantuan Langsung Tunai untuk Kelompok Rentan',
      'Harga Minyak Dunia Melonjak, Beban Subsidi Energi Bertambah',
      'Menteri ESDM Jelaskan Alasan Kenaikan Harga BBM',
    ],
    content:
      'Kenaikan harga bahan bakar minyak memicu reaksi luas di masyarakat. Pemerintah beralasan beban subsidi dan kompensasi energi semakin berat seiring pelemahan rupiah dan lonjakan harga minyak dunia. Mahasiswa dan serikat buruh turun ke jalan menolak kebijakan tersebut. Ekonom memperingatkan dampak inflasi terhadap daya beli masyarakat, sementara DPR meminta pemerintah mengkaji ulang keputusan.',
    sentimentPattern: [
      'NEGATIVE', 'NEGATIVE', 'NEGATIVE', 'NEGATIVE', 'NEGATIVE', 'NEGATIVE',
      'NEGATIVE', 'NEGATIVE', 'NEGATIVE', 'NEUTRAL', 'NEGATIVE', 'NEGATIVE',
    ],
    persons: ['Menteri ESDM', 'Presiden'],
    organizations: ['Pertamina', 'Kementerian ESDM', 'Pemerintah', 'DPR', 'Serikat Buruh'],
    locations: ['Jakarta', 'Indonesia'],
  },
  {
    key: 'pemilu',
    headline: 'Pemilu',
    recentMinutes: 200,
    titles: [
      'KPU Siapkan Tahapan Pemilu 2029, Anggaran Jadi Sorotan',
      'Parpol Mulai Jajaki Koalisi Menuju Pemilu 2029',
      'KPU Bantah Isu Kecurangan Sistem Informasi Pemilu',
      'Survei Elektabilitas Capres 2029: Tiga Nama Bersaing Ketat',
      'DPR dan KPU Bahas Revisi Undang-Undang Pemilu',
      'Bawaslu Perkuat Pengawasan Kampanye Digital',
      'Partisipasi Pemilih Muda Jadi Fokus Sosialisasi KPU',
      'Pemerintah Jamin Netralitas Aparat dalam Pemilu',
      'Pengamat: Koalisi Gemuk Berisiko Lemahkan Checks and Balances',
      'KPU Uji Coba Pemungutan Suara Elektronik di Tiga Daerah',
      'Parpol Diminta Transparan soal Sumber Dana Kampanye',
      'Debat Publik soal Ambang Batas Parlemen Memanas',
    ],
    content:
      'Tahapan menuju Pemilu 2029 mulai menjadi perhatian publik. Komisi Pemilihan Umum mematangkan regulasi dan anggaran, sementara partai politik menjajaki kemungkinan koalisi. Isu netralitas aparat, transparansi dana kampanye, dan partisipasi pemilih muda mendominasi pemberitaan. Bawaslu menekankan pengawasan kampanye di ruang digital.',
    sentimentPattern: [
      'NEUTRAL', 'NEUTRAL', 'NEGATIVE', 'POSITIVE', 'NEUTRAL', 'POSITIVE',
      'POSITIVE', 'NEUTRAL', 'NEGATIVE', 'NEUTRAL', 'NEGATIVE', 'NEGATIVE',
    ],
    persons: ['Ketua KPU', 'Presiden'],
    organizations: ['KPU', 'Bawaslu', 'DPR', 'Partai Politik'],
    locations: ['Jakarta', 'Indonesia'],
  },
  {
    key: 'banjir',
    headline: 'Banjir',
    recentMinutes: 160,
    titles: [
      'Banjir Rendam Sejumlah Ruas Jalan Jakarta Utara',
      'BPBD Jakata Kerahkan Pompa Air, Warga Mengungsi',
      'Curah Hujan Ekstrem Picu Banjir di Bekasi dan Tangerang',
      'Pemprov DKI Diminta Evaluasi Sistem Drainase',
      'Banjir Jakarta: Ribuan Warga Terdampak, Listrik Padam',
      'BMKG Peringatkan Cuaca Ekstrem Tiga Hari ke Depan',
      'Korban Banjir Mulai Terserang Penyakit Kulit',
      'Pemerintah Salurkan Bantuan Logistik ke Lokasi Banjir',
      'Ahli Tata Kota: Banjir Jakarta Bukan Sekadar Masalah Hujan',
      'Pengelolaan Sampah Dinilai Perparah Banjir',
      'Warga Pesisir Jakarta Bertahan di Rumah Meski Terendam',
      'Normalisasi Sungai Kembali Jadi Perdebatan',
    ],
    content:
      'Hujan dengan intensitas tinggi menyebabkan banjir di sejumlah wilayah Jabodetabek. BPBD mengerahkan pompa air dan perahu karet untuk evakuasi warga. BMKG mengingatkan potensi cuaca ekstrem masih berlanjut. Pemerintah daerah menghadapi kritik terkait sistem drainase dan pengelolaan sampah yang dinilai memperparah genangan.',
    sentimentPattern: [
      'NEGATIVE', 'NEGATIVE', 'NEGATIVE', 'NEGATIVE', 'NEGATIVE', 'NEGATIVE',
      'NEGATIVE', 'POSITIVE', 'NEGATIVE', 'NEGATIVE', 'NEGATIVE', 'NEUTRAL',
    ],
    persons: ['Gubernur DKI'],
    organizations: ['BPBD', 'BMKG', 'Pemprov DKI'],
    locations: ['Jakarta', 'Bekasi', 'Tangerang', 'Jabodetabek'],
  },
  {
    key: 'energi',
    headline: 'Energi Terbarukan',
    recentMinutes: 220,
    titles: [
      'Pemerintah Genjot Pembangunan PLTS Terapung di Waduk',
      'Investasi Energi Terbarukan Capai Rekor Baru',
      'PLN Targetkan Bauran Energi Bersih 23 Persen',
      'Pengamat: Transisi Energi Butuh Kepastian Regulasi',
      'Sekolah di Nusa Tenggara Gunakan Listrik Tenaga Surya',
      'Harga Panel Surya Turun, Minat Masyarakat Meningkat',
      'Pabrik Hijau Baru Serap Ribuan Tenaga Kerja',
      'Indonesia Perkuat Kerja Sama Energi Bersih dengan Jepang',
      'Potensi Panas Bumi Belum Dimaksimalkan',
      'Pemerintah Dorong Kredit Lunak untuk Kendaraan Listrik',
      'Emisi Karbon Sektor Energi Mulai Menurun',
      'Petani Manfaatkan Biogas untuk Kebutuhan Rumah Tangga',
    ],
    content:
      'Transisi menuju energi bersih terus didorong melalui pembangunan pembangkit listrik tenaga surya, panas bumi, dan biogas. Pemerintah menargetkan bauran energi terbarukan meningkat signifikan dalam beberapa tahun ke depan. Investor menyambut positif insentif fiskal, meski pelaku usaha meminta kepastian regulasi dan percepatan perizinan.',
    sentimentPattern: [
      'POSITIVE', 'POSITIVE', 'POSITIVE', 'NEUTRAL', 'POSITIVE', 'POSITIVE',
      'POSITIVE', 'POSITIVE', 'NEUTRAL', 'POSITIVE', 'POSITIVE', 'POSITIVE',
    ],
    persons: ['Menteri ESDM'],
    organizations: ['PLN', 'Kementerian ESDM', 'Pemerintah'],
    locations: ['Jakarta', 'Nusa Tenggara', 'Jepang'],
  },
]

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function topicEmbedding(topicIndex: number, noiseSeed: number): string {
  const random = mulberry32(noiseSeed)
  const vector = new Array(768).fill(0)
  const start = topicIndex * 48
  for (let i = start; i < start + 48 && i < vector.length; i += 1) {
    vector[i] = 1 + random() * 0.08
  }
  for (let i = 0; i < vector.length; i += 1) {
    if (i < start || i >= start + 48) vector[i] = random() * 0.02
  }
  return `[${vector.map((value) => value.toFixed(5)).join(',')}]`
}

const SENTIMENT_SCORE: Record<SentimentLabel, number> = {
  POSITIVE: 0.88,
  NEUTRAL: 0.62,
  NEGATIVE: 0.91,
}

export interface DemoSeedResult {
  inserted: number
  duplicatesSkipped: number
  clusters: ClusteringResult
  alertsTriggered: number
}

/**
 * Populate the dashboard with deterministic, realistic Indonesian sample data.
 * Useful for UI demos and end-to-end verification without waiting for scrapers.
 */
export async function seedDemoData(options: { generateAlerts?: boolean } = {}): Promise<DemoSeedResult> {
  const sourceRows = await db.execute(sql`
    SELECT id, name, domain FROM sources WHERE is_active = 'true' ORDER BY name ASC
  `)
  const sources = sourceRows as unknown as Array<{ id: string; name: string; domain: string }>
  if (sources.length === 0) {
    throw Object.assign(
      new Error('Belum ada sumber media. Jalankan `bun run db:seed` terlebih dahulu.'),
      { status: 409 },
    )
  }

  const now = Date.now()
  let inserted = 0
  let duplicatesSkipped = 0

  for (const [topicIndex, topic] of DEMO_TOPICS.entries()) {
    for (let index = 0; index < topic.titles.length; index += 1) {
      const source = sources[(topicIndex + index) % sources.length]!
      const sentiment = topic.sentimentPattern[index % topic.sentimentPattern.length]!
      const isRecent = index < 8
      const minutesAgo = isRecent
        ? Math.round((topic.recentMinutes / 8) * index + 1)
        : topic.recentMinutes + (index - 7) * 150
      const publishedAt = new Date(now - minutesAgo * 60 * 1000)
      const externalId = `demo:${topic.key}:${index}`
      const embedding = topicEmbedding(topicIndex, 991 + topicIndex * 100 + index)
      const entities = JSON.stringify({
        persons: topic.persons,
        organizations: topic.organizations,
        locations: topic.locations,
      })
      const title = topic.titles[index]!
      const author = `Redaksi ${source.name}`

      const result = await db.execute(sql`
        INSERT INTO media_items (
          source_id, platform, external_id, url, author, title, raw_content,
          clean_content, sentiment, sentiment_score, entities, embedding, published_at
        ) VALUES (
          ${source.id}::uuid, 'NEWS_MEDIA', ${externalId},
          ${`https://demo.media-intel.local/${topic.key}/${index}`},
          ${author}, ${title}, ${topic.content}, ${topic.content},
          ${sentiment}::sentiment_label, ${SENTIMENT_SCORE[sentiment]},
          ${entities}::jsonb, ${embedding}::vector, ${publishedAt.toISOString()}
        )
        ON CONFLICT (external_id) DO NOTHING
        RETURNING id
      `)
      if ((result as Row[]).length > 0) inserted += 1
      else duplicatesSkipped += 1
    }
  }

  const clusters = await rebuildClusters({ windowHours: 24, minItems: 5 })
  const scan = options.generateAlerts === false ? null : await scanForSpikes()

  return {
    inserted,
    duplicatesSkipped,
    clusters,
    alertsTriggered: scan?.triggered ?? 0,
  }
}
