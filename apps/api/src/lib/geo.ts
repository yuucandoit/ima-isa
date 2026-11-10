/**
 * Katalog koordinat statis untuk lokasi yang diekstrak NER.
 * Sengaja tanpa geocoding API agar peta tetap cepat, deterministik, dan offline.
 * Nama kanonik dipakai sebagai label peta; alias menangani variasi ejaan.
 */

export interface Coordinates {
  lat: number
  lon: number
}

interface GeoEntry extends Coordinates {
  name: string
  aliases?: string[]
}

const ENTRIES: GeoEntry[] = [
  // ── Nasional ────────────────────────────────────────────────
  { name: 'Indonesia', lat: -2.5489, lon: 118.0149, aliases: ['nusantara', 'nkri', 'republik indonesia'] },

  // Jakarta & sekitarnya
  { name: 'Jakarta', lat: -6.2088, lon: 106.8456, aliases: ['dki jakarta', 'jakarta raya', 'jabodetabek', 'jabodetabekpunjur'] },
  { name: 'Jakarta Pusat', lat: -6.1805, lon: 106.8284 },
  { name: 'Jakarta Selatan', lat: -6.2615, lon: 106.8106 },
  { name: 'Jakarta Barat', lat: -6.1683, lon: 106.7588 },
  { name: 'Jakarta Timur', lat: -6.225, lon: 106.9004 },
  { name: 'Jakarta Utara', lat: -6.1214, lon: 106.7741 },
  { name: 'Bogor', lat: -6.5971, lon: 106.806 },
  { name: 'Depok', lat: -6.4025, lon: 106.7942 },
  { name: 'Tangerang', lat: -6.1781, lon: 106.63 },
  { name: 'Tangerang Selatan', lat: -6.2886, lon: 106.7179 },
  { name: 'Bekasi', lat: -6.2383, lon: 106.9756 },

  // Jawa Barat
  { name: 'Jawa Barat', lat: -6.9147, lon: 107.6098, aliases: ['jabar', 'jawa barat'] },
  { name: 'Bandung', lat: -6.9175, lon: 107.6191 },
  { name: 'Cimahi', lat: -6.8722, lon: 107.5425 },
  { name: 'Sukabumi', lat: -6.9277, lon: 106.93 },
  { name: 'Cianjur', lat: -6.8168, lon: 107.1425 },
  { name: 'Tasikmalaya', lat: -7.3274, lon: 108.2207 },
  { name: 'Cirebon', lat: -6.732, lon: 108.552 },
  { name: 'Karawang', lat: -6.3015, lon: 107.306 },
  { name: 'Purwakarta', lat: -6.5569, lon: 107.443 },
  { name: 'Subang', lat: -6.5714, lon: 107.758 },
  { name: 'Sumedang', lat: -6.858, lon: 107.92 },
  { name: 'Garut', lat: -7.2279, lon: 107.9087 },
  { name: 'Indramayu', lat: -6.326, lon: 108.324 },
  { name: 'Majalengka', lat: -6.836, lon: 108.227 },

  // Jawa Tengah & DIY
  { name: 'Jawa Tengah', lat: -7.151, lon: 110.14, aliases: ['jateng'] },
  { name: 'Semarang', lat: -6.9932, lon: 110.4203 },
  { name: 'Surakarta', lat: -7.5755, lon: 110.8243, aliases: ['solo'] },
  { name: 'Magelang', lat: -7.4698, lon: 110.2177 },
  { name: 'Purwokerto', lat: -7.4249, lon: 109.2302 },
  { name: 'Tegal', lat: -6.8694, lon: 109.1402 },
  { name: 'Pekalongan', lat: -6.8886, lon: 109.6753 },
  { name: 'Kudus', lat: -6.8048, lon: 110.8405 },
  { name: 'Jepara', lat: -6.5892, lon: 110.6782 },
  { name: 'Klaten', lat: -7.7059, lon: 110.606 },
  { name: 'Salatiga', lat: -7.3305, lon: 110.5084 },
  { name: 'Cilacap', lat: -7.7267, lon: 109.0093 },
  { name: 'Yogyakarta', lat: -7.7956, lon: 110.3695, aliases: ['jogja', 'jogjakarta', 'di yogyakarta', 'd.i. yogyakarta', 'daerah istimewa yogyakarta'] },
  { name: 'Sleman', lat: -7.7169, lon: 110.3554 },
  { name: 'Bantul', lat: -7.888, lon: 110.328 },
  { name: 'Gunungkidul', lat: -7.983, lon: 110.604 },
  { name: 'Kulon Progo', lat: -7.826, lon: 110.164 },

  // Jawa Timur
  { name: 'Jawa Timur', lat: -7.5361, lon: 112.2384, aliases: ['jatim'] },
  { name: 'Surabaya', lat: -7.2575, lon: 112.7521 },
  { name: 'Malang', lat: -7.9666, lon: 112.6326 },
  { name: 'Kediri', lat: -7.848, lon: 112.0178 },
  { name: 'Jember', lat: -8.1689, lon: 113.702 },
  { name: 'Banyuwangi', lat: -8.2192, lon: 114.369 },
  { name: 'Sidoarjo', lat: -7.4478, lon: 112.7183 },
  { name: 'Gresik', lat: -7.1566, lon: 112.655 },
  { name: 'Madiun', lat: -7.6298, lon: 111.5239 },
  { name: 'Mojokerto', lat: -7.4705, lon: 112.4338 },
  { name: 'Pasuruan', lat: -7.6469, lon: 112.9075 },
  { name: 'Probolinggo', lat: -7.7543, lon: 113.2159 },
  { name: 'Blitar', lat: -8.0955, lon: 112.161 },
  { name: 'Tuban', lat: -6.8976, lon: 112.064 },
  { name: 'Lamongan', lat: -7.118, lon: 112.415 },
  { name: 'Ponorogo', lat: -7.865, lon: 111.462 },
  { name: 'Bojonegoro', lat: -7.1502, lon: 111.881 },

  // Banten
  { name: 'Banten', lat: -6.4058, lon: 106.064 },
  { name: 'Serang', lat: -6.1104, lon: 106.1503 },
  { name: 'Cilegon', lat: -6.0027, lon: 106.0114 },
  { name: 'Pandeglang', lat: -6.3087, lon: 106.105 },
  { name: 'Lebak', lat: -6.564, lon: 106.252 },

  // Bali & Nusa Tenggara
  { name: 'Bali', lat: -8.4095, lon: 115.1889 },
  { name: 'Denpasar', lat: -8.6705, lon: 115.2126 },
  { name: 'Badung', lat: -8.581, lon: 115.177 },
  { name: 'Gianyar', lat: -8.544, lon: 115.325 },
  { name: 'Buleleng', lat: -8.19, lon: 115.13 },
  { name: 'Tabanan', lat: -8.539, lon: 115.125 },
  { name: 'Karangasem', lat: -8.45, lon: 115.6 },
  { name: 'Klungkung', lat: -8.54, lon: 115.404 },
  { name: 'Bangli', lat: -8.454, lon: 115.354 },
  { name: 'Jembrana', lat: -8.36, lon: 114.65 },
  { name: 'Nusa Tenggara Barat', lat: -8.6529, lon: 117.3616, aliases: ['ntb'] },
  { name: 'Mataram', lat: -8.5833, lon: 116.1167 },
  { name: 'Lombok', lat: -8.65, lon: 116.324 },
  { name: 'Bima', lat: -8.46, lon: 118.726 },
  { name: 'Sumbawa', lat: -8.5, lon: 117.425 },
  { name: 'Nusa Tenggara Timur', lat: -8.6574, lon: 121.0794, aliases: ['ntt'] },
  { name: 'Kupang', lat: -10.1772, lon: 123.607 },
  { name: 'Flores', lat: -8.657, lon: 121.0 },
  { name: 'Sumba', lat: -9.65, lon: 119.85 },
  { name: 'Timor', lat: -9.5, lon: 124.5, aliases: ['timor leste', 'timor-leste'] },

  // Aceh & Sumatera
  { name: 'Aceh', lat: 4.6951, lon: 96.7494, aliases: ['nanggroe aceh darussalam'] },
  { name: 'Banda Aceh', lat: 5.5483, lon: 95.3238 },
  { name: 'Lhokseumawe', lat: 5.1801, lon: 97.1507 },
  { name: 'Langsa', lat: 4.468, lon: 97.968 },
  { name: 'Meulaboh', lat: 4.136, lon: 96.128 },
  { name: 'Sabang', lat: 5.893, lon: 95.321 },
  { name: 'Sumatera Utara', lat: 2.1154, lon: 99.5451, aliases: ['sumatra utara', 'sumut'] },
  { name: 'Medan', lat: 3.5952, lon: 98.6722 },
  { name: 'Binjai', lat: 3.6, lon: 98.485 },
  { name: 'Pematangsiantar', lat: 2.9595, lon: 99.0687 },
  { name: 'Tebing Tinggi', lat: 3.328, lon: 99.162 },
  { name: 'Deli Serdang', lat: 3.55, lon: 98.68 },
  { name: 'Karo', lat: 3.1, lon: 98.4 },
  { name: 'Simalungun', lat: 2.9, lon: 99.0 },
  { name: 'Nias', lat: 1.1, lon: 97.6 },
  { name: 'Labuhanbatu', lat: 2.3, lon: 100.0 },
  { name: 'Sumatera Barat', lat: -0.7399, lon: 100.8, aliases: ['sumatra barat', 'sumbar'] },
  { name: 'Padang', lat: -0.9471, lon: 100.4172 },
  { name: 'Bukittinggi', lat: -0.305, lon: 100.369 },
  { name: 'Payakumbuh', lat: -0.229, lon: 100.632 },
  { name: 'Solok', lat: -0.789, lon: 100.654 },
  { name: 'Pariaman', lat: -0.626, lon: 100.12 },
  { name: 'Agam', lat: -0.25, lon: 100.15 },
  { name: 'Tanah Datar', lat: -0.45, lon: 100.55 },
  { name: 'Riau', lat: 0.2933, lon: 101.7068 },
  { name: 'Pekanbaru', lat: 0.5071, lon: 101.4478 },
  { name: 'Dumai', lat: 1.6667, lon: 101.45 },
  { name: 'Bengkalis', lat: 1.47, lon: 102.1 },
  { name: 'Kampar', lat: 0.3, lon: 101.1 },
  { name: 'Indragiri', lat: 0.3, lon: 102.5 },
  { name: 'Kepulauan Riau', lat: 3.945, lon: 108.1429, aliases: ['kepri'] },
  { name: 'Batam', lat: 1.0456, lon: 104.0305 },
  { name: 'Tanjungpinang', lat: 0.9186, lon: 104.4667 },
  { name: 'Bintan', lat: 1.0, lon: 104.5 },
  { name: 'Karimun', lat: 0.8, lon: 103.4 },
  { name: 'Jambi', lat: -1.6101, lon: 103.6131 },
  { name: 'Sungai Penuh', lat: -2.056, lon: 101.391 },
  { name: 'Bengkulu', lat: -3.7928, lon: 102.2608 },
  { name: 'Rejang Lebong', lat: -3.45, lon: 102.6 },
  { name: 'Sumatera Selatan', lat: -3.3194, lon: 103.9144, aliases: ['sumatra selatan', 'sumsel'] },
  { name: 'Palembang', lat: -2.9761, lon: 104.7754 },
  { name: 'Prabumulih', lat: -3.432, lon: 104.235 },
  { name: 'Lubuklinggau', lat: -3.296, lon: 102.861 },
  { name: 'Pagar Alam', lat: -4.02, lon: 103.25 },
  { name: 'Ogan Ilir', lat: -3.2, lon: 104.6 },
  { name: 'Musi Banyuasin', lat: -2.5, lon: 103.8 },
  { name: 'Bangka Belitung', lat: -2.7411, lon: 106.4406, aliases: ['babel'] },
  { name: 'Pangkalpinang', lat: -2.129, lon: 106.113 },
  { name: 'Belitung', lat: -2.85, lon: 107.9 },
  { name: 'Bangka', lat: -2.1, lon: 106.0 },
  { name: 'Lampung', lat: -4.5586, lon: 105.4068 },
  { name: 'Bandar Lampung', lat: -5.3971, lon: 105.2668 },
  { name: 'Metro', lat: -5.113, lon: 105.306 },
  { name: 'Lampung Selatan', lat: -5.6, lon: 105.4 },

  // Kalimantan
  { name: 'Kalimantan', lat: -0.5, lon: 114.0 },
  { name: 'Kalimantan Barat', lat: -0.2788, lon: 111.4753, aliases: ['kalbar'] },
  { name: 'Pontianak', lat: -0.0263, lon: 109.3425 },
  { name: 'Singkawang', lat: 0.9, lon: 108.98 },
  { name: 'Ketapang', lat: -1.85, lon: 109.98 },
  { name: 'Sintang', lat: 0.07, lon: 111.5 },
  { name: 'Sambas', lat: 1.36, lon: 109.3 },
  { name: 'Kalimantan Tengah', lat: -1.6815, lon: 113.3824, aliases: ['kalteng'] },
  { name: 'Palangka Raya', lat: -2.208, lon: 113.916 },
  { name: 'Sampit', lat: -2.533, lon: 112.95 },
  { name: 'Pangkalan Bun', lat: -2.683, lon: 111.633 },
  { name: 'Kalimantan Selatan', lat: -3.0926, lon: 115.2838, aliases: ['kalsel'] },
  { name: 'Banjarmasin', lat: -3.3186, lon: 114.5944 },
  { name: 'Banjarbaru', lat: -3.457, lon: 114.81 },
  { name: 'Martapura', lat: -3.41, lon: 114.85 },
  { name: 'Tanjung', lat: -3.93, lon: 114.75 },
  { name: 'Kalimantan Timur', lat: 1.6406, lon: 116.4194, aliases: ['kaltim'] },
  { name: 'Samarinda', lat: -0.5022, lon: 117.1536 },
  { name: 'Balikpapan', lat: -1.2379, lon: 116.8529 },
  { name: 'Bontang', lat: 0.13, lon: 117.5 },
  { name: 'Berau', lat: 2.15, lon: 117.5 },
  { name: 'Kutai Kartanegara', lat: -0.4, lon: 116.9, aliases: ['kukar'] },
  { name: 'Kalimantan Utara', lat: 3.0731, lon: 116.0414, aliases: ['kaltara'] },
  { name: 'Tarakan', lat: 3.327, lon: 117.577 },
  { name: 'Tanjung Selor', lat: 2.84, lon: 117.36 },
  { name: 'Nunukan', lat: 4.13, lon: 117.67 },
  { name: 'Malinau', lat: 3.58, lon: 116.65 },

  // Sulawesi
  { name: 'Sulawesi', lat: -2.0, lon: 121.0 },
  { name: 'Sulawesi Utara', lat: 0.6247, lon: 124.846, aliases: ['sulut'] },
  { name: 'Manado', lat: 1.4748, lon: 124.8421 },
  { name: 'Bitung', lat: 1.4404, lon: 125.1215 },
  { name: 'Tomohon', lat: 1.324, lon: 124.84 },
  { name: 'Kotamobagu', lat: 0.73, lon: 124.32 },
  { name: 'Gorontalo', lat: 0.5435, lon: 123.0568 },
  { name: 'Sulawesi Tengah', lat: -1.43, lon: 121.4456, aliases: ['sulteng'] },
  { name: 'Palu', lat: -0.8917, lon: 119.8707 },
  { name: 'Luwuk', lat: -0.94, lon: 122.79 },
  { name: 'Poso', lat: -1.4, lon: 120.75 },
  { name: 'Toli-Toli', lat: 1.04, lon: 120.8 },
  { name: 'Sulawesi Barat', lat: -2.8441, lon: 119.2321, aliases: ['sulbar'] },
  { name: 'Mamuju', lat: -2.675, lon: 118.888 },
  { name: 'Majene', lat: -3.54, lon: 118.97 },
  { name: 'Polewali Mandar', lat: -3.4, lon: 119.35 },
  { name: 'Sulawesi Selatan', lat: -3.6688, lon: 119.9741, aliases: ['sulsel'] },
  { name: 'Makassar', lat: -5.1477, lon: 119.4327, aliases: ['ujung pandang'] },
  { name: 'Parepare', lat: -4.013, lon: 119.625 },
  { name: 'Palopo', lat: -3.0, lon: 120.2 },
  { name: 'Gowa', lat: -5.2, lon: 119.45 },
  { name: 'Bone', lat: -4.54, lon: 120.33 },
  { name: 'Bulukumba', lat: -5.55, lon: 120.2 },
  { name: 'Sulawesi Tenggara', lat: -4.1449, lon: 122.1742, aliases: ['sultra'] },
  { name: 'Kendari', lat: -3.9985, lon: 122.5131 },
  { name: 'Baubau', lat: -5.47, lon: 122.63 },
  { name: 'Kolaka', lat: -4.06, lon: 121.6 },

  // Maluku & Papua
  { name: 'Maluku', lat: -3.2385, lon: 130.1453 },
  { name: 'Ambon', lat: -3.6954, lon: 128.1814 },
  { name: 'Tual', lat: -5.63, lon: 132.75 },
  { name: 'Masohi', lat: -3.3, lon: 128.97 },
  { name: 'Maluku Utara', lat: 1.5709, lon: 127.8088, aliases: ['malut'] },
  { name: 'Ternate', lat: 0.7905, lon: 127.3846 },
  { name: 'Tidore', lat: 0.7, lon: 127.5 },
  { name: 'Sofifi', lat: 0.73, lon: 127.56 },
  { name: 'Papua', lat: -4.2699, lon: 138.0804 },
  { name: 'Jayapura', lat: -2.5916, lon: 140.669 },
  { name: 'Merauke', lat: -8.4932, lon: 140.4018 },
  { name: 'Timika', lat: -4.546, lon: 136.887 },
  { name: 'Nabire', lat: -3.35, lon: 135.5 },
  { name: 'Wamena', lat: -4.1, lon: 138.95 },
  { name: 'Papua Barat', lat: -1.3361, lon: 133.1747, aliases: ['pabar'] },
  { name: 'Manokwari', lat: -0.8615, lon: 134.062 },
  { name: 'Sorong', lat: -0.8762, lon: 131.255 },
  { name: 'Fakfak', lat: -2.92, lon: 132.3 },
  { name: 'Kaimana', lat: -3.66, lon: 133.75 },
  { name: 'Papua Barat Daya', lat: -0.876, lon: 131.255 },
  { name: 'Papua Tengah', lat: -4.0, lon: 136.0 },
  { name: 'Papua Selatan', lat: -8.49, lon: 140.4 },
  { name: 'Papua Pegunungan', lat: -4.1, lon: 138.95 },

  // ── Internasional (untuk daftar luar negeri) ─────────────────
  { name: 'Amerika Serikat', lat: 39.8283, lon: -98.5795, aliases: ['amerika', 'as', 'usa', 'united states'] },
  { name: 'Washington', lat: 38.9072, lon: -77.0369 },
  { name: 'New York', lat: 40.7128, lon: -74.006 },
  { name: 'China', lat: 35.8617, lon: 104.1954, aliases: ['tiongkok', 'tiongkok'] },
  { name: 'Beijing', lat: 39.9042, lon: 116.4074 },
  { name: 'Jepang', lat: 36.2048, lon: 138.2529, aliases: ['japan'] },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Singapura', lat: 1.3521, lon: 103.8198, aliases: ['singapore'] },
  { name: 'Malaysia', lat: 4.2105, lon: 101.9758 },
  { name: 'Kuala Lumpur', lat: 3.139, lon: 101.6869 },
  { name: 'Australia', lat: -25.2744, lon: 133.7751 },
  { name: 'Selandia Baru', lat: -40.9006, lon: 174.886, aliases: ['new zealand'] },
  { name: 'Eropa', lat: 50.0755, lon: 14.4378, aliases: ['eropa barat', 'uni eropa'] },
  { name: 'Inggris', lat: 55.3781, lon: -3.436, aliases: ['uk', 'united kingdom', 'britania raya'] },
  { name: 'London', lat: 51.5074, lon: -0.1278 },
  { name: 'Prancis', lat: 46.2276, lon: 2.2137, aliases: ['perancis'] },
  { name: 'Jerman', lat: 51.1657, lon: 10.4515 },
  { name: 'Belanda', lat: 52.1326, lon: 5.2913 },
  { name: 'Rusia', lat: 61.524, lon: 105.3188 },
  { name: 'Ukraina', lat: 48.3794, lon: 31.1656 },
  { name: 'Turki', lat: 38.9637, lon: 35.2433 },
  { name: 'Iran', lat: 32.4279, lon: 53.688 },
  { name: 'Irak', lat: 33.2232, lon: 43.6793 },
  { name: 'Suriah', lat: 34.8021, lon: 38.9968, aliases: ['syria'] },
  { name: 'Lebanon', lat: 33.8547, lon: 35.8623 },
  { name: 'Israel', lat: 31.0461, lon: 34.8516 },
  { name: 'Palestina', lat: 31.9522, lon: 35.2332, aliases: ['palestine'] },
  { name: 'Gaza', lat: 31.5017, lon: 34.4668, aliases: ['jalur gaza'] },
  { name: 'Arab Saudi', lat: 23.8859, lon: 45.0792, aliases: ['saudi arabia'] },
  { name: 'Riyadh', lat: 24.7136, lon: 46.6753 },
  { name: 'Uni Emirat Arab', lat: 23.4241, lon: 53.8478, aliases: ['uea', 'uae'] },
  { name: 'Qatar', lat: 25.3548, lon: 51.1839 },
  { name: 'Timur Tengah', lat: 29.2985, lon: 42.551 },
  { name: 'Mesir', lat: 26.8206, lon: 30.8025, aliases: ['egypt'] },
  { name: 'Afrika Selatan', lat: -30.5595, lon: 22.9375, aliases: ['south africa'] },
  { name: 'Nigeria', lat: 9.082, lon: 8.6753 },
  { name: 'Kenya', lat: -0.0236, lon: 37.9062 },
  { name: 'Ethiopia', lat: 9.145, lon: 40.4897 },
  { name: 'India', lat: 20.5937, lon: 78.9629 },
  { name: 'Pakistan', lat: 30.3753, lon: 69.3451 },
  { name: 'Thailand', lat: 15.87, lon: 100.9925 },
  { name: 'Vietnam', lat: 14.0583, lon: 108.2772 },
  { name: 'Filipina', lat: 12.8797, lon: 121.774, aliases: ['philippines'] },
  { name: 'Korea Selatan', lat: 35.9078, lon: 127.7669, aliases: ['korsel', 'south korea'] },
  { name: 'Korea Utara', lat: 40.3399, lon: 127.5101, aliases: ['korut', 'north korea'] },
  { name: 'Kanada', lat: 56.1304, lon: -106.3468, aliases: ['canada'] },
  { name: 'Meksiko', lat: 23.6345, lon: -102.5528, aliases: ['meksiko'] },
  { name: 'Brasil', lat: -14.235, lon: -51.9253, aliases: ['brazil'] },
  { name: 'Argentina', lat: -38.4161, lon: -63.6167 },
  { name: 'Jenewa', lat: 46.2044, lon: 6.1432, aliases: ['geneva'] },
]

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[._]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const INDEX = new Map<string, GeoEntry>()
for (const entry of ENTRIES) {
  INDEX.set(normalize(entry.name), entry)
  for (const alias of entry.aliases ?? []) INDEX.set(normalize(alias), entry)
}

const PREFIXES = ['kota ', 'kabupaten ', 'kab ', 'provinsi ', 'prov ', 'dki ']

export interface ResolvedLocation {
  name: string
  lat: number
  lon: number
}

/** Cari koordinat untuk nama lokasi (menerima alias & prefix administratif). */
export function resolveLocation(rawName: string): ResolvedLocation | null {
  let key = normalize(rawName)
  if (!key) return null

  const direct = INDEX.get(key)
  if (direct) return { name: direct.name, lat: direct.lat, lon: direct.lon }

  for (const prefix of PREFIXES) {
    if (key.startsWith(prefix)) {
      key = key.slice(prefix.length).trim()
      const stripped = INDEX.get(key)
      if (stripped) return { name: stripped.name, lat: stripped.lat, lon: stripped.lon }
    }
  }

  return null
}

/** True bila koordinat masuk area peta Indonesia yang ditampilkan. */
export function isInIndonesiaMap(lat: number, lon: number): boolean {
  return lat >= -11.5 && lat <= 7.5 && lon >= 94 && lon <= 142
}
